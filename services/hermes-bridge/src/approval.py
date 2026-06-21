"""
Telegram approval workflow for ArgentinaRadar tweet drafts.

Architecture:
  Polls the event-detector service for moderate-impact events (50–69),
  generates tweet drafts, sends them to Telegram for human approval,
  and handles the callback flow (approve / reject / edit / schedule).

Status lifecycle (news_items):
  … → event → pending_approval → published | discarded

Flow:
  Event detected (impact 50–69)
    → Draft generated
    → approval_queue entry created (status='pending')
    → Telegram message with inline keyboard:
        [✅ Aprobar] [❌ Descartar]
        [✏️ Editar]  [⏰ Programar]
    → Human clicks button
    → Callback processed:
        ✅ → twitter-publisher publishes draft → status='published'
        ❌ → news_items status='discarded'
        ✏️ → ask user for new text → publish with edited text
        ⏰ → mark for scheduled publish (future work)
"""

import asyncio
import json
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Any, Literal

import httpx

from src.config import (
    AI_PROCESSOR_URL,
    APPROVAL_AUTO_PUBLISH_THRESHOLD,
    APPROVAL_EVENT_POLL_INTERVAL,
    APPROVAL_POLL_INTERVAL,
    DB_PATH,
    EVENT_DETECTOR_URL,
    IMAGE_GEN_IMPACT_THRESHOLD,
    TELEGRAM_BOT_TOKEN,
    TELEGRAM_CHAT_ID,
    TWITTER_PUBLISHER_URL,
)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_ACTION_APPROVE = "approve"
_ACTION_APPROVE_IMG = "approve_img"
_ACTION_APPROVE_TEXT = "approve_text"
_ACTION_REJECT = "reject"
_ACTION_EDIT = "edit"
_ACTION_SCHEDULE = "schedule"

_STATE_FILE = Path(__file__).resolve().parent / ".approval_state.json"

# Conversation state for edit flow: maps Telegram user_id -> pending edit info
_edit_conversations: dict[int, dict[str, Any]] = {}

# Known callback IDs processed this session (avoid re-processing on restart)
_processed_callbacks: set[str] = set()

# ---------------------------------------------------------------------------
# State persistence (last polled event timestamp)
# ---------------------------------------------------------------------------


def _load_state() -> dict[str, Any]:
    """Load the last-seen event timestamp from disk."""
    if _STATE_FILE.exists():
        try:
            return json.loads(_STATE_FILE.read_text())
        except (json.JSONDecodeError, ValueError):
            return {}
    return {}


def _save_state(**kwargs: Any) -> None:
    """Persist state so we don't re-process events after restart."""
    state = _load_state()
    state.update(kwargs)
    state["updated_at"] = datetime.now().isoformat()
    _STATE_FILE.write_text(json.dumps(state, indent=2))


# ---------------------------------------------------------------------------
# Database helpers
# ---------------------------------------------------------------------------


