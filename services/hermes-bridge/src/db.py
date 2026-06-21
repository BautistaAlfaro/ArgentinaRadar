"""
Database access layer for the Hermes bridge.

Connects to the shared ArgentinaRadar SQLite database. Most queries
use a read-only connection; write operations (manual overrides) use
a separate read-write connection.
"""

import sqlite3
from datetime import date, datetime
from pathlib import Path
from typing import Any

from src.config import DB_PATH


# ---------------------------------------------------------------------------
# Connection helpers
# ---------------------------------------------------------------------------


def _get_readonly_conn() -> sqlite3.Connection:
    """
    Open a read-only connection to the shared SQLite database.

    Uses URI mode 'ro' so any accidental write attempt fails at the SQLite level.
    """
    uri = Path(DB_PATH).resolve().as_uri() + "?mode=ro"
    conn = sqlite3.connect(uri, uri=True, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


def _get_writable_conn() -> sqlite3.Connection:
    """
    Open a read-write connection for manual override operations.
    """
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


# ---------------------------------------------------------------------------
# Query functions
# ---------------------------------------------------------------------------


def get_tweet_history(limit: int = 50) -> list[dict[str, Any]]:
    """Return the most recent tweet_history entries."""
    conn = _get_readonly_conn()
    try:
        rows = conn.execute(
            """SELECT th.id, th.article_id, th.tweet_id, th.posted_at,
                      th.status, th.error,
                      ni.title AS headline, ni.source, ni.url
               FROM tweet_history th
               LEFT JOIN news_items ni ON ni.id = th.article_id
               ORDER BY COALESCE(th.posted_at, '') DESC, th.id DESC
               LIMIT ?""",
            (limit,),
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def get_article_counts() -> dict[str, int]:
    """Return counts of articles by status."""
    conn = _get_readonly_conn()
    try:
        today = date.today().isoformat()

        total = conn.execute("SELECT COUNT(*) as c FROM news_items").fetchone()["c"]
        published = conn.execute(
            "SELECT COUNT(*) as c FROM news_items WHERE status = 'published'"
        ).fetchone()["c"]
        pending = conn.execute(
            "SELECT COUNT(*) as c FROM news_items WHERE status IN ('ingested','geolocated','filtered')"
        ).fetchone()["c"]
        pending_approval = conn.execute(
            "SELECT COUNT(*) as c FROM news_items WHERE status = 'pending_approval'"
        ).fetchone()["c"]
        discarded = conn.execute(
            "SELECT COUNT(*) as c FROM news_items WHERE status = 'discarded'"
        ).fetchone()["c"]

        published_today = conn.execute(
            "SELECT COUNT(*) as c FROM news_items WHERE status = 'published' AND date(ingested_at) = ?",
            (today,),
        ).fetchone()["c"]

        ingested_today = conn.execute(
            "SELECT COUNT(*) as c FROM news_items WHERE date(ingested_at) = ?",
            (today,),
        ).fetchone()["c"]

        return {
            "total": total,
            "published": published,
            "pending": pending,
            "pending_approval": pending_approval,
            "discarded": discarded,
            "published_today": published_today,
            "ingested_today": ingested_today,
        }
    finally:
        conn.close()


def get_latest_articles(limit: int = 5) -> list[dict[str, Any]]:
    """Return the latest N news articles."""
    conn = _get_readonly_conn()
    try:
        rows = conn.execute(
            """SELECT id, title, summary, source, category,
                      published_at, ingested_at, status, url
               FROM news_items
               ORDER BY COALESCE(published_at, ingested_at) DESC
               LIMIT ?""",
            (limit,),
        ).fetchall()

        results = []
        for r in rows:
            item = dict(r)
            # Parse location JSON if present
            results.append(item)

        return results
    finally:
        conn.close()


def get_service_status() -> dict[str, Any]:
    """Return source/ingestion service health from the sources table."""
    conn = _get_readonly_conn()
    try:
        rows = conn.execute(
            "SELECT name, status, last_fetched_at FROM sources ORDER BY name"
        ).fetchall()
        return {"sources": [dict(r) for r in rows]}
    finally:
        conn.close()


def get_twitter_quota() -> dict[str, int]:
    """Return monthly Twitter usage from tweet_history."""
    conn = _get_readonly_conn()
    try:
        now = datetime.now()
        month = f"{now.year}-{now.month:02d}"

        used = conn.execute(
            """SELECT COUNT(*) as c FROM tweet_history
               WHERE strftime('%Y-%m', posted_at) = ? AND status = 'success'""",
            (month,),
        ).fetchone()["c"]

        return {
            "used": used,
            "limit": 1400,
            "remaining": max(0, 1400 - used),
            "month": month,
        }
    finally:
        conn.close()


def get_ai_processor_cost() -> dict[str, Any]:
    """Return today's AI processing cost from the ai-processor service."""
    import httpx

    from src.config import SERVICE_URLS

    processor_url = SERVICE_URLS.get("ai-processor", "http://localhost:3013")

    try:
        with httpx.Client(timeout=5) as client:
            resp = client.get(f"{processor_url}/api/costs")
            if resp.status_code == 200:
                data = resp.json()
                return {
                    "daily_cost": data.get("daily_cost", 0.0),
                    "daily_tokens": data.get("daily_tokens", 0),
                    "monthly_cost": data.get("monthly_cost", 0.0),
                    "daily_budget_cap": data.get("daily_budget_cap", 2.0),
                    "cap_exceeded": data.get("cap_exceeded", False),
                }
    except Exception:
        pass

    # Fallback when ai-processor is unreachable
    return {
        "daily_cost": 0.0,
        "daily_tokens": 0,
        "monthly_cost": 0.0,
        "daily_budget_cap": 2.0,
        "cap_exceeded": False,
    }


def get_daily_weekly_stats() -> dict[str, Any]:
    """Return daily and weekly aggregation stats."""
    conn = _get_readonly_conn()
    try:
        today = date.today().isoformat()
        # Week start: Monday of current week
        week_start = date.today()
        while week_start.weekday() != 0:  # 0 = Monday
            week_start = week_start.replace(
                day=week_start.day - (1 if week_start.weekday() > 0 else 0)
            )
        # Actually let's just use 7 days ago for simplicity
        from datetime import timedelta

        week_ago = (date.today() - timedelta(days=7)).isoformat()

        daily = {
            "ingested": conn.execute(
                "SELECT COUNT(*) as c FROM news_items WHERE date(ingested_at) = ?",
                (today,),
            ).fetchone()["c"],
            "filtered_publish": conn.execute(
                "SELECT COUNT(*) as c FROM news_items WHERE date(ingested_at) = ? AND status IN ('filtered','published','pending_approval')",
                (today,),
            ).fetchone()["c"],
            "pending_approval": conn.execute(
                "SELECT COUNT(*) as c FROM news_items WHERE date(ingested_at) = ? AND status = 'pending_approval'",
                (today,),
            ).fetchone()["c"],
            "filtered_discard": conn.execute(
                "SELECT COUNT(*) as c FROM news_items WHERE date(ingested_at) = ? AND status = 'discarded'",
                (today,),
            ).fetchone()["c"],
            "tweets_posted": conn.execute(
                "SELECT COUNT(*) as c FROM tweet_history WHERE date(posted_at) = ? AND status = 'success'",
                (today,),
            ).fetchone()["c"],
            "errors": conn.execute(
                "SELECT COUNT(*) as c FROM tweet_history WHERE date(posted_at) = ? AND status IN ('failed','dead_letter')",
                (today,),
            ).fetchone()["c"],
        }

        weekly = {
            "ingested": conn.execute(
                "SELECT COUNT(*) as c FROM news_items WHERE date(ingested_at) >= ?",
                (week_ago,),
            ).fetchone()["c"],
            "filtered_publish": conn.execute(
                "SELECT COUNT(*) as c FROM news_items WHERE date(ingested_at) >= ? AND status IN ('filtered','published','pending_approval')",
                (week_ago,),
            ).fetchone()["c"],
            "pending_approval": conn.execute(
                "SELECT COUNT(*) as c FROM news_items WHERE date(ingested_at) >= ? AND status = 'pending_approval'",
                (week_ago,),
            ).fetchone()["c"],
            "filtered_discard": conn.execute(
                "SELECT COUNT(*) as c FROM news_items WHERE date(ingested_at) >= ? AND status = 'discarded'",
                (week_ago,),
            ).fetchone()["c"],
            "tweets_posted": conn.execute(
                "SELECT COUNT(*) as c FROM tweet_history WHERE date(posted_at) >= ? AND status = 'success'",
                (week_ago,),
            ).fetchone()["c"],
            "errors": conn.execute(
                "SELECT COUNT(*) as c FROM tweet_history WHERE date(posted_at) >= ? AND status IN ('failed','dead_letter')",
                (week_ago,),
            ).fetchone()["c"],
        }

        return {"daily": daily, "weekly": weekly}
    finally:
        conn.close()


def get_last_tweet_error() -> str | None:
    """Return the error message of the most recently failed tweet, if any."""
    conn = _get_readonly_conn()
    try:
        row = conn.execute(
            """SELECT error FROM tweet_history
               WHERE status IN ('failed','dead_letter')
               ORDER BY id DESC LIMIT 1"""
        ).fetchone()
        return row["error"] if row else None
    finally:
        conn.close()


def get_all_sources_status() -> list[dict[str, Any]]:
    """Return the status of all registered news sources."""
    conn = _get_readonly_conn()
    try:
        rows = conn.execute("SELECT name, status FROM sources").fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Write operations (manual overrides)
# ---------------------------------------------------------------------------


def _ensure_override_log_table(conn: sqlite3.Connection) -> None:
    """Create the override_log table if it doesn't exist."""
    conn.execute("""
        CREATE TABLE IF NOT EXISTS override_log (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            article_id TEXT    NOT NULL,
            action     TEXT    NOT NULL,
            reason     TEXT,
            timestamp  TEXT    NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (article_id) REFERENCES news_items(id)
        )
    """)
    conn.commit()


def force_publish_article(article_id: str, reason: str = "") -> bool:
    """
    Force-queue an article for publishing (bypass AI filter).

    Updates the article's status to 'publish_forced' and inserts a
    pending entry in tweet_history so the twitter-publisher picks it up.

    Returns True on success, False if article does not exist.
    """
    conn = _get_writable_conn()
    try:
        _ensure_override_log_table(conn)

        # Check article exists
        article = conn.execute(
            "SELECT id, title FROM news_items WHERE id = ?", (article_id,)
        ).fetchone()
        if not article:
            return False

        # Update status to publish_forced
        conn.execute(
            "UPDATE news_items SET status = 'publish_forced' WHERE id = ?",
            (article_id,),
        )

        # Insert pending tweet_history entry so publisher picks it up
        th_exists = conn.execute(
            "SELECT id FROM tweet_history WHERE article_id = ? AND status = 'pending'",
            (article_id,),
        ).fetchone()
        if not th_exists:
            conn.execute(
                "INSERT INTO tweet_history (article_id, status) VALUES (?, 'pending')",
                (article_id,),
            )

        # Log the override
        conn.execute(
            "INSERT INTO override_log (article_id, action, reason) VALUES (?, 'publish', ?)",
            (article_id, reason),
        )

        conn.commit()
        return True
    finally:
        conn.close()


def skip_article(article_id: str, reason: str = "") -> bool:
    """
    Mark an article as manually skipped.

    Returns True on success, False if article does not exist.
    """
    conn = _get_writable_conn()
    try:
        _ensure_override_log_table(conn)

        article = conn.execute(
            "SELECT id FROM news_items WHERE id = ?", (article_id,)
        ).fetchone()
        if not article:
            return False

        conn.execute(
            "UPDATE news_items SET status = 'skipped' WHERE id = ?",
            (article_id,),
        )

        conn.execute(
            "INSERT INTO override_log (article_id, action, reason) VALUES (?, 'skip', ?)",
            (article_id, reason),
        )

        conn.commit()
        return True
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Approval queue queries
# ---------------------------------------------------------------------------


def get_approval_queue(status_filter: str | None = None) -> list[dict[str, Any]]:
    """
    Return approval_queue entries, optionally filtered by status.

    Joins with news_items to include article title and source.
    """
    conn = _get_readonly_conn()
    try:
        if status_filter:
            rows = conn.execute(
                """SELECT aq.*, ni.title AS article_title, ni.source AS article_source,
                          ni.url AS article_url
                   FROM approval_queue aq
                   LEFT JOIN news_items ni ON ni.id = aq.article_id
                   WHERE aq.status = ?
                   ORDER BY aq.created_at DESC""",
                (status_filter,),
            ).fetchall()
        else:
            rows = conn.execute(
                """SELECT aq.*, ni.title AS article_title, ni.source AS article_source,
                          ni.url AS article_url
                   FROM approval_queue aq
                   LEFT JOIN news_items ni ON ni.id = aq.article_id
                   ORDER BY aq.created_at DESC"""
            ).fetchall()

        return [dict(r) for r in rows]
    finally:
        conn.close()


def get_approval_stats() -> dict[str, Any]:
    """Return approval queue statistics."""
    conn = _get_readonly_conn()
    try:
        total = conn.execute("SELECT COUNT(*) as c FROM approval_queue").fetchone()["c"]
        pending = conn.execute(
            "SELECT COUNT(*) as c FROM approval_queue WHERE status = 'pending'"
        ).fetchone()["c"]
        approved = conn.execute(
            "SELECT COUNT(*) as c FROM approval_queue WHERE status = 'approved'"
        ).fetchone()["c"]
        rejected = conn.execute(
            "SELECT COUNT(*) as c FROM approval_queue WHERE status = 'rejected'"
        ).fetchone()["c"]
        edited = conn.execute(
            "SELECT COUNT(*) as c FROM approval_queue WHERE status = 'edited'"
        ).fetchone()["c"]
        scheduled = conn.execute(
            "SELECT COUNT(*) as c FROM approval_queue WHERE status = 'scheduled'"
        ).fetchone()["c"]

        # Last 24 hours
        from datetime import datetime, timedelta
        cutoff = (datetime.now() - timedelta(hours=24)).isoformat()
        last_24h = conn.execute(
            "SELECT COUNT(*) as c FROM approval_queue WHERE created_at >= ?",
            (cutoff,),
        ).fetchone()["c"]

        # Oldest pending (time since creation)
        oldest_pending = conn.execute(
            "SELECT created_at FROM approval_queue WHERE status = 'pending' ORDER BY created_at ASC LIMIT 1"
        ).fetchone()

        return {
            "total": total,
            "pending": pending,
            "approved": approved,
            "rejected": rejected,
            "edited": edited,
            "scheduled": scheduled,
            "last_24h": last_24h,
            "oldest_pending": dict(oldest_pending)["created_at"] if oldest_pending else None,
        }
    finally:
        conn.close()
