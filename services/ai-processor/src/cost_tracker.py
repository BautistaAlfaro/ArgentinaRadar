"""
In-memory cost tracker for AI Processor API calls.

Tracks token usage and cost per model, enforces a configurable daily budget cap,
and provides usage statistics. Everything is kept in memory — no database dependency.
"""

import time
from dataclasses import dataclass, field
from datetime import date
from typing import Any

from src.config import DAILY_BUDGET


@dataclass
class CostLogEntry:
    """A single API call record."""

    model: str
    tokens: int
    cost: float
    timestamp: float  # Unix epoch seconds
    date_key: str  # YYYY-MM-DD


class CostTracker:
    """
    Tracks API costs per model and enforces daily budget caps.

    All data is stored in-memory. Resets on service restart.
    """

    def __init__(self, daily_budget: float = DAILY_BUDGET) -> None:
        self._daily_budget: float = daily_budget
        self._logs: list[CostLogEntry] = []

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def log_call(self, model: str, tokens: int, cost: float) -> None:
        """
        Record a single API call.

        Args:
            model: Model identifier (e.g. 'gpt-4o-mini').
            tokens: Total tokens consumed.
            cost: Cost in USD for this call.
        """
        now = time.time()
        today = date.today().isoformat()
        self._logs.append(
            CostLogEntry(
                model=model,
                tokens=tokens,
                cost=cost,
                timestamp=now,
                date_key=today,
            )
        )

    def get_daily_cost(self, day: str | None = None) -> float:
        """Return total cost for a given date (default: today)."""
        day = day or date.today().isoformat()
        return sum(entry.cost for entry in self._logs if entry.date_key == day)

    def get_daily_tokens(self, day: str | None = None) -> int:
        """Return total tokens consumed on a given date (default: today)."""
        day = day or date.today().isoformat()
        return sum(entry.tokens for entry in self._logs if entry.date_key == day)

    def is_cap_exceeded(self) -> bool:
        """
        Check whether the daily budget cap has been exceeded.

        Returns True if accumulated cost for today >= daily_budget.
        """
        return self.get_daily_cost() >= self._daily_budget

    def get_stats(self) -> dict[str, Any]:
        """Return a snapshot of current cost statistics."""
        today = date.today().isoformat()
        return {
            "daily_cost": round(self.get_daily_cost(), 6),
            "daily_tokens": self.get_daily_tokens(),
            "daily_budget_cap": self._daily_budget,
            "cap_exceeded": self.is_cap_exceeded(),
            "total_calls_today": sum(
                1 for entry in self._logs if entry.date_key == today
            ),
        }

    def get_logs(self, limit: int = 100) -> list[dict[str, Any]]:
        """Return the most recent cost log entries."""
        sorted_logs = sorted(self._logs, key=lambda e: e.timestamp, reverse=True)
        return [
            {
                "model": entry.model,
                "tokens": entry.tokens,
                "cost": round(entry.cost, 8),
                "timestamp": entry.timestamp,
                "date": entry.date_key,
            }
            for entry in sorted_logs[:limit]
        ]
