"""
Security Category Classifier for the AI Processor.

Classifies Argentine news articles into security-related categories
using GPT-4o-mini. Supports categories: robo, homicidio, narcotrafico,
corrupcion, secuestro, estafa, violencia_genero.
"""

import json
from typing import Any

from pydantic import BaseModel, Field

from src.config import LOCAL_MODELS
from src.openai_client import OpenAIClient

# Local model for security classification — simple 7-category, fast model is fine
_SECURITY_LOCAL_MODEL: str = LOCAL_MODELS.get("fast", "gemma3:4b")

# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------


class SecurityClassifyRequest(BaseModel):
    text: str = Field(..., min_length=1, description="Article text to classify")


class SecurityClassifyResponse(BaseModel):
    security_category: str
    confidence: float
    tokens_used: int
    cost: float


# ---------------------------------------------------------------------------
# Prompt template
# ---------------------------------------------------------------------------

SECURITY_SYSTEM_PROMPT = """You are a security news classifier specialised in Argentina.
Analyse the given article and classify it into ONE of these security categories.

Categories:
- robo: Theft, robbery, burglary, hijacking, assault with theft
- homicidio: Murder, homicide, assassination, killing
- narcotrafico: Drug trafficking, narcotics, cartels, drug trade
- corrupcion: Corruption, bribery, embezzlement, graft, fraud by officials
- secuestro: Kidnapping, abduction, hostage-taking, missing persons
- estafa: Scam, fraud, swindle, financial fraud, phishing, con artistry
- violencia_genero: Gender violence, domestic violence, femicide, sexual assault

If the article is NOT about security/crime at all, return:
  { "security_category": "none", "confidence": 0.0 }

Return ONLY valid JSON with no markdown, no explanation, no extra text.
Do NOT wrap in ```json blocks.

Schema:
{
  "security_category": "robo" | "homicidio" | "narcotrafico" | "corrupcion" | "secuestro" | "estafa" | "violencia_genero" | "none",
  "confidence": 0.0-1.0
}

Confidence:
- 0.9-1.0: Clear match with specific details matching the category
- 0.7-0.89: Probable match, some indicators present
- 0.5-0.69: Possible match, ambiguous or brief mention
- 0.0: No match (security_category must be "none")"""


# ---------------------------------------------------------------------------
# Service function
# ---------------------------------------------------------------------------


def _build_security_prompt(text: str) -> list[dict[str, str]]:
    return [
        {"role": "system", "content": SECURITY_SYSTEM_PROMPT},
        {
            "role": "user",
            "content": (
                f"Article:\n{text}\n\n"
                "Classify this article into a security category. "
                "Return ONLY the JSON object, no other text."
            ),
        },
    ]


async def run_security_classify(
    client: OpenAIClient,
    text: str,
    use_fallback: bool = False,
) -> dict[str, Any]:
    """
    Classify article text into a security category.

    Returns a dict with keys: security_category, confidence, tokens_used, cost.
    """
    messages = _build_security_prompt(text)
    result = await client.chat_completion(
        messages=messages,
        use_fallback=use_fallback,
        local_model=_SECURITY_LOCAL_MODEL,
    )

    content = result["content"].strip()

    # Strip markdown code fences if present
    if content.startswith("```"):
        lines = content.splitlines()
        content_lines = [
            line for line in lines
            if not line.strip().startswith("```")
        ]
        content = "\n".join(content_lines).strip()

    try:
        parsed = json.loads(content)
    except json.JSONDecodeError:
        start = content.find("{")
        end = content.rfind("}")
        if start != -1 and end != -1:
            content = content[start: end + 1]
            try:
                parsed = json.loads(content)
            except json.JSONDecodeError:
                parsed = {"security_category": "none", "confidence": 0.0}
        else:
            parsed = {"security_category": "none", "confidence": 0.0}

    security_category = parsed.get("security_category", "none")
    confidence = float(parsed.get("confidence", 0.0))

    valid_categories = {
        "robo", "homicidio", "narcotrafico", "corrupcion",
        "secuestro", "estafa", "violencia_genero", "none",
    }
    if security_category not in valid_categories:
        security_category = "none"
        confidence = 0.0

    # Clamp confidence
    confidence = max(0.0, min(1.0, confidence))

    return {
        "security_category": security_category,
        "confidence": round(confidence, 2),
        "tokens_used": result["tokens_used"],
        "cost": result["cost"],
    }