def _get_writable_conn() -> sqlite3.Connection:
    """Open a read-write SQLite connection."""
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def _ensure_approval_table() -> None:
    """Create the approval_queue table if it doesn't exist."""
    conn = _get_writable_conn()
    try:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS approval_queue (
                id                   TEXT PRIMARY KEY,
                article_id           TEXT NOT NULL,
                event_id             TEXT,
                draft_tweet          TEXT NOT NULL,
                status               TEXT DEFAULT 'pending',  -- pending | approved | rejected | edited | scheduled
                telegram_message_id  INTEGER,
                telegram_chat_id     TEXT,
                reviewed_by          TEXT,
                reviewed_at          TEXT,
                edited_text          TEXT,
                image_url            TEXT,
                image_prompt         TEXT,
                created_at           TEXT DEFAULT (datetime('now')),
                FOREIGN KEY (article_id) REFERENCES news_items(id)
            );

            CREATE INDEX IF NOT EXISTS idx_approval_queue_status
                ON approval_queue(status);

            CREATE INDEX IF NOT EXISTS idx_approval_queue_article
                ON approval_queue(article_id);
        """)

        # Migration: add columns for existing databases (ignore if already present)
        try:
            conn.execute("ALTER TABLE approval_queue ADD COLUMN image_url TEXT")
        except Exception:
            pass  # Column already exists
        try:
            conn.execute("ALTER TABLE approval_queue ADD COLUMN image_prompt TEXT")
        except Exception:
            pass  # Column already exists

        conn.commit()
    finally:
        conn.close()


def _get_pending_articles() -> list[dict[str, Any]]:
    """
    Find news_items that have reached 'event' status but are NOT yet
    in the approval_queue and still have no tweet_id.
    """
    conn = _get_writable_conn()
    try:
        rows = conn.execute("""
            SELECT ni.id, ni.title, ni.summary, ni.source, ni.sources,
                   ni.url, ni.category, ni.location, ni.ai_score
            FROM news_items ni
            WHERE ni.status IN ('filtered', 'pending_approval')
              AND ni.tweet_id IS NULL
              AND ni.id NOT IN (
                  SELECT article_id FROM approval_queue
              )
            ORDER BY ni.ingested_at DESC
        """).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def _upsert_approval_entry(
    entry_id: str,
    article_id: str,
    event_id: str | None,
    draft_tweet: str,
    image_url: str | None = None,
    image_prompt: str | None = None,
) -> None:
    """Insert or update an approval_queue entry."""
    conn = _get_writable_conn()
    try:
        conn.execute(
            """INSERT INTO approval_queue (id, article_id, event_id, draft_tweet, image_url, image_prompt)
               VALUES (?, ?, ?, ?, ?, ?)
               ON CONFLICT(id) DO UPDATE SET
                   draft_tweet = excluded.draft_tweet,
                   image_url = COALESCE(excluded.image_url, image_url),
                   image_prompt = COALESCE(excluded.image_prompt, image_prompt),
                   status = 'pending'""",
            (entry_id, article_id, event_id, draft_tweet, image_url, image_prompt),
        )
        conn.commit()
    finally:
        conn.close()


def _update_approval_status(
    entry_id: str,
    status: str,
    reviewed_by: str | None = None,
    edited_text: str | None = None,
) -> bool:
    """Update the status of an approval_queue entry. Returns True if found."""
    conn = _get_writable_conn()
    try:
        cur = conn.execute(
            """UPDATE approval_queue
               SET status = ?,
                   reviewed_by = COALESCE(?, reviewed_by),
                   reviewed_at = datetime('now'),
                   edited_text = COALESCE(?, edited_text)
               WHERE id = ?""",
            (status, reviewed_by, edited_text, entry_id),
        )
        conn.commit()
        return cur.rowcount > 0
    finally:
        conn.close()


def _mark_article_status(article_id: str, status: str) -> bool:
    """Update a news_item's status. Returns True if found."""
    conn = _get_writable_conn()
    try:
        cur = conn.execute(
            "UPDATE news_items SET status = ? WHERE id = ?",
            (status, article_id),
        )
        conn.commit()
        return cur.rowcount > 0
    finally:
        conn.close()


def _get_approval_by_telegram_msg(
    message_id: int,
) -> dict[str, Any] | None:
    """Look up an approval_queue entry by Telegram message ID."""
    conn = _get_writable_conn()
    try:
        row = conn.execute(
            "SELECT * FROM approval_queue WHERE telegram_message_id = ?",
            (message_id,),
        ).fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def _set_telegram_msg_id(entry_id: str, message_id: int, chat_id: str) -> None:
    """Store the Telegram message ID for an approval entry."""
    conn = _get_writable_conn()
    try:
        conn.execute(
            "UPDATE approval_queue SET telegram_message_id = ?, telegram_chat_id = ? WHERE id = ?",
            (message_id, chat_id, entry_id),
        )
        conn.commit()
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Image generation (via ai-processor)
# ---------------------------------------------------------------------------


async def _generate_image_for_event(
    title: str,
    style: str = "news",
) -> tuple[str | None, str | None]:
    """
    Generate a news-themed image for a tweet draft.

    Calls the ai-processor's image generation endpoint. Returns
    (image_url, prompt_used) or (None, None) on failure / if not available.

    Args:
        title: News headline to illustrate.
        style: Visual style ('news', 'minimal', 'flag').

    Returns:
        Tuple of (image_url | None, prompt_used | None).
    """
    if not AI_PROCESSOR_URL:
        return None, None

    url = f"{AI_PROCESSOR_URL}/api/image/generate"
    async with httpx.AsyncClient(timeout=30) as client:
        try:
            resp = await client.post(
                url,
                json={"title": title, "style": style},
                headers={"Content-Type": "application/json"},
            )
            if resp.status_code == 200:
                data = resp.json()
                return data.get("image_url"), data.get("prompt_used")
            else:
                print(
                    f"[approval] ⚠️  Image generation failed: HTTP {resp.status_code}"
                )
                return None, None
        except httpx.RequestError as exc:
            print(f"[approval] ⚠️  Image generation request failed: {exc}")
            return None, None


# ---------------------------------------------------------------------------
# Telegram API helpers
# ---------------------------------------------------------------------------


