"""Hermes Bridge — FastAPI server on port 3005."""
import asyncio
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from .db import (
    get_service_status,
    get_article_counts,
    get_tweet_history,
    get_daily_weekly_stats,
    get_approval_queue,
    get_approval_stats,
)
from .commands import router as commands_router
from .notifications import notification_loop
from .alerts import alert_loop
from .approval import approval_loop
from .overrides import router as overrides_router

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Background task references (cancelled on shutdown)
_background_tasks: list[asyncio.Task] = []


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _background_tasks

    # Start all background loops as asyncio tasks
    _background_tasks = [
        asyncio.create_task(notification_loop(), name="notification-loop"),
        asyncio.create_task(alert_loop(), name="alert-loop"),
        asyncio.create_task(approval_loop(), name="approval-loop"),
    ]
    logger.info(
        "Hermes bridge started — notifications + alerts + approval active "
        f"({len(_background_tasks)} tasks)"
    )
    yield

    # Graceful shutdown
    for task in _background_tasks:
        task.cancel()
    await asyncio.gather(*_background_tasks, return_exceptions=True)
    _background_tasks.clear()
    logger.info("Hermes bridge stopped")


app = FastAPI(title="ArgentinaRadar Hermes Bridge", version="1.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(commands_router)
app.include_router(overrides_router, prefix="/api/override", tags=["overrides"])


# ---------------------------------------------------------------------------
# Health & dashboard
# ---------------------------------------------------------------------------


@app.get("/health")
async def health():
    status = get_service_status()
    return {"status": "ok", "services": status}


@app.get("/api/radar/articles")
async def radar_articles(limit: int = 20, offset: int = 0):
    return get_tweet_history(limit, offset)


@app.get("/api/radar/dashboard")
async def radar_dashboard():
    counts = get_article_counts()
    stats = get_daily_weekly_stats()
    status = get_service_status()
    approval = get_approval_stats()
    return {
        "counts": counts,
        "stats": stats,
        "services": status,
        "approval": approval,
    }


# ---------------------------------------------------------------------------
# Approval workflow endpoints
# ---------------------------------------------------------------------------


class TelegramCallback(BaseModel):
    """Callback data from Telegram inline keyboard."""
    callback_query_id: str
    chat_id: str
    message_id: int
    data: str
    from_user: str = "unknown"


@app.get("/api/approval/queue")
async def approval_queue_list(status: str | None = None):
    """
    Return the approval queue, optionally filtered by status.

    Query params:
      status: pending | approved | rejected | edited | scheduled (optional)
    """
    items = get_approval_queue(status_filter=status)
    return {"items": items, "count": len(items)}


@app.get("/api/approval/stats")
async def approval_stats():
    """Return approval queue statistics."""
    return get_approval_stats()


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("services.hermes-bridge.src.server:app", host="0.0.0.0", port=3005, reload=True)
