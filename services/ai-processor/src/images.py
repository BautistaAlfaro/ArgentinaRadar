"""
Image generation endpoint for ArgentinaRadar.

Generates news-themed images using:
  - Pollinations.ai (FREE, no API key, default)
  - DALL-E 3 (OpenAI, requires API key)
  - Placeholder in local/disabled mode.

The default style ("nanobanana") uses a rich prompt template
that produces dramatic, high-contrast news thumbnails in the
NanoBanana visual style (dark blue #003087 + gold #FFD700).

Endpoint: POST /api/image/generate
"""

import urllib.parse
from typing import Any

from pydantic import BaseModel, Field

from src.config import (
    BRAND_GOLD,
    BRAND_PRIMARY,
    IMAGE_GEN_MODEL,
    IMAGE_GEN_STYLE,
    IMAGE_GEN_SIZE,
    IMAGE_PROMPT_TEMPLATE,
    IMAGE_GEN_PROVIDER,
)
from src.openai_client import BudgetExceededError, OpenAIClient


# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------


class ImageRequest(BaseModel):
    """Request payload for image generation."""

    title: str = Field(..., min_length=1, max_length=500, description="News headline to illustrate")
    style: str = Field(
        default=IMAGE_GEN_STYLE,
        pattern=r"^(nanobanana|news|minimal|flag)$",
        description="Visual style: 'nanobanana' (default), 'news', 'minimal', or 'flag'",
    )


class ImageResponse(BaseModel):
    """Response payload from image generation."""

    image_url: str | None = Field(
        description="URL of the generated image, or None in local/disabled mode",
    )
    prompt_used: str | None = Field(
        description="The full prompt sent to DALL-E, or the fallback prompt in local mode",
    )
    model: str = Field(description="Model used for generation (e.g. 'dall-e-3')")
    cost: float = Field(ge=0.0, description="Cost in USD for this generation")


# ---------------------------------------------------------------------------
# NanoBanana-style prompt builder
# ---------------------------------------------------------------------------


def build_nanobanana_prompt(title: str, style: str = "news") -> str:
    """
    Build a NanoBanana-style image generation prompt for DALL-E.

    Uses the template from ``IMAGE_PROMPT_TEMPLATE`` (configurable via env var)
    and injects the news title following the pattern:

        {template}

        Noticia a ilustrar: {title}

        Genera SOLO el prompt de imagen.

    For legacy styles ('news', 'minimal', 'flag'), falls back to a shorter
    prompt that still respects the brand color palette.

    Args:
        title: News headline to illustrate.
        style: Visual style identifier.

    Returns:
        Complete text prompt ready to send to DALL-E.
    """
    if style == "nanobanana":
        template = IMAGE_PROMPT_TEMPLATE.strip()
        return f"{template}\n\nNoticia a ilustrar: {title}\n\nGenera SOLO el prompt de imagen."

    # --- Legacy styles (backward compatible) ---
    if style == "minimal":
        style_desc = "Minimalist, clean vector art, simple shapes"
    elif style == "flag":
        style_desc = (
            "Argentine flag colors (light blue, white), "
            "patriotic theme, bold composition"
        )
    else:  # "news"
        style_desc = (
            "Professional news graphic, clean, modern, "
            "photo-realistic"
        )

    return (
        f"Argentine news illustration for: {title}\n"
        f"Style: {style_desc}\n"
        f"Colors: dark blue ({BRAND_PRIMARY}), gold ({BRAND_GOLD})\n"
        f"No text on the image\n"
        f"Aspect ratio: 1:1 (1024x1024)"
    )


def build_local_fallback_prompt(title: str) -> str:
    """
    Build a shorter prompt suitable for local / cheap image models.

    This is returned as ``prompt_used`` when DALL-E is not available so the
    caller can still log or forward the prompt to another model.

    Args:
        title: News headline to illustrate.

    Returns:
        Short fallback prompt string.
    """
    return (
        f"Professional news thumbnail. "
        f"Dark blue ({BRAND_PRIMARY}) and gold ({BRAND_GOLD}) color scheme. "
        f"Argentine flag colors. "
        f"Title: {title}. "
        f"16:9 format, photorealistic, dramatic lighting."
    )


# ---------------------------------------------------------------------------
# Pollinations.ai (FREE, no API key)
# ---------------------------------------------------------------------------

POLLINATIONS_URL = "https://image.pollinations.ai/prompt"


async def generate_pollinations_image(prompt: str, width: int = 1024, height: int = 1024) -> dict[str, Any]:
    """Generate image via Pollinations.ai (free, no API key needed)."""
    clean_prompt = (
        f"Professional news thumbnail. {prompt}. "
        f"Dark blue (#003087) and gold (#FFD700) colors. "
        f"Argentine flag theme. Dramatic lighting, photorealistic. "
        f"No text overlay."
    )
    encoded = urllib.parse.quote(clean_prompt[:500])
    image_url = f"{POLLINATIONS_URL}/{encoded}?width={width}&height={height}&nologo=true"
    return {"image_url": image_url, "prompt_used": clean_prompt[:500], "model": "pollinations.ai", "cost": 0.0}


# ---------------------------------------------------------------------------
# Run handler
# ---------------------------------------------------------------------------


async def run_image_generation(
    client: OpenAIClient,
    title: str,
    style: str = "",
) -> dict[str, Any]:
    """Generate news-themed image. Uses Pollinations.ai (FREE) by default."""
    effective_style = style or IMAGE_GEN_STYLE
    prompt = build_nanobanana_prompt(title, style=effective_style)

    # Use Pollinations.ai (free, no API key, works always)
    if IMAGE_GEN_PROVIDER == "pollinations" or not IMAGE_GEN_PROVIDER:
        return await generate_pollinations_image(prompt)

    # Fallback: try DALL-E via OpenAI client
    try:
        result = await client.generate_image(title=title, style=effective_style, prompt=prompt)
    except BudgetExceededError:
        raise
    except Exception as exc:
        raise RuntimeError(f"Image generation failed: {exc}") from exc

    return result