async def _telegram_request(
    method: str,
    payload: dict[str, Any],
) -> dict[str, Any] | None:
    """
    Make a request to the Telegram Bot API.
    Returns parsed JSON result or None on failure.
    """
    if not TELEGRAM_BOT_TOKEN:
        print("[approval] ⚠️  TELEGRAM_BOT_TOKEN not set — skipping Telegram request")
        return None

    url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/{method}"
    async with httpx.AsyncClient(timeout=15) as client:
        try:
            resp = await client.post(url, json=payload)
            data = resp.json()
            if not data.get("ok"):
                print(
                    f"[approval] ⚠️  Telegram API error ({method}): "
                    f"{data.get('description', resp.text[:200])}"
                )
                return None
            return data.get("result")
        except httpx.RequestError as exc:
            print(f"[approval] ⚠️  Telegram request failed ({method}): {exc}")
            return None


async def send_approval_request(
    article_id: str,
    event_id: str | None,
    draft: str,
    article_title: str,
    article_url: str = "",
) -> int | None:
    """
    Send a tweet draft to Telegram with inline keyboard for approval.
    Text-only version (no image).

    Returns the Telegram message_id on success, None on failure.
    """
    keyboard = {
        "inline_keyboard": [
            [
                {"text": "✅ Aprobar", "callback_data": f"{_ACTION_APPROVE}:{article_id}"},
                {"text": "❌ Descartar", "callback_data": f"{_ACTION_REJECT}:{article_id}"},
            ],
            [
                {"text": "✏️ Editar", "callback_data": f"{_ACTION_EDIT}:{article_id}"},
                {"text": "⏰ Programar", "callback_data": f"{_ACTION_SCHEDULE}:{article_id}"},
            ],
        ]
    }

    text = (
        f"📝 *Propuesta de tweet*\n\n"
        f"{draft}\n\n"
        f"📰 {article_title}\n"
        f"{'🔗 ' + article_url if article_url else ''}\n\n"
        f"Revisá y decidí:"
    )

    result = await _telegram_request("sendMessage", {
        "chat_id": TELEGRAM_CHAT_ID,
        "text": text,
        "parse_mode": "Markdown",
        "reply_markup": keyboard,
        "disable_web_page_preview": False,
    })

    if result:
        msg_id = result.get("message_id")
        chat_id = str(result["chat"]["id"])
        return msg_id
    return None


async def send_approval_request_with_image(
    article_id: str,
    event_id: str | None,
    draft: str,
    article_title: str,
    image_url: str,
    article_url: str = "",
    image_prompt: str | None = None,
) -> int | None:
    """
    Send a tweet draft WITH image preview to Telegram for approval.

    The image is sent as a photo with the draft text as caption,
    plus inline keyboard with image-toggle options.
    When available, the generated DALL-E prompt is shown below for review.

    Returns the Telegram message_id on success, None on failure.
    """
    keyboard = {
        "inline_keyboard": [
            [
                {"text": "🖼️ Con imagen", "callback_data": f"{_ACTION_APPROVE_IMG}:{article_id}"},
                {"text": "📝 Solo texto", "callback_data": f"{_ACTION_APPROVE_TEXT}:{article_id}"},
            ],
            [
                {"text": "❌ Descartar", "callback_data": f"{_ACTION_REJECT}:{article_id}"},
                {"text": "✏️ Editar", "callback_data": f"{_ACTION_EDIT}:{article_id}"},
            ],
        ]
    }

    prompt_section = (
        f"\n\n🎨 *Prompt usado:*\n`{image_prompt[:200]}…`"
        if image_prompt
        else ""
    )

    caption = (
        f"📝 *Propuesta con imagen*\n\n"
        f"{draft}\n\n"
        f"📰 {article_title}\n"
        f"{'🔗 ' + article_url if article_url else ''}"
        f"{prompt_section}\n\n"
        f"Elegí si publicar con imagen o solo texto:"
    )

    result = await _telegram_request("sendPhoto", {
        "chat_id": TELEGRAM_CHAT_ID,
        "photo": image_url,
        "caption": caption,
        "parse_mode": "Markdown",
        "reply_markup": keyboard,
    })

    if result:
        msg_id = result.get("message_id")
        return msg_id
    return None


async def edit_telegram_message(
    chat_id: str,
    message_id: int,
    new_text: str,
    reply_markup: dict[str, Any] | None = None,
) -> bool:
    """Edit an existing Telegram message (e.g. to show approval result)."""
    payload: dict[str, Any] = {
        "chat_id": chat_id,
        "message_id": message_id,
        "text": new_text,
        "parse_mode": "Markdown",
    }
    if reply_markup is not None:
        payload["reply_markup"] = reply_markup

    result = await _telegram_request("editMessageText", payload)
    return result is not None


async def answer_callback_query(callback_id: str, text: str = "") -> bool:
    """Acknowledge a callback query (removes loading indicator on the button)."""
    result = await _telegram_request("answerCallbackQuery", {
        "callback_query_id": callback_id,
        "text": text,
    })
    return result is not None


