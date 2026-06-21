"""
AI Processor configuration.

Loads environment variables from the project's .env file or process environment.
"""

import os
from pathlib import Path
from dotenv import load_dotenv

# Resolve project root (services/ai-processor/src/config.py -> project root)
_PROJECT_ROOT = Path(__file__).resolve().parents[3]

# Load .env from project config directory
_dotenv_path = _PROJECT_ROOT / "config" / ".env"
if _dotenv_path.exists():
    load_dotenv(_dotenv_path)

# --- API Keys ---
OPENAI_API_KEY: str = os.environ.get("OPENAI_API_KEY", "")
OPENROUTER_API_KEY: str = os.environ.get("OPENROUTER_API_KEY", "")

# --- AI Mode ---
# "local"  → All inference via Ollama (zero cost, no API keys required)
# "openai" → All inference via OpenAI / OpenRouter APIs (existing behavior)
# "hybrid" → Local by default, falls back to OpenAI on failure
AI_MODE: str = os.environ.get("AI_MODE", "local")

# --- Local Models (Ollama) ---
# Each model is configurable via env vars for easy experimentation.
OLLAMA_BASE_URL: str = os.environ.get(
    "OLLAMA_BASE_URL", "http://localhost:11434/v1"
)
LOCAL_MODELS: dict[str, str] = {
    "fast": os.environ.get("LOCAL_MODEL_FAST", "gemma3:4b"),
    "smart": os.environ.get("LOCAL_MODEL_SMART", "qwen2.5:7b"),
    "embed": os.environ.get("LOCAL_MODEL_EMBED", "nomic-embed-text"),
}

# --- Provider Configuration ---
# Default provider: "openai" or "openrouter"
AI_PROVIDER: str = os.environ.get("AI_PROVIDER", "openai")
OPENAI_BASE_URL: str = os.environ.get("OPENAI_BASE_URL", "https://api.openai.com/v1")
OPENROUTER_BASE_URL: str = os.environ.get(
    "OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1"
)

# --- Database (optional — for the filter endpoint) ---
DB_PATH: str = os.environ.get(
    "DB_PATH",
    str(_PROJECT_ROOT / "data" / "argentina-radar.db"),
)

# --- Models ---
# Note: EMBEDDING_MODEL and EMBEDDING_DIMENSIONS keep their original OpenAI
# defaults (text-embedding-3-small, 1536d) even in local/hybrid mode because
# the Ollama path uses LOCAL_MODELS["embed"] directly. This ensures the paid
# API fallback path in hybrid mode always uses the correct OpenAI model.
NER_MODEL: str = os.environ.get("NER_MODEL", "gpt-4o-mini")
FILTER_MODEL: str = os.environ.get("FILTER_MODEL", "gpt-4o-mini")
EMBEDDING_MODEL: str = os.environ.get(
    "EMBEDDING_MODEL", "text-embedding-3-small"
)
FALLBACK_MODEL: str = os.environ.get(
    "FALLBACK_MODEL", "google/gemini-2.0-flash-lite-preview-02-05:free"
)

# --- Embedding dimensions ---
# text-embedding-3-small → 1536d. nomic-embed-text → 768d (handled in OllamaClient)
EMBEDDING_DIMENSIONS: int = int(os.environ.get("EMBEDDING_DIMENSIONS", "1536"))

# --- Service ---
PORT: int = int(os.environ.get("PORT", "3010"))

# --- Cost tracking ---
DAILY_BUDGET: float = float(os.environ.get("DAILY_BUDGET", "2.00"))

# --- Model Pricing (USD per 1M tokens) ---
# gpt-4o-mini
NER_INPUT_PRICE_PER_1M: float = float(
    os.environ.get("NER_INPUT_PRICE_PER_1M", "0.150")
)
NER_OUTPUT_PRICE_PER_1M: float = float(
    os.environ.get("NER_OUTPUT_PRICE_PER_1M", "0.600")
)

# text-embedding-3-small
EMBEDDING_PRICE_PER_1M: float = float(
    os.environ.get("EMBEDDING_PRICE_PER_1M", "0.020")
)

