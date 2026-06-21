"""
Telegram message formatters for Hermes bot integration.

All formatters return plain text strings that are safe for Telegram
(max 4096 characters per message). For long responses, a "truncated"
message is returned with a note.
"""

from typing import Any

# Telegram message limit
MAX_MSG_LEN = 4096


def fmt_status(
    services: dict[str, Any],
    quota: dict[str, int],
    ai_cost: dict[str, Any],
    article_counts: dict[str, int],
) -> str:
    """
    Format a /radar status response.

    Args:
        services: Dict with 'sources' list and optionally external service health.
        quota: Twitter quota info (used, limit, remaining, month).
        ai_cost: AI filter cost info (daily_cost, daily_tokens, cap_exceeded, etc.).
        article_counts: Article counts (total, published, pending, etc.).

    Returns:
        Telegram-formatted status string.
    """
    lines: list[str] = ["📡 *ArgentinaRadar — Estado del Sistema*", ""]

    # ── Services ──────────────────────────────────────────────────
    lines.append("*Servicios:*")

    # External services from health checks
    svc = services.get("health", {})
    svc_names = {
        "news-ingestion": "📰 News Ingestion",
        "geolocation": "📍 Geolocalización",
        "ai-filter": "🤖 AI Filter",
        "twitter-publisher": "🐦 Twitter Publisher",
    }

    all_online = True
    for key, label in svc_names.items():
        status = svc.get(key, {}).get("status", "unknown")
        if status == "ok":
            lines.append(f"  🟢 {label}")
        else:
            lines.append(f"  🔴 {label}")
            all_online = False

    # Data sources from sources table
    src_list = services.get("sources", [])
    healthy = sum(1 for s in src_list if s.get("status") == "healthy")
    degraded = sum(1 for s in src_list if s.get("status") in ("degraded", "error"))
    lines.append(
        f"  └ Fuentes de noticias: {len(src_list)} total, "
        f"{'🟢' if healthy == len(src_list) else '🟡'} {healthy} activas"
        + (f", {degraded} degradadas" if degraded else "")
    )

    lines.append("")

    # ── Twitter Quota ─────────────────────────────────────────────
    lines.append("*Twitter:*")
    pct = round((quota["used"] / quota["limit"]) * 100, 1) if quota["limit"] else 0
    bars = "▓" * int(pct / 10) + "░" * (10 - int(pct / 10))
    lines.append(f"  {bars} {quota['used']}/{quota['limit']} ({quota['remaining']} restantes)")
    lines.append("")

    # ── AI Filter Cost ────────────────────────────────────────────
    budget = ai_cost.get("daily_budget_cap", 0.50)
    cost = ai_cost.get("daily_cost", 0.0)
    cost_pct = round((cost / budget) * 100, 1) if budget else 0
    cost_bars = "▓" * int(cost_pct / 10) + "░" * (10 - int(cost_pct / 10))
    lines.append(f"*AI Filter:* ${cost:.4f} / ${budget:.2f} hoy")
    lines.append(f"  {cost_bars} ({cost_pct}%)")
    if ai_cost.get("cap_exceeded"):
        lines.append("  ⛔ *Límite de presupuesto alcanzado — pausado*")
    lines.append("")

    # ── Article Counts ────────────────────────────────────────────
    lines.append("*Artículos:*")
    lines.append(f"  📥 Total: {article_counts.get('total', 0)}")
    lines.append(f"  📝 Pendientes: {article_counts.get('pending', 0)}")
    lines.append(f"  ✅ Publicados: {article_counts.get('published', 0)}")
    lines.append(f"  ⏭️  Descartados: {article_counts.get('discarded', 0)}")
    lines.append(f"  📊 Hoy: {article_counts.get('ingested_today', 0)} ingestados, "
                 f"{article_counts.get('published_today', 0)} publicados")

    result = "\n".join(lines)

    if len(result) > MAX_MSG_LEN:
        result = result[: MAX_MSG_LEN - 100] + "\n\n… (mensaje truncado)"

    return result