async def send_telegram_reply(
    chat_id: str,
    text: str,
    reply_to_message_id: int | None = None,
) -> dict[str, Any] | None:
    """Send a simple reply message to Telegram."""
    payload: dict[str, Any] = {
        "chat_id": chat_id,
        "text": text,
        "parse_mode": "Markdown",
    }
    if reply_to_message_id:
        payload["reply_to_message_id"] = reply_to_message_id

    return await _telegram_request("sendMessage", payload)


# ---------------------------------------------------------------------------
# Draft generation
# ---------------------------------------------------------------------------


def _generate_draft_from_event(event: dict[str, Any]) -> str:
    """
    Generate a tweet draft from event data using a template.

    Format:
      🇦🇷 {title} | Reportado por {N} medios | Impacto: {score}/100 #ArgentinaRadar

    Falls within 280-char Twitter limit.
    """
    title = event.get("title", "").strip()
    source_count = len(event.get("sources", [])) or event.get("articleCount", 1)
    impact = event.get("impact", 0)

    suffix = f" | Reportado por {source_count} medios | Impacto: {impact}/100 #ArgentinaRadar"
    prefix = "🇦🇷 "

    max_title = 280 - len(prefix) - len(suffix)
    if max_title <= 0:
        # Extreme case: suffix alone is too long
        return f"{prefix}{title[:200]}… #ArgentinaRadar"

    truncated = title if len(title) <= max_title else title[: max_title - 1] + "…"
    return f"{prefix}{truncated}{suffix}"


async def _generate_draft_with_ai(event: dict[str, Any]) -> str | None:
    """
    Attempt to generate a tweet draft using OpenRouter (free model).

    Falls back to template-based draft on failure.
    """
    from src.config import OPENROUTER_API_KEY, OPENROUTER_MODEL

    if not OPENROUTER_API_KEY:
        return None

    title = event.get("title", "")
    summary = event.get("summary", "") or title
    source_count = len(event.get("sources", [])) or event.get("articleCount", 1)
    impact = event.get("impact", 0)

    prompt = (
        f"Generá un tweet en español (máx 280 caracteres) sobre esta noticia argentina:\n\n"
        f"Título: {title}\n"
        f"Resumen: {summary[:300]}\n"
        f"Cantidad de medios reportando: {source_count}\n"
        f"Impacto: {impact}/100\n\n"
        f"Formato sugerido:\n"
        f"🇦🇷 [Título llamativo] | Reportado por {source_count} medios | Impacto: {impact}/100\n\n"
        f"Incluí el hashtag #ArgentinaRadar al final. NO incluyas comillas ni etiquetas."
    )

    async with httpx.AsyncClient(timeout=20) as client:
        try:
            resp = await client.post(
                "https://openrouter.ai/api/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {OPENROUTER_API_KEY}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": OPENROUTER_MODEL,
                    "messages": [{"role": "user", "content": prompt}],
                    "max_tokens": 120,
                    "temperature": 0.7,
                },
            )
            data = resp.json()
            draft = (
                data.get("choices", [{}])[0]
                .get("message", {})
                .get("content", "")
                .strip()
                .strip('"')
            )
            if draft and len(draft) <= 280:
                return draft
        except Exception as exc:
            print(f"[approval] ⚠️  AI draft generation failed: {exc}")

    return None


async def generate_draft(event: dict[str, Any]) -> str:
    """
    Generate the best possible tweet draft for an event.

    Tries AI first, falls back to template.
    """
    draft = await _generate_draft_with_ai(event)
    if draft:
        return draft
    return _generate_draft_from_event(event)


# ---------------------------------------------------------------------------
# Event polling
# ---------------------------------------------------------------------------


async def _fetch_trending_events() -> list[dict[str, Any]]:
    """
    Fetch trending events from the event-detector service.

    Returns events with impact >= 50 (the event-detector filter).
    """
    if not EVENT_DETECTOR_URL:
        print("[approval] ⚠️  EVENT_DETECTOR_URL not set — can't poll for events")
        return []

    url = f"{EVENT_DETECTOR_URL}/api/events/trending"
    async with httpx.AsyncClient(timeout=10) as client:
        try:
            resp = await client.get(url)
            data = resp.json()
            return data.get("events", [])
        except httpx.RequestError as exc:
            print(f"[approval] ⚠️  Event-detector unreachable: {exc}")
            return []
        except (json.JSONDecodeError, KeyError) as exc:
            print(f"[approval] ⚠️  Invalid response from event-detector: {exc}")
            return []


def _load_processed_event_ids() -> set[str]:
    """Load the set of event IDs we've already processed."""
    state = _load_state()
    return set(state.get("processed_event_ids", []))


def _save_processed_event_ids(event_ids: set[str]) -> None:
    """Save the set of processed event IDs."""
    _save_state(processed_event_ids=sorted(event_ids))


