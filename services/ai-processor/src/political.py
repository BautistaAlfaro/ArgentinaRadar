"""
Political Analysis Module for the AI Processor.

Provides:
  - POST /api/political/analyze
    Extract political figures and per-figure sentiment from Argentine news text.

Uses GPT-4o-mini with a specialised prompt template that returns JSON
with figure names, sentiment scores (-1.0 to 1.0), and confidence levels.

NOTE: This is currently a standalone endpoint that does NOT persist results
to any database. Persistence happens when the caller (e.g. event-detector,
trend-analyzer) stores the enriched data.
"""

import json
from typing import Any

from pydantic import BaseModel, Field

from src.openai_client import OpenAIClient

# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------


class PoliticalAnalysisRequest(BaseModel):
    text: str = Field(
        ..., min_length=1, description="Article text to analyse for political content"
    )


class PoliticalFigureSentiment(BaseModel):
    name: str = Field(..., description="Name of the political figure")
    sentiment: float = Field(
        ...,
        ge=-1.0,
        le=1.0,
        description="Sentiment score: -1.0 (completely negative) to 1.0 (completely positive)",
    )
    confidence: float = Field(
        ...,
        ge=0.0,
        le=1.0,
        description="Confidence level of the sentiment analysis",
    )


class PoliticalAnalysisResponse(BaseModel):
    figures: list[PoliticalFigureSentiment]
    summary: str = Field(
        ..., description="One-sentence summary of the political content"
    )
    tokens_used: int = Field(default=0, description="Total tokens consumed")
    cost: float = Field(default=0.0, description="Cost in USD")


# ---------------------------------------------------------------------------
# Prompt template
# ---------------------------------------------------------------------------

POLITICAL_SYSTEM_PROMPT = """You are a political analyst specialised in Argentine politics.
Analyse the given news article for political content.

Extract ALL political figures mentioned and determine the sentiment toward each one.

Rules:
- Focus ONLY on political figures (elected officials, candidates, party leaders, former officials).
- Do NOT extract non-political entities (companies, places, sports figures).
- If no political figures are found, return an empty figures array.
- The summary must be a single concise sentence in Spanish describing the political action.

Return ONLY valid JSON with no markdown, no explanation, no extra text.
Do NOT wrap in ```json blocks.

Schema:
{
  "figures": [
    {
      "name": "Full name of the political figure",
      "sentiment": -0.8,
      "confidence": 0.95
    }
  ],
  "summary": "Milei critica a Cristina en conferencia de prensa"
}

Sentiment scale:
  -1.0 = completely negative / hostile
  -0.5 = moderately negative / critical
   0.0 = neutral / factual
   0.5 = moderately positive / supportive
   1.0 = completely positive / favourable"""


# ---------------------------------------------------------------------------
# Service function
# ---------------------------------------------------------------------------


def _build_political_prompt(text: str) -> list[dict[str, str]]:
    return [
        {"role": "system", "content": POLITICAL_SYSTEM_PROMPT},
        {
            "role": "user",
            "content": (
                f"Article:\n{text}\n\n"
                "Extract political figures, sentiment, and summary as JSON. "
                "Return ONLY the JSON object, no other text."
            ),
        },
    ]


async def run_political_analysis(
    client: OpenAIClient,
    text: str,
    use_fallback: bool = False,
) -> dict[str, Any]:
    """
    Perform political analysis on the given article text.

    Returns a dict with keys: figures, summary, tokens_used, cost.
    """
    messages = _build_political_prompt(text)
    result = await client.chat_completion(messages=messages, use_fallback=use_fallback)

    content = result["content"].strip()

    # Strip markdown code fences if present
    if content.startswith("```"):
        lines = content.splitlines()
        content_lines = [
            line for line in lines if not line.strip().startswith("```")
        ]
        content = "\n".join(content_lines).strip()

    try:
        parsed = json.loads(content)
    except json.JSONDecodeError:
        # Attempt recovery by finding the first { and last }
        start = content.find("{")
        end = content.rfind("}")
        if start != -1 and end != -1:
            content = content[start : end + 1]
            try:
                parsed = json.loads(content)
            except json.JSONDecodeError:
                parsed = {"figures": [], "summary": "Error al analizar el contenido político"}
        else:
            parsed = {"figures": [], "summary": "Error al analizar el contenido político"}

    # Validate and sanitise the figures list
    raw_figures: list[dict[str, Any]] = parsed.get("figures", [])
    figures: list[dict[str, Any]] = []
    for f in raw_figures:
        name = (f.get("name") or "").strip()
        if not name:
            continue
        sentiment = float(f.get("sentiment", 0.0))
        sentiment = max(-1.0, min(1.0, sentiment))
        confidence = float(f.get("confidence", 0.5))
        confidence = max(0.0, min(1.0, confidence))
        figures.append({
            "name": name,
            "sentiment": sentiment,
            "confidence": confidence,
        })

    summary = (parsed.get("summary") or "").strip()
    if not summary:
        summary = "Análisis político completado"

    return {
        "figures": figures,
        "summary": summary,
        "tokens_used": result["tokens_used"],
        "cost": result["cost"],
    }
