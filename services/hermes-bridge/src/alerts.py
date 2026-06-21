"""
Critical error alert system.

Monitors the system for critical conditions and sends Telegram alerts:
  1. All news sources down — no source has 'healthy' status
  2. Twitter auth expired — last tweet error indicates auth failure
  3. AI cost cap exceeded — daily budget exceeded

The alert loop runs as a background task and checks conditions
on a configurable interval (default: 60s).
"""

import asyncio
from datetime import date, datetime, timedelta

import httpx

from src.config import (
    DB_PATH,
    TELEGRAM_BOT_TOKEN,
    TELEGRAM_CHAT_ID,
    SERVICE_URLS,
    ALERT_POLL_INTERVAL,
)
from src.formatters import fmt_alert


# ---------------------------------------------------------------------------
# Condition checkers
# ---------------------------------------------------------------------------


async def _check_all_sources_down() -> str | None:
    """
    Check if all news sources are down (no 'healthy' sources).

    Returns an alert message or None if OK.
    """
    import sqlite3

    conn = sqlite3.connect(DB_PATH, uri=True)  # read-only
    conn.row_factory = sqlite3.Row
    try:
        rows = conn.execute("SELECT name, status FROM sources").fetchall()
        if not rows:
            return None  # No sources configured yet — not an error

        healthy = [r for r in rows if r["status"] == "healthy"]
        if len(healthy) == 0:
            source_names = ", ".join(r["name"] for r in rows)
            return (
                f"Todas las fuentes de noticias están caídas. "
                f"Fuentes afectadas: {source_names}"
            )
        return None
    finally:
        conn.close()


async def _check_twitter_auth_error() -> str | None:
    """
    Check the most recent tweet failure for auth-related errors.

    Returns an alert message or None if OK.
    """
    import sqlite3

    conn = sqlite3.connect(DB_PATH, uri=True)
    conn.row_factory = sqlite3.Row
    try:
        row = conn.execute(
            """SELECT error, created_at FROM tweet_history
               WHERE status IN ('failed','dead_letter')
               ORDER BY id DESC LIMIT 1"""
        ).fetchone()

        if not row:
            return None

        error = (row["error"] or "").lower()
        created_at = row["created_at"] or ""

        # Check if the error was recent (within last hour)
        if created_at:
            try:
                created_dt = datetime.fromisoformat(created_at)
                if datetime.now() - created_dt > timedelta(hours=1):
                    return None  # Stale error, not actionable
            except (ValueError, TypeError):
                pass

        # Auth-related keywords
        auth_keywords = [
            "unauthorized",
            "forbidden",
            "invalid",
            "token",
            "oauth",
            "auth",
            "credentials",
            "expired",
        ]
        if any(kw in error for kw in auth_keywords):
            return (
                f"Error de autenticación de Twitter detectado. "
                f"El último tweet falló con: {row['error'][:200]}"
            )
        return None
    finally:
        conn.close()


async def _check_ai_cost_cap() -> str | None:
    """
    Check if the AI processor daily cost cap has been exceeded.

    Returns an alert message or None if OK.
    """
    from src.config import SERVICE_URLS

    processor_url = SERVICE_URLS.get("ai-processor", "http://localhost:3013")

    try:
        async with httpx.AsyncClient(timeout=5) as client:
            resp = await client.get(f"{processor_url}/api/costs")
            if resp.status_code == 200:
                data = resp.json()
                daily_cost = data.get("daily_cost", 0.0)
                budget = float(data.get("daily_budget_cap", 2.0))

                if daily_cost >= budget:
                    return (
                        f"Límite de presupuesto de AI Processor alcanzado. "
                        f"${daily_cost:.4f} gastados hoy (límite: ${budget:.2f}). "
                        f"El procesamiento automático está pausado."
                    )
    except Exception:
        pass  # Service unreachable — skip alert

    return None


async def _check_service_health() -> str | None:
    """
    Check if any critical service is completely offline.

    Returns an alert message or None if all OK.
    """
    async with httpx.AsyncClient(timeout=5) as client:
        offline: list[str] = []
        for name, url in SERVICE_URLS.items():
            try:
                resp = await client.get(f"{url}/health")
                if resp.status_code != 200:
                    offline.append(name)
            except httpx.RequestError:
                offline.append(name)

        if len(offline) >= len(SERVICE_URLS) // 2:  # Half or more services down
            return (
                f"Múltiples servicios fuera de línea: "
                f"{', '.join(offline)}. "
                f"Verificar con pm2 status."
            )
    return None


# ---------------------------------------------------------------------------
# Telegram sender
# ---------------------------------------------------------------------------


async def _send_alert(message: str) -> bool:
    """
    Send a critical alert via Telegram Bot API.

    Returns True if sent successfully.
    """
    if not TELEGRAM_BOT_TOKEN or not TELEGRAM_CHAT_ID:
        print("[alerts] ⚠️  TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set — skipping alert")
        return False

    url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
    payload = {
        "chat_id": TELEGRAM_CHAT_ID,
        "text": fmt_alert(message),
        "parse_mode": "Markdown",
        "disable_web_page_preview": False,
    }

    async with httpx.AsyncClient(timeout=10) as client:
        try:
            resp = await client.post(url, json=payload)
            if resp.status_code != 200:
                print(f"[alerts] ⚠️  Telegram API returned {resp.status_code}: {resp.text[:200]}")
                return False
            return True
        except httpx.RequestError as exc:
            print(f"[alerts] ⚠️  Telegram request failed: {exc}")
            return False


# ---------------------------------------------------------------------------
# Cooldown tracker — avoid alert spam
# ---------------------------------------------------------------------------

_last_alerts: dict[str, datetime] = {}
_ALERT_COOLDOWN = timedelta(minutes=30)


def _should_alert(category: str) -> bool:
    """Check if enough time has passed since the last alert in this category."""
    now = datetime.now()
    last = _last_alerts.get(category)
    if last and (now - last) < _ALERT_COOLDOWN:
        return False
    _last_alerts[category] = now
    return True


# ---------------------------------------------------------------------------
# Alert loop
# ---------------------------------------------------------------------------


async def alert_loop() -> None:
    """
    Background task: periodically check system health and send alerts.

    Each alert category has a 30-minute cooldown to prevent spam.
    This loop runs as a FastAPI lifespan task (started in bridge.py).
    """
    print(f"[alerts] 🔄 Starting alert loop (interval={ALERT_POLL_INTERVAL}s)")

    while True:
        try:
            checks = [
                ("all_sources_down", _check_all_sources_down()),
                ("twitter_auth", _check_twitter_auth_error()),
                ("ai_cost_cap", _check_ai_cost_cap()),
                ("service_health", _check_service_health()),
            ]

            for category, coro in checks:
                msg = await coro
                if msg and _should_alert(category):
                    print(f"[alerts] ⚠️  Alert [{category}]: {msg[:80]}…")
                    await _send_alert(msg)

        except Exception as exc:
            print(f"[alerts] ⚠️  Error in alert loop: {exc}")

        await asyncio.sleep(ALERT_POLL_INTERVAL)
