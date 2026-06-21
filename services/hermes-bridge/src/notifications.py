"""
Tweet publish notification system.

Polls the tweet_history table every N seconds for new 'success' entries
and sends a Telegram notification via the Bot API.

Tracks the last notified tweet_id to avoid duplicate notifications.
"""

import asyncio
import json
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Any

import httpx

from src.config import (
    DB_PATH,
    TELEGRAM_BOT_TOKEN,
    TELEGRAM_CHAT_ID,
    NOTIFICATION_POLL_INTERVAL,
)
from src.formatters import fmt_tweet_notification


# ---------------------------------------------------------------------------
# State file: tracks last notified tweet_history ID so we don't re-notify
# ---------------------------------------------------------------------------

_STATE_FILE = Path(__file__).resolve().parent / ".notify_state.json"


def _load_last_notified() -> int | None:
    """Return the last notified tweet_history.id from state file."""
    if _STATE_FILE.exists():
        try:
            data = json.loads(_STATE_FILE.read_text())
            return data.get("last_tweet_history_id")
        except (json.JSONDecodeError, ValueError, KeyError):
            return None
    return None


def _save_last_notified(tweet_history_id: int) -> None:
    """Persist the last notified tweet_history.id."""
    _STATE_FILE.write_text(
        json.dumps({"last_tweet_history_id": tweet_history_id, "updated_at": datetime.now().isoformat()})
    )


# ---------------------------------------------------------------------------
# Database helper
# ---------------------------------------------------------------------------


def _get_new_tweets(last_id: int | None) -> list[dict[str, Any]]:
    """Fetch tweet_history rows that are new since last_id."""
    conn = sqlite3.connect(DB_PATH, uri=True)  # read-only via URI
    conn.row_factory = sqlite3.Row
    try:
        if last_id is not None:
            rows = conn.execute(
                """SELECT th.id, th.article_id, th.tweet_id, th.posted_at,
                          ni.title AS headline, ni.source, ni.url, ni.location
                   FROM tweet_history th
                   LEFT JOIN news_items ni ON ni.id = th.article_id
                   WHERE th.status = 'success' AND th.id > ?
                   ORDER BY th.id ASC""",
                (last_id,),
            ).fetchall()
        else:
            rows = conn.execute(
                """SELECT th.id, th.article_id, th.tweet_id, th.posted_at,
                          ni.title AS headline, ni.source, ni.url, ni.location
                   FROM tweet_history th
                   LEFT JOIN news_items ni ON ni.id = th.article_id
                   WHERE th.status = 'success'
                   ORDER BY th.id ASC"""
            ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Telegram sender
# ---------------------------------------------------------------------------


async def _send_telegram(text: str) -> bool:
    """
    Send a plain text message via Telegram Bot API.

    Returns True if the message was sent successfully.
    """
    if not TELEGRAM_BOT_TOKEN or not TELEGRAM_CHAT_ID:
        print("[notifications] ⚠️  TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set — skipping")
        return False

    url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
    payload = {
        "chat_id": TELEGRAM_CHAT_ID,
        "text": text,
        "parse_mode": "Markdown",
        "disable_web_page_preview": False,
    }

    async with httpx.AsyncClient(timeout=10) as client:
        try:
            resp = await client.post(url, json=payload)
            if resp.status_code != 200:
                print(
                    f"[notifications] ⚠️  Telegram API returned {resp.status_code}: "
                    f"{resp.text[:200]}"
                )
                return False
            return True
        except httpx.RequestError as exc:
            print(f"[notifications] ⚠️  Telegram request failed: {exc}")
            return False


# ---------------------------------------------------------------------------
# Notification loop
# ---------------------------------------------------------------------------


async def notification_loop() -> None:
    """
    Background task: poll tweet_history every N seconds for new publish
    events and send Telegram notifications.

    This loop runs as a FastAPI lifespan task (started in bridge.py).
    """
    last_id = _load_last_notified()
    print(f"[notifications] 🔄 Starting notification loop (interval={NOTIFICATION_POLL_INTERVAL}s)"
          + (f", last_id={last_id}" if last_id else ""))

    while True:
        try:
            tweets = _get_new_tweets(last_id)
            for tw in tweets:
                headline = tw.get("headline") or tw.get("article_id", "")
                source = tw.get("source", "")
                url = tw.get("url", "")
                location = _extract_location(tw.get("location"))

                msg = fmt_tweet_notification(
                    headline=headline,
                    source=source,
                    location=location,
                    link=url,
                )

                sent = await _send_telegram(msg)
                if sent:
                    print(f"[notifications] ✅ Notified tweet #{tw['id']}: {headline[:60]}…")
                else:
                    print(f"[notifications] ❌ Failed to notify tweet #{tw['id']}")

                last_id = tw["id"]
                _save_last_notified(last_id)

        except Exception as exc:
            print(f"[notifications] ⚠️  Error in notification loop: {exc}")

        await asyncio.sleep(NOTIFICATION_POLL_INTERVAL)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _extract_location(raw: Any) -> str | None:
    """Extract a location string from the article's JSON location field."""
    if not raw:
        return None
    if isinstance(raw, str):
        try:
            loc = json.loads(raw)
        except (json.JSONDecodeError, TypeError):
            return str(raw) if raw else None
    elif isinstance(raw, dict):
        loc = raw
    else:
        return None

    return loc.get("city") or loc.get("province") or loc.get("neighborhood") or None
