"""Hermes Bridge — FastAPI server on port 3005."""
import asyncio
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .db import get_service_status, get_article_counts, get_tweet_history, get_daily_stats
from .commands import handle_status, handle_news, handle_stats
from .notifications import NotificationLoop
from .alerts import AlertMonitor
from .overrides import router as overrides_router

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

notification_loop: NotificationLoop | None = None
alert_monitor: AlertMonitor | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global notification_loop, alert_monitor
    notification_loop = NotificationLoop(interval_seconds=30)
    alert_monitor = AlertMonitor(check_interval_seconds=60)
    notification_loop.start()
    alert_monitor.start()
    logger.info("Hermes bridge started — notifications + alerts active")
    yield
    if notification_loop:
        notification_loop.stop()
    if alert_monitor:
        alert_monitor.stop()
    logger.info("Hermes bridge stopped")


app = FastAPI(title="ArgentinaRadar Hermes Bridge", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(overrides_router, prefix="/api/override", tags=["overrides"])


@app.get("/health")
async def health():
    status = get_service_status()
    return {"status": "ok", "services": status}


@app.get("/api/radar/status")
async def radar_status():
    return handle_status()


@app.get("/api/radar/news")
async def radar_news(limit: int = 5):
    return handle_news(limit)


@app.get("/api/radar/stats")
async def radar_stats():
    return handle_stats()


@app.get("/api/radar/articles")
async def radar_articles(limit: int = 20, offset: int = 0):
    return get_tweet_history(limit, offset)


@app.get("/api/radar/dashboard")
async def radar_dashboard():
    counts = get_article_counts()
    stats = get_daily_stats()
    status = get_service_status()
    return {"counts": counts, "stats": stats, "services": status}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("services.hermes-bridge.src.server:app", host="0.0.0.0", port=3005, reload=True)
