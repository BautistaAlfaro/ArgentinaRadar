"""
Prompt templates for AI relevance scoring of Argentine news articles.

The system evaluates articles across four dimensions and returns a
structured JSON verdict: PUBLISH or DISCARD.

Ported from services/ai-filter/src/prompts.py
"""


def build_prompt(title: str, summary: str, source: str, category: str) -> str:
    """
    Build the evaluation prompt for a news article.

    Args:
        title: Article headline.
        summary: Article summary (max 500 chars).
        source: Source identifier (e.g. "clarin", "infobae").
        category: Article category (politica, economia, sociedad, deportes).

    Returns:
        A complete prompt string ready to send to the LLM.
    """
    return f"""Evaluate this news article for ArgentinaRadar audience relevance.

Article: {title} - {summary}
Source: {source}
Category: {category}

Score each dimension 0-10:
- Political importance (national impact, policy changes, government actions)
- Economic impact (markets, inflation, employment, trade)
- Social relevance (affects daily life, public interest)
- Urgency (breaking news, time-sensitive)

Return JSON: {{"political": N, "economic": N, "social": N, "urgency": N, "verdict": "PUBLISH"|"DISCARD", "reason": "brief explanation"}}

Threshold: combined score >= 15 = PUBLISH
Reject: clickbait, duplicates, low-quality sources, pure entertainment
"""
