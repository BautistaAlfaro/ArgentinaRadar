"""
Image generation endpoint for ArgentinaRadar.

Generates news-themed images using DALL-E 3 (OpenAI) or
returns a null placeholder in local/disabled mode.

Endpoint: POST /api/image/generate
"""

from typing import Any

from pydantic import BaseModel, Field

from src.openai_client import BudgetExceededError, OpenAIClient


# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------


class ImageRequest(BaseModel):
    """Request payload for image generation."""

    title: str = Field(..., min_length=1, max_length=500, description="News headline to illustrate")
    style: str = Field(
        default="news",
        pattern=r"^(news|minimal|flag)$",
        description="Visual style: 'news' (default), 'minimal', or 'flag'",
    )


class ImageResponse(BaseModel):
    """Response payload from image generation."""

    image_url: str | None = Field(
        description="URL of the generated image, or None in local/disabled mode",
    )
    prompt_used: str | None = Field(
        description="The full prompt sent to DALL-E, or None in local mode",
    )
    model: str = Field(description="Model used for generation (e.g. 'dall-e-3')")
    cost: float = Field(ge=0.0, description="Cost in USD for this generation")


# ---------------------------------------------------------------------------
# Run handler
# ---------------------------------------------------------------------------


async def run_image_generation(
    client: OpenAIClient,
    title: str,
    style: str = "news",
) -> dict[str, Any]:
    """
    Generate a news-themed image for a tweet.

    Args:
        client: The shared OpenAIClient instance.
        title: News headline to illustrate.
        style: Visual style ('news', 'minimal', 'flag').

    Returns:
        Dict with keys: image_url, prompt_used, model, cost.

    Raises:
        BudgetExceededError: If the daily cost cap has been hit.
        RuntimeError: If the API call fails.
    """
    try:
        result = await client.generate_image(title=title, style=style)
    except BudgetExceededError:
        raise
    except Exception as exc:
        raise RuntimeError(f"Image generation failed: {exc}") from exc

    return result
