"""
NER (Named Entity Recognition) endpoint for the AI Processor.

Extracts political entities from Argentine news articles using GPT-4o-mini
and classifies the article into a predefined category.
"""

import json
from typing import Any

from pydantic import BaseModel, Field

from src.openai_client import OpenAIClient

# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------


class NERRequest(BaseModel):
    text: str = Field(..., min_length=1, description="Article text to analyse")


class Entity(BaseModel):
    name: str
    type: str  # "person" | "place" | "organization"
    tier: int = Field(default=3, ge=1, le=3)


class NERResponse(BaseModel):
    entities: list[Entity]
    category: str
    tokens_used: int
    cost: float


# ---------------------------------------------------------------------------
# Prompt template
# ---------------------------------------------------------------------------

NER_SYSTEM_PROMPT = """You are an NER system specialised in Argentine politics and news.
Extract named entities from the given article and classify the article category.

Return ONLY valid JSON with no markdown, no explanation, no extra text.
Do NOT wrap in ```json blocks.

Schema:
{
  "entities": [
    {
      "name": "Full entity name as written (no diacritics stripping)",
      "type": "person" | "place" | "organization"
    }
  ],
  "category": "politica" | "economia" | "seguridad" | "sociedad" | "deportes" | "clima"
}

Entity tier rules (determined server-side after extraction):
- Tier 1: President, VP, ex-presidents, key cabinet ministers
- Tier 2: Governors, mayors of major cities, national senators
- Tier 3: Everyone else (local officials, deputies, private individuals, places, organizations)

Category descriptions:
- politica: Elections, government, legislation, diplomacy
- economia: Economy, finance, markets, business
- seguridad: Crime, security, police, military
- sociedad: Society, health, education, culture
- deportes: Sports
- clima: Weather, natural disasters"""

TIER_1_NAMES: set[str] = {
    "javier milei", "milei", "victoria villarruel", "villarruel",
    "patricia bullrich", "bullrich", "luis caputo", "caputo",
    "guillermo francos", "francos", "sandra pettovello", "pettovello",
    "mariano cúneo libarona", "cúneo libarona",
    "diana mondino", "mondino", "mario firmani", "firmani",
    "cristina fernández de kirchner", "cristina kirchner", "cfk",
    "mauricio macri", "macri", "alberto fernández",
    "sergio massa", "massa",
}

TIER_2_PREFIXES: set[str] = {
    "gobernador", "gobernadora", "intendente", "senador", "senadora",
    "diputado nacional", "diputada nacional",
}


def _resolve_tier(name: str, entity_type: str) -> int:
    """Determine entity tier based on name and type."""
    name_lower = name.strip().lower()

    # Tier 1: exact match against known names
    if name_lower in TIER_1_NAMES:
        return 1

    # Tier 2: persons whose name contains a tier-2 title prefix
    if entity_type == "person":
        for prefix in TIER_2_PREFIXES:
            if prefix in name_lower:
                return 2

    # Everything else is Tier 3
    return 3


# ---------------------------------------------------------------------------
# Service function
# ---------------------------------------------------------------------------


def _build_ner_prompt(text: str) -> list[dict[str, str]]:
    return [
        {"role": "system", "content": NER_SYSTEM_PROMPT},
        {
            "role": "user",
            "content": (
                f"Article:\n{text}\n\n"
                "Extract entities and category as JSON. "
                "Return ONLY the JSON object, no other text."
            ),
        },
    ]


async def run_ner(
    client: OpenAIClient,
    text: str,
    use_fallback: bool = False,
) -> dict[str, Any]:
    """
    Perform NER on the given article text.

    Returns a dict with keys: entities, category, tokens_used, cost.
    """
    messages = _build_ner_prompt(text)
    result = await client.chat_completion(messages=messages, use_fallback=use_fallback)

    # Parse JSON from the response content
    content = result["content"].strip()

    # Strip markdown code fences if present
    if content.startswith("```"):
        lines = content.splitlines()
        # Remove opening ```json or ``` and closing ```
        content_lines = [
            line for line in lines
            if not line.strip().startswith("```")
        ]
        content = "\n".join(content_lines).strip()

    try:
        parsed = json.loads(content)
    except json.JSONDecodeError:
        # If the model returns malformed JSON, attempt to recover
        # by looking for the first { and last }
        start = content.find("{")
        end = content.rfind("}")
        if start != -1 and end != -1:
            content = content[start : end + 1]
            try:
                parsed = json.loads(content)
            except json.JSONDecodeError:
                parsed = {"entities": [], "category": "sociedad"}
        else:
            parsed = {"entities": [], "category": "sociedad"}

    # Normalize entities and assign tiers
    raw_entities: list[dict[str, str]] = parsed.get("entities", [])
    entities: list[dict[str, Any]] = [
        {
            "name": e.get("name", "Unknown"),
            "type": e.get("type", "person"),
            "tier": _resolve_tier(e.get("name", ""), e.get("type", "person")),
        }
        for e in raw_entities
        if e.get("name", "").strip()
    ]

    category = parsed.get("category", "sociedad")
    valid_categories = {
        "politica", "economia", "seguridad", "sociedad", "deportes", "clima",
    }
    if category not in valid_categories:
        category = "sociedad"

    return {
        "entities": entities,
        "category": category,
        "tokens_used": result["tokens_used"],
        "cost": result["cost"],
    }
