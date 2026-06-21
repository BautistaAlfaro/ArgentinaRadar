"""
AI Filter REST Service.

FastAPI server on port 3003 that:
  - POST /api/filter     — Evaluate a single article
  - GET  /api/filter/queue — Pending articles (not yet filtered)
  - GET  /api/filter/stats — Daily stats (evaluations, ratio, cost)
  - GET  /health           — Service health

A background loop polls the geolocation service for new geolocated
articles and runs them through the AI filter automatically.
"""

import asyncio
import os
import sqlite3
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Any

import httpx
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from src.config import DB_PATH, PORT, POLL_INTERVAL, GEOLOCATION_URL
from src.cost_tracker import CostTracker
from src.filter import AIFilter

# ---------------------------------------------------------------------------
# Globals — initialised once at startup
# ---------------------------------------------------------------------------

cost_tracker = CostTracker()
ai_filter = AIFilter(cost_tracker=cost_tracker)

# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------


class FilterRequest(BaseModel):
    article_id: str
    title: str
    summary: str = ""
    source: str = ""
    category: str = ""


class FilterResponse(BaseModel):
    article_id: str
    verdict: str
    reason: str
    scores: dict[str, int]
    combined: int
    tokens: dict[str, int]
    error: bool = False


# ---------------------------------------------------------------------------
# Background loop
# ---------------------------------------------------------------------------


async def background_loop() -> None:
    """
    Periodically poll the geolocation service for new geolocated articles
    and evaluate them through the AI filter.
    """
    while True:
        try:
            if cost_tracker.is_cap_exceeded():
                await asyncio.sleep(POLL_INTERVAL)
                continue

            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.get(
                    f"{GEOLOCATION_URL}/api/news/geolocated?limit=20"
                )

            if resp.status_code != 200:
                print(f"[background] Geolocation service returned {resp.status_code}")
                await asyncio.sleep(POLL_INTERVAL)
                continue

            data: dict[str, Any] = resp.json()
            items: list[dict[str, Any]] = data.get("items", [])

            # Only articles that haven't been filtered yet
            pending = [
                a for a in items if a.get("status") in ("geolocated",)
            ]

            if not pending:
                await asyncio.sleep(POLL_INTERVAL)
                continue

            print(f"[background] Filtering {len(pending)} geolocated article(s)...")
            for article in pending:
                if cost_tracker.is_cap_exceeded():
                    print("[background] ⛔ Cost cap hit — pausing background filtering")
                    break

                result = await ai_filter.evaluate(
                    article_id=article["id"],
                    title=article.get("title", ""),
                    summary=article.get("summary", ""),
                    source=article.get("source", ""),
                    category=article.get("category", ""),
                )
                v = result.get("verdict", "ERROR")
                print(f"  {'✅' if v == 'PUBLISH' else '⏭️'}  {article['id'][:8]}… → {v}")

        except Exception as exc:
            print(f"[background] Error: {exc}")

        await asyncio.sleep(POLL_INTERVAL)


# ---------------------------------------------------------------------------
# FastAPI lifespan
# ---------------------------------------------------------------------------


@asynccontextmanager
async def lifespan(app: FastAPI):
    task = asyncio.create_task(background_loop())
    yield
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass


# ---------------------------------------------------------------------------
# Application
# ---------------------------------------------------------------------------

app = FastAPI(
    title="ArgentinaRadar AI Filter",
    version="0.1.0",
    lifespan=lifespan,
)


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@app.post("/api/filter", response_model=FilterResponse)
async def filter_article(req: FilterRequest):
    """Evaluate a single article and return the verdict."""
    if cost_tracker.is_cap_exceeded():
        raise HTTPException(
            status_code=429,
            detail="Daily cost cap exceeded — filtering is paused",
        )

    result = await ai_filter.evaluate(
        article_id=req.article_id,
        title=req.title,
        summary=req.summary,
        source=req.source,
        category=req.category,
    )
    return result  # type: ignore[arg-type]


@app.get("/api/filter/queue")
async def get_queue(limit: int = 50):
    """Return articles that are geolocated but not yet filtered."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        rows = conn.execute(
            """SELECT id, title, summary, source, category, published_at
               FROM news_items
               WHERE status = 'geolocated'
               ORDER BY published_at ASC
               LIMIT ?""",
            (limit,),
        ).fetchall()
        items = [dict(r) for r in rows]
        return {"items": items, "total": len(items)}
    finally:
        conn.close()


@app.get("/api/filter/stats")
async def get_stats():
    """
    Return daily evaluation statistics:
     - Number evaluated, published, discarded today
     - Cost tracking info
    """
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        today = datetime.now().isoformat()[:10]  # YYYY-MM-DD

        total = conn.execute(
            """SELECT COUNT(*) as c FROM news_items
               WHERE date(ingested_at) = ? AND status IN ('filtered','discarded')""",
            (today,),
        ).fetchone()["c"]

        published = conn.execute(
            "SELECT COUNT(*) as c FROM news_items WHERE date(ingested_at) = ? AND status = 'filtered'",
            (today,),
        ).fetchone()["c"]

        discarded = conn.execute(
            "SELECT COUNT(*) as c FROM news_items WHERE date(ingested_at) = ? AND status = 'discarded'",
            (today,),
        ).fetchone()["c"]

        return {
            "total_evaluated_today": total,
            "published_today": published,
            "discarded_today": discarded,
            "cost": cost_tracker.get_stats(),
        }
    finally:
        conn.close()


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "uptime_seconds": int(os.times()[4]) if hasattr(os, "times") else 0,
        "port": PORT,
    }


# ---------------------------------------------------------------------------
# Entry point (for direct execution)
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn

    uvicorn.run("src.server:app", host="0.0.0.0", port=PORT, reload=False)