# ---------------------------------------------------------------------------
# Callback processing
# ---------------------------------------------------------------------------


async def _process_callback(
    callback_id: str,
    chat_id: str,
    message_id: int,
    data: str,
    from_user: dict[str, Any] | None,
) -> None:
    """
    Process a single Telegram callback query.

    data format: "{action}:{article_id}"
    """
    if callback_id in _processed_callbacks:
        return  # Already processed
    _processed_callbacks.add(callback_id)

    try:
        action, article_id = data.split(":", 1)
    except ValueError:
        print(f"[approval] ⚠️  Invalid callback data: {data}")
        await answer_callback_query(callback_id, "❌ Datos inválidos")
        return

    # Look up the approval entry by article_id
    conn = _get_writable_conn()
    try:
        entry = conn.execute(
            "SELECT * FROM approval_queue WHERE article_id = ? ORDER BY created_at DESC LIMIT 1",
            (article_id,),
        ).fetchone()
    finally:
        conn.close()

    if not entry:
        print(f"[approval] ⚠️  No approval entry for article {article_id[:8]}…")
        await answer_callback_query(callback_id, "❌ Entrada no encontrada")
        await edit_telegram_message(
            chat_id, message_id,
            "❌ *Entrada no encontrada* — el artículo ya no está en la cola de aprobación.",
        )
        return

    entry = dict(entry)
    entry_id = entry["id"]
    draft = entry.get("edited_text") or entry["draft_tweet"]
    reviewer = from_user.get("username") or from_user.get("first_name", "unknown") if from_user else "unknown"

    if action == _ACTION_APPROVE:
        await _handle_approve(entry_id, article_id, draft, chat_id, message_id, reviewer, callback_id)

    elif action == _ACTION_APPROVE_IMG:
        # Approve WITH image
        image_url = entry.get("image_url")
        await _handle_approve(
            entry_id, article_id, draft, chat_id, message_id, reviewer,
            callback_id, image_url=image_url,
        )

    elif action == _ACTION_APPROVE_TEXT:
        # Approve WITHOUT image (image was generated but user chose text-only)
        await _handle_approve(entry_id, article_id, draft, chat_id, message_id, reviewer, callback_id)

    elif action == _ACTION_REJECT:
        await _handle_reject(entry_id, article_id, chat_id, message_id, reviewer, callback_id)

    elif action == _ACTION_EDIT:
        await _handle_edit(article_id, chat_id, message_id, callback_id, from_user)

    elif action == _ACTION_SCHEDULE:
        await _handle_schedule(entry_id, chat_id, message_id, callback_id)

    else:
        print(f"[approval] ⚠️  Unknown action: {action}")
        await answer_callback_query(callback_id, "❌ Acción desconocida")


async def _handle_approve(
    entry_id: str,
    article_id: str,
    draft: str,
    chat_id: str,
    message_id: int,
    reviewer: str,
    callback_id: str,
    image_url: str | None = None,
) -> None:
    """Approve a draft: publish via twitter-publisher, update DB."""
    img_label = " 🖼️" if image_url else ""
    print(f"[approval] ✅ Approving article {article_id[:8]}… by @{reviewer}{img_label}")

    # Call twitter-publisher to publish the draft (with optional image)
    success, error_msg = await _publish_draft(article_id, draft, image_url=image_url)

    if success:
        _update_approval_status(entry_id, "approved", reviewed_by=reviewer)
        _mark_article_status(article_id, "published")

        await edit_telegram_message(
            chat_id, message_id,
            f"✅ *Aprobado por @{reviewer}* ✅\n\n{draft}\n\n_El tweet se publicó correctamente._",
            reply_markup={"inline_keyboard": []},  # Remove buttons
        )
        await answer_callback_query(callback_id, "✅ ¡Tweet publicado!")
    else:
        await edit_telegram_message(
            chat_id, message_id,
            f"⚠️ *Error al publicar*\n\n{draft}\n\n_Error: {error_msg}_",
        )
        await answer_callback_query(callback_id, f"❌ Error: {error_msg[:50]}")


async def _handle_reject(
    entry_id: str,
    article_id: str,
    chat_id: str,
    message_id: int,
    reviewer: str,
    callback_id: str,
) -> None:
    """Reject a draft: mark article as discarded."""
    print(f"[approval] ❌ Rejecting article {article_id[:8]}… by @{reviewer}")

    _update_approval_status(entry_id, "rejected", reviewed_by=reviewer)
    _mark_article_status(article_id, "discarded")

    await edit_telegram_message(
        chat_id, message_id,
        f"❌ *Descartado por @{reviewer}* ❌\n\n_El artículo fue marcado como descartado._",
        reply_markup={"inline_keyboard": []},
    )
    await answer_callback_query(callback_id, "❌ Artículo descartado")


