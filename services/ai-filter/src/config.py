"""
AI Filter configuration.

Loads environment variables from the project's .env file or process environment.
"""

import os
from pathlib import Path
from dotenv import load_dotenv

# Resolve project root (services/ai-filter/src/config.py -> project root)
_PROJECT_ROOT = Path(__file__).resolve().parents[3]

# Load .env from project config directory
_dotenv_path = _PROJECT_ROOT / "config" / ".env"
if _dotenv_path.exists():
    load_dotenv(_dotenv_path)

# --- OpenRouter ---
OPENROUTER_API_KEY: str = os.environ.get("OPENROUTER_API_KEY", "")
MODEL_NAME: str = os.environ.get("MODEL_NAME", "mistralai/mistral-7b-instruct:free")
OPENROUTER_BASE_URL: str = "https://openrouter.ai/api/v1/chat/completions"

# --- Database ---
DB_PATH: str = os.environ.get(
    "DB_PATH",
    str(_PROJECT_ROOT / "data" / "argentina-radar.db"),
)

# --- Service ---
PORT: int = int(os.environ.get("PORT", "3003"))
POLL_INTERVAL: int = int(os.environ.get("POLL_INTERVAL", "60"))  # seconds
GEOLOCATION_URL: str = os.environ.get("GEOLOCATION_URL", "http://localhost:3002")
EVENT_DETECTOR_URL: str = os.environ.get("EVENT_DETECTOR_URL", "http://localhost:3008")

# --- Cost tracking ---
AI_DAILY_BUDGET: float = float(os.environ.get("AI_DAILY_BUDGET", "0.50"))
COST_PER_1K_TOKENS: float = 0.0  # Free model
