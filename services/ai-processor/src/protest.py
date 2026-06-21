"""
Protest/Cortes Classifier for the AI Processor.

Analyses Argentine news articles to detect and classify protests,
roadblocks, marches, and other social demonstrations using GPT-4o-mini.

Types: corte_total, corte_parcial, marcha, piquete, paro, movilizacion
"""

import json
import re
from typing import Any

from pydantic import BaseModel, Field

from src.openai_client import OpenAIClient

# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------


class ProtestClassifyRequest(BaseModel):
    text: str = Field(..., min_length=1, description="Article text to classify")


class ProtestClassifyResponse(BaseModel):
    is_protest: bool
    protest_type: str | None
    route: str | None
    km: int | None
    location: str | None
    estimated_duration_hours: int | None
    confidence: float
    tokens_used: int
    cost: float


# ---------------------------------------------------------------------------
# Prompt template
# ---------------------------------------------------------------------------

PROTEST_SYSTEM_PROMPT = """You are a protest/cortes classifier specialised in Argentina.
Analyse the given article and determine if it describes an active protest,
roadblock (corte), march, picket, strike, or mobilisation.

Types:
- corte_total: Complete roadblock — both lanes blocked, no vehicle passage
- corte_parcial: Partial roadblock — vehicles can pass with difficulty
- marcha: March or demonstration through city streets
- piquete: Picket — stationary group blocking access to a facility
- paro: Strike or work stoppage
- movilizacion: Mobilisation — people gathering but not yet blocking

If the article is NOT about a protest/corte/demonstration, return:
  { "is_protest": false }

Return ONLY valid JSON with no markdown, no explanation, no extra text.
Do NOT wrap in ```json blocks.

Schema:
{
  "is_protest": true | false,
  "protest_type": "corte_total" | "corte_parcial" | "marcha" | "piquete" | "paro" | "movilizacion",
  "route": "Ruta 3" | "Ruta Nacional 7" | "Av. 9 de Julio" | "Autopista 25 de Mayo" | null,
  "km": 145 | null,
  "location": "Cañuelas" | "Microcentro" | "Puente Pueyrredón" | null,
  "estimated_duration_hours": 4 | null
}

Rules:
- route: only include if a specific route/highway/avenue is mentioned
- km: only if a kilometre marker is mentioned
- location: nearest city, neighbourhood, or landmark
- estimated_duration_hours: only if the article mentions expected or ongoing duration
- is_protest: must be false if the article does NOT describe an active protest"""


# ---------------------------------------------------------------------------
# Service function
# ---------------------------------------------------------------------------


def _build_protest_prompt(text: str) -> list[dict[str, str]]:
    return [
        {"role": "system", "content": PROTEST_SYSTEM_PROMPT},
        {
            "role": "user",
            "content": (
                f"Article:\n{text}\n\n"
                "Analyse this article for protest/corte content. "
                "Return ONLY the JSON object, no other text."
            ),
        },
    ]


async def run_protest_classify(
    client: OpenAIClient,
    text: str,
    use_fallback: bool = False,
) -> dict[str, Any]:
    """
    Classify article text for protest/corte content.

    Returns a dict with keys: is_protest, protest_type, route, km,
    location, estimated_duration_hours, confidence, tokens_used, cost.
    """
    messages = _build_protest_prompt(text)
    result = await client.chat_completion(messages=messages, use_fallback=use_fallback)

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
                parsed = {"is_protest": False}
        else:
            parsed = {"is_protest": False}

    is_protest = bool(parsed.get("is_protest", False))

    if not is_protest:
        return {
            "is_protest": False,
            "protest_type": None,
            "route": None,
            "km": None,
            "location": None,
            "estimated_duration_hours": None,
            "confidence": 0.0,
            "tokens_used": result["tokens_used"],
            "cost": result["cost"],
        }

    protest_type = parsed.get("protest_type")
    valid_types = {
        "corte_total", "corte_parcial", "marcha",
        "piquete", "paro", "movilizacion",
    }
    if protest_type not in valid_types:
        protest_type = "marcha"

    route = parsed.get("route")
    km_raw = parsed.get("km")
    km = int(km_raw) if km_raw is not None else None
    location = parsed.get("location")
    duration_raw = parsed.get("estimated_duration_hours")
    estimated_duration_hours = int(duration_raw) if duration_raw is not None else None

    # Determine confidence based on clarity of extraction
    confidence = 0.0
    raw_confidence = parsed.get("confidence")
    if raw_confidence is not None:
        try:
            confidence = float(raw_confidence)
        except (ValueError, TypeError):
            pass
    if confidence <= 0:
        # Heuristic fallback
        if protest_type and route:
            confidence = 0.85
        elif protest_type:
            confidence = 0.70
        else:
            confidence = 0.50

    confidence = max(0.0, min(1.0, confidence))

    return {
        "is_protest": True,
        "protest_type": protest_type,
        "route": route,
        "km": km,
        "location": location,
        "estimated_duration_hours": estimated_duration_hours,
        "confidence": round(confidence, 2),
        "tokens_used": result["tokens_used"],
        "cost": result["cost"],
    }