# Gemini Flash via OpenRouter (fallback)
FALLBACK_INPUT_PRICE_PER_1M: float = float(
    os.environ.get("FALLBACK_INPUT_PRICE_PER_1M", "0.075")
)
FALLBACK_OUTPUT_PRICE_PER_1M: float = float(
    os.environ.get("FALLBACK_OUTPUT_PRICE_PER_1M", "0.300")
)

# --- Rate limiting ---
RATE_LIMIT_RPM: int = int(os.environ.get("RATE_LIMIT_RPM", "10"))

# --- Batch limits ---
MAX_BATCH_SIZE: int = int(os.environ.get("MAX_BATCH_SIZE", "20"))

# --- Image Generation (DALL-E) ---
IMAGE_GEN_ENABLED: bool = os.environ.get("IMAGE_GEN_ENABLED", "true").lower() == "true"
IMAGE_GEN_MODEL: str = os.environ.get("IMAGE_GEN_MODEL", "dall-e-3")
IMAGE_GEN_SIZE: str = os.environ.get("IMAGE_GEN_SIZE", "1024x1024")
IMAGE_GEN_QUALITY: str = os.environ.get("IMAGE_GEN_QUALITY", "standard")
IMAGE_GEN_COST_STANDARD: float = float(os.environ.get("IMAGE_GEN_COST_STANDARD", "0.04"))
IMAGE_GEN_COST_HD: float = float(os.environ.get("IMAGE_GEN_COST_HD", "0.08"))
"""Minimum event impact threshold for image generation (0-100)."""
IMAGE_GEN_IMPACT_THRESHOLD: int = int(os.environ.get("IMAGE_GEN_IMPACT_THRESHOLD", "80"))

# --- NanoBanana / Brand Image Generation ---
# Full prompt template for NanoBanana-style image generation.
# Configurable via env var — defaults to the NanoBanana news-thumbnail template.
_DEFAULT_NANOBANANA_TEMPLATE = """Eres un experto en crear prompts para generacion de imagenes con estilo NanoBanana.

Crea un prompt detallado y optimizado para generar un thumbnail de noticia en estilo:
- Mezcla entre "Only Fonseca" (YouTube): dramatico, alto contraste, impactante, estilo noticiero fuerte.
- MDZ Online / noticiero argentino profesional: limpio, moderno y periodistico.

Caracteristicas obligatorias del estilo:
- Formato horizontal 16:9 (thumbnail YouTube/X)
- Alta calidad fotorealista, iluminacion cinematografica dramatica
- Alto contraste y colores saturados
- Usar siempre la paleta de colores: azul oscuro intenso (#003087) y amarillo oro (#FFD700) como colores principales
- Tipografia bold grande y legible (estilo news)
- Fondo oscuro o degradado profesional usando azul oscuro y amarillo oro
- Composicion fuerte: rostros grandes y expresivos si hay personas mencionadas
- Si la noticia menciona personas especificas (ej: Milei, Adorni, etc.), incluir representaciones muy fieles de sus rostros.

Reglas importantes:
- Incluir siempre un titulo o texto grande en la imagen con el tema principal de la noticia (en espanol)
- Agregar sutiles elementos graficos de noticia (banda roja "ULTIMO MOMENTO" o similar, lineas, etc.)
- Mantener coherencia visual con la marca: azul y amarillo predominantes.

Genera SOLO el prompt de imagen, sin explicaciones extras."""

IMAGE_PROMPT_TEMPLATE: str = os.environ.get(
    "IMAGE_PROMPT_TEMPLATE",
    _DEFAULT_NANOBANANA_TEMPLATE,
)
"""Default image generation prompt style. 'nanobanana' uses the NanoBanana
template; legacy values 'news', 'minimal', and 'flag' are still supported."""
IMAGE_GEN_STYLE: str = os.environ.get("IMAGE_GEN_STYLE", "nanobanana")

# --- Brand Colors ---
BRAND_PRIMARY: str = os.environ.get("BRAND_PRIMARY", "#003087")
BRAND_GOLD: str = os.environ.get("BRAND_GOLD", "#FFD700")
