"""
Hermes Bridge configuration.

Loads environment variables from the project's .env file or process environment.
"""

import os
from pathlib import Path
from dotenv import load_dotenv

# Resolve project root (services/hermes-bridge/src/config.py -> project root)
_PROJECT_ROOT = Path(__file__).resolve().parents[3]

# Load .env from project config directory
_dotenv_path = _PROJECT_ROOT / "config" / ".env"
if _dotenv_path.exists():
    load_dotenv(_dotenv_path)

# --- Database ---
DB_PATH: str = os.environ.get(
    "DB_PATH",
    str(_PROJECT_ROOT / "data" / "argentina-radar.db"),
)

# --- Service ---
PORT: int = int(os.environ.get("PORT", "3005"))

# --- Telegram ---
TELEGRAM_BOT_TOKEN: str = os.environ.get("TELEGRAM_BOT_TOKEN", "")
TELEGRAM_CHAT_ID: str = os.environ.get("TELEGRAM_CHAT_ID", "")

# --- Notification polling ---
NOTIFICATION_POLL_INTERVAL: int = int(
    os.environ.get("NOTIFICATION_POLL_INTERVAL", "30")
)  # seconds
ALERT_POLL_INTERVAL: int = int(
    os.environ.get("ALERT_POLL_INTERVAL", "60")
)  # seconds

# --- Service URLs for health checks ---
SERVICE_URLS: dict[str, str] = {
    "news-ingestion": os.environ.get("NEWS_SERVICE_URL", "http://localhost:3001"),
    "geolocation": os.environ.get("GEOLOCATION_URL", "http://localhost:3002"),
    "ai-processor": os.environ.get("AI_PROCESSOR_URL", "http://localhost:3013"),
    "twitter-publisher": os.environ.get("TWITTER_PUBLISHER_URL", "http://localhost:3004"),
}

# --- Approval workflow (Telegram-based human approval) ---
TWITTER_PUBLISHER_URL: str = os.environ.get(
    "TWITTER_PUBLISHER_URL", "http://localhost:3004"
)
EVENT_DETECTOR_URL: str = os.environ.get(
    "EVENT_DETECTOR_URL", "http://localhost:3008"
)

# How often to poll Telegram for callback updates (seconds)
APPROVAL_POLL_INTERVAL: int = int(
    os.environ.get("APPROVAL_POLL_INTERVAL", "5")
)

# How often to poll the event-detector for new events (seconds)
APPROVAL_EVENT_POLL_INTERVAL: int = int(
    os.environ.get("APPROVAL_EVENT_POLL_INTERVAL", "60")
)

# Auto-publish threshold: events with impact >= this value skip approval
APPROVAL_AUTO_PUBLISH_THRESHOLD: int = int(
    os.environ.get("APPROVAL_AUTO_PUBLISH_THRESHOLD", "70")
)

# --- AI draft generation (OpenRouter) ---
OPENROUTER_API_KEY: str = os.environ.get("OPENROUTER_API_KEY", "")
OPENROUTER_MODEL: str = os.environ.get("OPENROUTER_MODEL", "mistral-nemo")

# --- Image Generation (via ai-processor) ---
AI_PROCESSOR_URL: str = os.environ.get("AI_PROCESSOR_URL", "http://localhost:3013")
"""Minimum event impact threshold for auto-generating images (0-100). Events
at or above this threshold will have an image generated for the approval draft."""
IMAGE_GEN_IMPACT_THRESHOLD: int = int(
    os.environ.get("IMAGE_GEN_IMPACT_THRESHOLD", "80")
)