async def _handle_edit(
    article_id: str,
    chat_id: str,
    message_id: int,
    callback_id: str,
    from_user: dict[str, Any] | None,
) -> None:
    """
    Handle edit request: ask the user to send the new tweet text.

    We store the conversation state so the next message from this user
    is treated as the edited text.
    """
    user_id = from_user.get("id") if from_user else None
    if not user_id:
        await answer_callback_query(callback_id, "❌ No se pudo identificar al usuario")
        return

    print(f"[approval] ✏️ Edit requested for article {article_id[:8]}… by user {user_id}")

    # Store conversation state
    _edit_conversations[user_id] = {
        "article_id": article_id,
        "chat_id": chat_id,
        "original_message_id": message_id,
    }

    await edit_telegram_message(
        chat_id, message_id,
        "✏️ *Editando tweet*\n\n"
        "Enviamé el nuevo texto del tweet (máx 280 caracteres) "
        "y lo voy a publicar automáticamente.",
        reply_markup={"inline_keyboard": []},
    )
    await answer_callback_query(callback_id, "✏️ Enviamé el nuevo texto")


async def _handle_schedule(
    entry_id: str,
    chat_id: str,
    message_id: int,
    callback_id: str,
) -> None:
    """Schedule a tweet for later publishing (placeholder for future)."""
    _update_approval_status(entry_id, "scheduled")
    await edit_telegram_message(
        chat_id, message_id,
        "⏰ *Programado*\n\n"
        "El tweet se va a publicar en el próximo ciclo programado. "
        "(Funcionalidad en desarrollo)",
        reply_markup={"inline_keyboard": []},
    )
    await answer_callback_query(callback_id, "⏰ Programado")


async def _handle_edit_reply(
    user_id: int,
    chat_id: str,
    text: str,
    reply_to_message_id: int | None = None,
) -> None:
    """
    Process a user's reply text as the edited tweet draft.

    Called when we receive a message from a user who has an active
    edit conversation.
    """
    conv = _edit_conversations.pop(user_id, None)
    if not conv:
        return

    article_id = conv["article_id"]
    original_msg_id = conv["original_message_id"]

    # Truncate to Twitter limit
    edited_text = text.strip()[:280]

    print(f"[approval] ✏️ Edit received for article {article_id[:8]}…: {edited_text[:60]}…")

    # Look up the approval entry
    conn = _get_writable_conn()
    try:
        entry = conn.execute(
            "SELECT id FROM approval_queue WHERE article_id = ? ORDER BY created_at DESC LIMIT 1",
            (article_id,),
        ).fetchone()
    finally:
        conn.close()

    if not entry:
        await send_telegram_reply(
            chat_id,
            "❌ No encontré la propuesta original. Puede que ya haya sido procesada.",
            reply_to_message_id=reply_to_message_id,
        )
        return

    entry_id = dict(entry)["id"]

    # Publish with edited text
    success, error_msg = await _publish_draft(article_id, edited_text)

    if success:
        _update_approval_status(entry_id, "edited", edited_text=edited_text)
        _mark_article_status(article_id, "published")

        await edit_telegram_message(
            chat_id, original_msg_id,
            f"✏️ *Editado y publicado* ✏️\n\n{edited_text}\n\n_El tweet editado se publicó correctamente._",
        )
        await send_telegram_reply(
            chat_id,
            "✅ *¡Tweet publicado con tu texto!* ✅\n\n"
            f"{edited_text}",
            reply_to_message_id=reply_to_message_id,
        )
    else:
        # Put the conversation back so they can retry
        _edit_conversations[user_id] = conv
        await send_telegram_reply(
            chat_id,
            f"❌ *Error al publicar*: {error_msg[:200]}\n\n"
            f"Enviamé el texto de nuevo o usá /cancel para salir.",
            reply_to_message_id=reply_to_message_id,
        )


# ---------------------------------------------------------------------------
# Publish via twitter-publisher
# ---------------------------------------------------------------------------


async def _publish_draft(
    article_id: str,
    text: str,
    image_url: str | None = None,
) -> tuple[bool, str]:
    """
    Publish a tweet draft by calling the twitter-publisher service.

    Args:
        article_id: UUID of the article.
        text: Tweet text to publish.
        image_url: Optional URL of a generated image to attach.

    Returns (success: bool, error_message: str).
    """
    if not TWITTER_PUBLISHER_URL:
        return False, "TWITTER_PUBLISHER_URL not configured"

    url = f"{TWITTER_PUBLISHER_URL}/api/publish-text"
    body: dict[str, object] = {"article_id": article_id, "text": text}
    if image_url:
        body["image_url"] = image_url

    async with httpx.AsyncClient(timeout=60) as client:
        try:
            resp = await client.post(url, json=body)
            if resp.status_code == 200:
                return True, ""
            else:
                error_detail = resp.text[:200]
                return False, f"HTTP {resp.status_code}: {error_detail}"
        except httpx.RequestError as exc:
            return False, f"Connection failed: {exc}"


