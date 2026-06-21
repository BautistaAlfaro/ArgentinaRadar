"""
Cost tracker for OpenRouter LLM evaluations.

Tracks token usage per evaluation, calculates cost based on model pricing,
logs daily/monthly spend to SQLite, and enforces a configurable daily budget cap.
"""

import sqlite3
from datetime import date
from typing import Any

from src.config import (
    DB_PATH,
    COST_PER_1K_TOKENS,
    AI_DAILY_BUDGET,
)


class CostTracker:
    """
    Tracks API costs for OpenRouter evaluations.

    Uses the shared SQLite database (ai_filter_costs table) for persistence.
    """

    def __init__(self) -> None:
        self._init_table()

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _get_db(self) -> sqlite3.Connection:
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_table(self) -> None:
        conn = self._get_db()
        try:
            conn.executescript("""
                CREATE TABLE IF NOT EXISTS ai_filter_costs (
                    id               INTEGER PRIMARY KEY AUTOINCREMENT,
                    date             TEXT    NOT NULL,
                    prompt_tokens    INTEGER NOT NULL DEFAULT 0,
                    completion_tokens INTEGER NOT NULL DEFAULT 0,
                    total_tokens     INTEGER NOT NULL DEFAULT 0,
                    cost             REAL    NOT NULL DEFAULT 0.0,
                    month            TEXT    NOT NULL,
                    created_at       TEXT    NOT NULL DEFAULT (datetime('now'))
                );

                CREATE INDEX IF NOT EXISTS idx_costs_date ON ai_filter_costs(date);
                CREATE INDEX IF NOT EXISTS idx_costs_month ON ai_filter_costs(month);
            """)
            conn.commit()
        finally:
            conn.close()

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def log_evaluation(self, prompt_tokens: int, completion_tokens: int) -> None:
        """
        Record a single LLM evaluation's token usage and cost.

        Args:
            prompt_tokens: Number of tokens in the prompt.
            completion_tokens: Number of tokens in the completion.
        """
        total_tokens = prompt_tokens + completion_tokens
        cost = (total_tokens / 1000.0) * COST_PER_1K_TOKENS
        today = date.today().isoformat()
        month = today[:7]  # YYYY-MM

        conn = self._get_db()
        try:
            conn.execute(
                """INSERT INTO ai_filter_costs (date, prompt_tokens, completion_tokens, total_tokens, cost, month)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                (today, prompt_tokens, completion_tokens, total_tokens, cost, month),
            )
            conn.commit()
        finally:
            conn.close()

    def get_daily_cost(self, day: str | None = None) -> float:
        """Return total cost for a given date (default: today)."""
        day = day or date.today().isoformat()
        conn = self._get_db()
        try:
            row = conn.execute(
                "SELECT COALESCE(SUM(cost), 0) as total FROM ai_filter_costs WHERE date = ?",
                (day,),
            ).fetchone()
            return float(row["total"]) if row else 0.0
        finally:
            conn.close()

    def get_monthly_cost(self, month: str | None = None) -> float:
        """Return total cost for a given month (default: current, format YYYY-MM)."""
        month = month or date.today().isoformat()[:7]
        conn = self._get_db()
        try:
            row = conn.execute(
                "SELECT COALESCE(SUM(cost), 0) as total FROM ai_filter_costs WHERE month = ?",
                (month,),
            ).fetchone()
            return float(row["total"]) if row else 0.0
        finally:
            conn.close()

    def get_daily_tokens(self, day: str | None = None) -> int:
        """Return total tokens consumed on a given date (default: today)."""
        day = day or date.today().isoformat()
        conn = self._get_db()
        try:
            row = conn.execute(
                "SELECT COALESCE(SUM(total_tokens), 0) as total FROM ai_filter_costs WHERE date = ?",
                (day,),
            ).fetchone()
            return int(row["total"]) if row else 0
        finally:
            conn.close()

    def is_cap_exceeded(self) -> bool:
        """
        Check whether the daily budget cap has been exceeded.

        Returns True if the accumulated cost for today >= AI_DAILY_BUDGET.
        """
        return self.get_daily_cost() >= AI_DAILY_BUDGET

    def get_stats(self) -> dict[str, Any]:
        """Return a snapshot of current cost statistics."""
        today = date.today().isoformat()
        return {
            "daily_cost": round(self.get_daily_cost(), 6),
            "daily_tokens": self.get_daily_tokens(),
            "monthly_cost": round(self.get_monthly_cost(), 6),
            "daily_budget_cap": AI_DAILY_BUDGET,
            "cap_exceeded": self.is_cap_exceeded(),
            "cost_per_1k_tokens": COST_PER_1K_TOKENS,
            "model_pricing_note": "Mistral Nemo 2407 via OpenRouter",
        }
