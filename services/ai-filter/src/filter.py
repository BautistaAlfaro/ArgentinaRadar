"""
AI article filter logic.

Orchestrates the evaluation pipeline: builds a prompt, calls the LLM
via model_router, parses the response, enforces the combined-score threshold,
and persists the verdict to the shared SQLite database.
"""

import json
import sqlite3
from typing import Any

import httpx

from src.config import DB_PATH, EVENT_DETECTOR_URL
from src.model_router import query_llm, ModelRouterError
from src.prompts import build_prompt
from src.cost_tracker import CostTracker


class AIFilter:
    """
    Evaluates news articles using an LLM and stores structured verdicts.

    The filter supports a configurable budget cap via CostTracker.
    """

    def __init__(self, cost_tracker: CostTracker | None = None) -> None:
        self.cost_tracker = cost_tracker or CostTracker()

    # ------------------------------------------------------------------
    # Database
    # ------------------------------------------------------------------

    def _get_db(self) -> sqlite3.Connection:
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode = WAL")
        return conn

    # ------------------------------------------------------------------
    # Single article evaluation
    # ------------------------------------------------------------------

    async def evaluate(
        self,
        article_id: str,
        title: str,
        summary: str,
        source: str,
        category: str,
    ) -> dict[str, Any]:
        """
        Evaluate a single article and persist the verdict.

        Args:
            article_id: UUID of the article in news_items.
            title: Article headline.
            summary: Article summary text.
            source: Source name (e.g. "clarin").
            category: Article category.

        Returns:
            A dict with verdict, reason, scores, combined, and token usage.
        """
        prompt = build_prompt(title, summary, source, category)

        # --- Call LLM ---
        try:
            result = await query_llm(prompt)
        except ModelRouterError as exc:
            return self._build_error_result(article_id, str(exc))
        except Exception as exc:
            return self._build_error_result(article_id, f"Unexpected error: {exc}")

        # --- Extract token usage (popped so it doesn't pollute scores) ---
        tokens: dict[str, int] = result.pop("_tokens", {"prompt": 0, "completion": 0, "total": 0})

        # --- Parse scores ---
        scores = {
            "political": int(result.get("political", 0)),
            "economic": int(result.get("economic", 0)),
            "social": int(result.get("social", 0)),
            "urgency": int(result.get("urgency", 0)),
        }
        combined = sum(scores.values())
        verdict = str(result.get("verdict", "DISCARD")).upper()
        reason = str(result.get("reason", ""))

        # --- Enforce threshold ---
        if combined >= 15 and verdict != "PUBLISH":
            verdict = "PUBLISH"
            reason = reason or f"Combined score {combined} meets ≥15 threshold"
        elif combined < 15 and verdict != "DISCARD":
            verdict = "DISCARD"
            reason = reason or f"Combined score {combined} is below 15 threshold"

        # --- Track cost ---
        self.cost_tracker.log_evaluation(
            tokens.get("prompt", 0), tokens.get("completion", 0)
        )

        # --- Build structured score ---
        ai_score: dict[str, Any] = {
            "publish": verdict == "PUBLISH",
            "reasoning": reason,
            "political": scores["political"],
            "economic": scores["economic"],
            "social": scores["social"],
            "urgency": scores["urgency"],
            "combined": combined,
        }

        # --- Persist to DB ---
        status = "filtered" if verdict == "PUBLISH" else "discarded"
        conn = self._get_db()
        try:
            conn.execute(
                "UPDATE news_items SET ai_score = ?, status = ? WHERE id = ?",
                (json.dumps(ai_score, ensure_ascii=False), status, article_id),
            )
            conn.commit()
        finally:
            conn.close()

        # --- Push PUBLISH articles to event-detector for event clustering ---
        if verdict == "PUBLISH":
            await self._push_to_event_detector(article_id, title, summary, source)

        return {
            "article_id": article_id,
            "verdict": verdict,
            "reason": reason,
            "scores": scores,
            "combined": combined,
            "tokens": tokens,
        }

    # ------------------------------------------------------------------
    # Event-detector push
    # ------------------------------------------------------------------

    async def _push_to_event_detector(
        self,
        article_id: str,
        title: str,
        summary: str,
        source: str,
    ) -> None:
        """
        Push a PUBLISH-verdict article to the event-detector service.

        Reads the article's URL, published_at, embedding, and entities from
        the database so the event-detector has enough context for clustering.
        Errors are logged but never propagated — the filter pipeline is not
        blocked by a downstream service being down.
        """
        conn = self._get_db()
        try:
            row = conn.execute(
                """SELECT url, published_at, embedding, entities
                   FROM news_items WHERE id = ?""",
                (article_id,),
            ).fetchone()
        finally:
            conn.close()

        if not row:
            print(f"[filter] ⚠️  article {article_id[:8]}… not found in DB, skipping event-detector push")
            return

        payload: dict[str, Any] = {
            "article_id": article_id,
            "title": title,
            "summary": summary,
            "source": source,
            "url": row["url"] or "",
            "publishedAt": row["published_at"] or "",
        }

        # Attach embedding if available (JSON array stored as TEXT)
        embedding_raw = row["embedding"]
        if embedding_raw:
            try:
                payload["embedding"] = json.loads(embedding_raw)
            except (json.JSONDecodeError, TypeError):
                pass

        # Attach entities if available (JSON array stored as TEXT)
        entities_raw = row["entities"]
        if entities_raw:
            try:
                payload["entities"] = json.loads(entities_raw)
            except (json.JSONDecodeError, TypeError):
                pass

        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.post(
                    f"{EVENT_DETECTOR_URL}/api/detect",
                    json=payload,
                )
            if resp.status_code != 200:
                print(
                    f"[filter] ⚠️  event-detector returned {resp.status_code} "
                    f"for article {article_id[:8]}…"
                )
        except httpx.RequestError as exc:
            print(
                f"[filter] ⚠️  event-detector unreachable for article "
                f"{article_id[:8]}…: {exc}"
            )

    # ------------------------------------------------------------------
    # Batch / queue processing
    # ------------------------------------------------------------------

    async def process_queue(self) -> list[dict[str, Any]]:
        """
        Process all pending articles (status = 'geolocated').

        Respects the daily cost cap — returns early if exceeded.

        Returns:
            A list of evaluation result dicts.
        """
        # Check cost cap first
        if self.cost_tracker.is_cap_exceeded():
            print("[filter] ⛔ Daily cost cap exceeded — skipping evaluations")
            return [{"error": "daily_cost_cap_exceeded"}]

        conn = self._get_db()
        try:
            rows = conn.execute(
                """SELECT id, title, summary, source, category
                   FROM news_items
                   WHERE status = 'geolocated'
                   LIMIT 20"""
            ).fetchall()
        finally:
            conn.close()

        results: list[dict[str, Any]] = []
        for row in rows:
            # Re-check cap between evaluations
            if self.cost_tracker.is_cap_exceeded():
                print("[filter] ⛔ Cost cap hit mid-queue — stopping")
                results.append({"error": "daily_cost_cap_exceeded", "article_id": row["id"]})
                break

            eval_result = await self.evaluate(
                article_id=row["id"],
                title=row["title"],
                summary=row["summary"] or "",
                source=row["source"],
                category=row["category"] or "",
            )
            results.append(eval_result)

        return results

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _build_error_result(
        self, article_id: str, error: str
    ) -> dict[str, Any]:
        """Return a DISCARD result with error info."""
        ai_score = json.dumps(
            {
                "publish": False,
                "reasoning": error,
                "political": 0,
                "economic": 0,
                "social": 0,
                "urgency": 0,
                "combined": 0,
            },
            ensure_ascii=False,
        )

        conn = self._get_db()
        try:
            conn.execute(
                "UPDATE news_items SET ai_score = ?, status = 'discarded' WHERE id = ?",
                (ai_score, article_id),
            )
            conn.commit()
        finally:
            conn.close()

        return {
            "article_id": article_id,
            "verdict": "DISCARD",
            "reason": error,
            "scores": {"political": 0, "economic": 0, "social": 0, "urgency": 0},
            "combined": 0,
            "tokens": {"prompt": 0, "completion": 0, "total": 0},
            "error": True,
        }