# ---------------------------------------------------------------------------
# Telegram update polling (for callback queries)
# ---------------------------------------------------------------------------


async def _poll_telegram_updates(offset: int | None = None) -> tuple[list[dict[str, Any]], int | None]:
    """
    Poll Telegram for new updates (callback queries and messages).

    Returns (updates, new_offset).
    """
    payload: dict[str, Any] = {
        "timeout": 10,
        "allowed_updates": ["callback_query", "message"],
    }
    if offset is not None:
        payload["offset"] = offset

    result = await _telegram_request("getUpdates", payload)
    if not result:
        return [], offset

    updates = result if isinstance(result, list) else []
    new_offset = offset

    for update in updates:
        update_id = update.get("update_id", 0)
        new_offset = max(new_offset or 0, update_id + 1)

    return updates, new_offset


# ---------------------------------------------------------------------------
# Main approval loop
# ---------------------------------------------------------------------------


async def _send_approvals_for_events(events: list[dict[str, Any]]) -> None:
    """
    Process a list of events from the event-detector:
    - Generate drafts for events in the approval range (50 to threshold-1)
    - For high-impact events (>= IMAGE_GEN_IMPACT_THRESHOLD), generate image
    - Send them to Telegram for approval
    """
    processed = _load_processed_event_ids()
    threshold = APPROVAL_AUTO_PUBLISH_THRESHOLD

    for event in events:
        event_id = event.get("id", "")
        impact = event.get("impact", 0)

        # Skip if already processed
        if event_id in processed:
            continue

        # Auto-publish: impact >= threshold (handled by twitter-publisher)
        if impact >= threshold:
            processed.add(event_id)
            continue

        # Too low impact: not worth publishing
        if impact < 50:
            processed.add(event_id)
            continue

        # Approval range: 50 <= impact < threshold
        # Find associated articles
        articles = event.get("articles", [])
        if not articles:
            # Use event title as fallback
            article_id = event_id
            title = event.get("title", "Sin título")
        else:
            article_id = articles[0].get("id", event_id) if isinstance(articles[0], dict) else event_id
            title = event.get("title", "Sin título")

        # Generate draft
        draft = await generate_draft(event)

        # ── Image generation for high-impact events ───────────────
        image_url: str | None = None
        image_prompt: str | None = None
        should_generate_image = (
            impact >= IMAGE_GEN_IMPACT_THRESHOLD
        )
        if should_generate_image:
            print(
                f"[approval] 🎨 Generating image for impact={impact} event "
                f"'{title[:50]}…'"
            )
            image_url, image_prompt = await _generate_image_for_event(
                title=title, style="news",
            )
            if image_url:
                print(f"[approval] 🖼️  Image generated: {image_url[:80]}…")
            else:
                print("[approval] ℹ️  No image generated (local mode or failure)")

        # Create approval entry
        entry_id = f"app_{event_id[:8]}_{datetime.now().strftime('%Y%m%d%H%M%S')}"
        _upsert_approval_entry(
            entry_id, article_id, event_id, draft,
            image_url=image_url, image_prompt=image_prompt,
        )

        # Also update news_items status to pending_approval
        _mark_article_status(article_id, "pending_approval")

        # Send to Telegram (with or without image)
        article_url = ""
        if articles and isinstance(articles[0], dict):
            article_url = articles[0].get("url", "")

        if image_url:
            msg_id = await send_approval_request_with_image(
                article_id=article_id,
                event_id=event_id,
                draft=draft,
                article_title=title,
                image_url=image_url,
                article_url=article_url,
                image_prompt=image_prompt,
            )
        else:
            msg_id = await send_approval_request(
                article_id=article_id,
                event_id=event_id,
                draft=draft,
                article_title=title,
                article_url=article_url,
            )

        if msg_id:
            _set_telegram_msg_id(entry_id, msg_id, str(TELEGRAM_CHAT_ID))
            print(f"[approval] 📤 Sent approval request for {title[:60]}… (msg_id={msg_id})")

        processed.add(event_id)

    # Persist processed IDs
    _save_processed_event_ids(processed)