def fmt_news_list(articles: list[dict[str, Any]], limit: int) -> str:
    """
    Format a list of latest articles for /radar news.

    Args:
        articles: List of article dicts with id, title, source, etc.
        limit: Number of articles requested.

    Returns:
        Telegram-formatted article list.
    """
    if not articles:
        return "📭 *No hay artículos disponibles.*"

    lines: list[str] = [f"📰 *Últimas {len(articles)} noticias:*", ""]

    for i, a in enumerate(articles, 1):
        title = a.get("title", "Sin título")
        source = a.get("source", "")
        location = _extract_location_str(a)
        status_icon = _status_icon(a.get("status", ""))
        category = a.get("category", "")

        lines.append(f"*{i}.* {status_icon} {title}")
        parts = []
        if source:
            parts.append(f"📡 {source}")
        if category:
            parts.append(f"🏷️ {category}")
        if location:
            parts.append(f"📍 {location}")
        if parts:
            lines.append(f"   {' · '.join(parts)}")
        lines.append(f"   `{a.get('id', '')[:8]}…` │ Estado: {a.get('status', '?')}")
        lines.append("")

    result = "\n".join(lines).strip()

    if len(result) > MAX_MSG_LEN:
        result = result[: MAX_MSG_LEN - 100] + "\n\n… (mensaje truncado)"

    return result


def fmt_stats(stats: dict[str, Any]) -> str:
    """
    Format daily/weekly statistics for /radar stats.

    Args:
        stats: Dict with 'daily' and 'weekly' stat dicts.

    Returns:
        Telegram-formatted stats string.
    """
    daily = stats.get("daily", {})
    weekly = stats.get("weekly", {})

    lines: list[str] = [
        "📊 *ArgentinaRadar — Estadísticas*",
        "",
        "*Hoy:*",
        f"  📥 Ingestados: {daily.get('ingested', 0)}",
        f"  ✅ Filtrados (publicar): {daily.get('filtered_publish', 0)}",
        f"  ⏭️  Filtrados (descartar): {daily.get('filtered_discard', 0)}",
        f"  🐦 Tweets publicados: {daily.get('tweets_posted', 0)}",
        f"  ❌ Errores: {daily.get('errors', 0)}",
        "",
        "*Últimos 7 días:*",
        f"  📥 Ingestados: {weekly.get('ingested', 0)}",
        f"  ✅ Filtrados (publicar): {weekly.get('filtered_publish', 0)}",
        f"  ⏭️  Filtrados (descartar): {weekly.get('filtered_discard', 0)}",
        f"  🐦 Tweets publicados: {weekly.get('tweets_posted', 0)}",
        f"  ❌ Errores: {weekly.get('errors', 0)}",
    ]

    result = "\n".join(lines)

    if len(result) > MAX_MSG_LEN:
        result = result[: MAX_MSG_LEN - 100] + "\n\n… (mensaje truncado)"

    return result


def fmt_tweet_notification(
    headline: str, source: str, location: str | None, link: str
) -> str:
    """
    Format a tweet-published notification.

    Pattern: 🐦 Publicado: {headline} — {source} 📍{location} 🔗{link}
    """
    location_part = f" 📍{location}" if location else ""
    return (
        f"🐦 *Publicado:* {headline} — {source}"
        f"{location_part}"
        f" 🔗{link}"
    )


def fmt_alert(message: str) -> str:
    """
    Format a critical error alert.

    Pattern: ⚠️ CRITICAL: {error_message}
    """
    return f"⚠️ *CRÍTICO:* {message}"


def fmt_override_result(action: str, success: bool, article_id: str, reason: str) -> str:
    """
    Format the result of a manual override command.
    """
    if success:
        emoji = "✅" if action == "publish" else "⏭️"
        msg = f"{emoji} Artículo `{article_id[:8]}…` marcado como *{action}ado*"
        if reason:
            msg += f"\n   Razón: {reason}"
        return msg
    else:
        return f"❌ Artículo no encontrado: `{article_id[:8]}…`"


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _extract_location_str(article: dict[str, Any]) -> str | None:
    """Extract a human-readable location string from an article."""
    raw_loc = article.get("location")
    if raw_loc and isinstance(raw_loc, str):
        try:
            import json
            loc = json.loads(raw_loc)
        except (json.JSONDecodeError, TypeError):
            return None
        city = loc.get("city") or loc.get("province")
        return city if city else None
    return None


def _status_icon(status: str) -> str:
    """Map article status to an emoji icon."""
    mapping: dict[str, str] = {
        "published": "✅",
        "publish_forced": "✅",
        "filtered": "📋",
        "geolocated": "📍",
        "ingested": "📥",
        "discarded": "⏭️",
        "skipped": "⏭️",
    }
    return mapping.get(status, "❓")