async def _process_telegram_updates() -> None:
    """
    Poll Telegram for new updates and process callback queries and messages.
    """
    state = _load_state()
    offset = state.get("telegram_update_offset")

    updates, new_offset = await _poll_telegram_updates(offset)

    if new_offset is not None and new_offset != offset:
        _save_state(telegram_update_offset=new_offset)

    for update in updates:
        # Process callback queries (button presses)
        cb = update.get("callback_query")
        if cb:
            cb_id = cb.get("id", "")
            msg = cb.get("message", {})
            chat_id = str(msg.get("chat", {}).get("id", ""))
            message_id = msg.get("message_id", 0)
            data = cb.get("data", "")
            from_user = cb.get("from")

            if chat_id and message_id and data:
                await _process_callback(
                    callback_id=cb_id,
                    chat_id=chat_id,
                    message_id=message_id,
                    data=data,
                    from_user=from_user,
                )
            continue

        # Process regular messages (for edit replies)
        msg = update.get("message")
        if msg:
            user_id = msg.get("from", {}).get("id")
            chat_id = str(msg.get("chat", {}).get("id", ""))
            text = msg.get("text", "")
            reply_to = msg.get("message_id")

            if user_id and text and user_id in _edit_conversations:
                await _handle_edit_reply(
                    user_id=user_id,
                    chat_id=chat_id,
                    text=text,
                    reply_to_message_id=reply_to,
                )


async def approval_loop() -> None:
    """
    Background task: poll for new approval_queue entries AND events.
    
    Two-phase loop:
      1. Poll approval_queue for pending articles (every APPROVAL_POLL_INTERVAL)
      2. Poll event-detector for new events (every APPROVAL_EVENT_POLL_INTERVAL)
      3. Poll Telegram for callback updates (every APPROVAL_POLL_INTERVAL)
    """
    _ensure_approval_table()

    print(f"[approval] 🔄 Starting approval loop "
          f"(event_poll={APPROVAL_EVENT_POLL_INTERVAL}s, "
          f"telegram_poll={APPROVAL_POLL_INTERVAL}s)")

    event_tick = 0

    while True:
        try:
            # Phase 1: Check for pending approval_queue entries (every tick)
            await _send_pending_queue_approvals()

            # Phase 2: Poll for new events every event_poll interval
            if event_tick <= 0:
                events = await _fetch_trending_events()
                if events:
                    print(f"[approval] 📡 Found {len(events)} trending events")
                    await _send_approvals_for_events(events)
                event_tick = APPROVAL_EVENT_POLL_INTERVAL

            # Phase 3: Poll Telegram for callbacks every tick
            await _process_telegram_updates()

        except Exception as exc:
            print(f"[approval] ⚠️  Error in approval loop: {exc}")
            import traceback
            traceback.print_exc()

        await asyncio.sleep(APPROVAL_POLL_INTERVAL)
        event_tick -= APPROVAL_POLL_INTERVAL


async def _send_pending_queue_approvals() -> None:
    """Check approval_queue for pending entries and send to Telegram."""
    try:
        conn = _get_read_conn()
        pending = conn.execute(
            "SELECT id, article_id, draft_tweet, image_url, image_prompt "
            "FROM approval_queue "
            "WHERE status = 'pending' AND telegram_message_id IS NULL "
            "LIMIT 5"
        ).fetchall()
        
        if not pending:
            return
            
        print(f"[approval] 📨 Sending {len(pending)} pending approvals to Telegram")
        
        for entry in pending:
            entry_id, article_id, draft_tweet, image_url, image_prompt = entry
            
            # Build inline keyboard
            keyboard = {
                "inline_keyboard": [[
                    {"text": "✅ Aprobar", "callback_data": f"approve:{article_id}"},
                    {"text": "❌ Descartar", "callback_data": f"reject:{article_id}"},
                ]]
            }
            
            # Get article title for context
            article = conn.execute(
                "SELECT title, source FROM news_items WHERE id = ?", (article_id,)
            ).fetchone()
            
            title = article[0] if article else "Noticia"
            source = article[1] if article else "Desconocido"
            
            caption = (
                f"📰 *{title[:200]}*\n\n"
                f"📝 *Draft:* {draft_tweet[:300]}\n\n"
                f"📌 Fuente: {source}"
            )
            
            try:
                result = await _telegram_request("sendMessage", {
                    "chat_id": TELEGRAM_CHAT_ID,
                    "text": caption,
                    "parse_mode": "Markdown",
                    "reply_markup": keyboard,
                })
                
                if result.get("ok") and result.get("result", {}).get("message_id"):
                    msg_id = result["result"]["message_id"]
                    _set_telegram_msg_id(entry_id, msg_id, str(TELEGRAM_CHAT_ID))
                    print(f"[approval] ✅ Sent approval for {article_id[:8]} → msg {msg_id}")
            except Exception as e:
                print(f"[approval] ⚠️ Failed to send approval for {article_id[:8]}: {e}")
                
    except Exception as exc:
        print(f"[approval] ⚠️ Error in _send_pending_queue_approvals: {exc}")
