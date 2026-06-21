/**
 * Night Owl — Budget Tracker
 *
 * Shared module used by all P0 jobs to track AI spending.
 *
 * - Tracks tokens and cost per job run
 * - Checks remaining budget before making API calls
 * - Logs warnings when 80% of the nightly budget is consumed
 * - Halts processing when the $1.00 cap is reached
 *
 * Budget cap comes from config.budgetPerNight (default $1.00).
 */

import { config } from '../config.js';

export class BudgetTracker {
  private spent = 0;
  private totalTokens = 0;
  private warned80pct = false;
  private readonly cap: number;
  private readonly warnThreshold: number;

  /**
   * @param capPerNight  Optional override for the nightly budget cap.
   *                     Defaults to `config.budgetPerNight`.
   */
  constructor(capPerNight?: number) {
    this.cap = capPerNight ?? config.budgetPerNight;
    this.warnThreshold = this.cap * 0.8;
  }

  // ── Public accessors ──────────────────────────────────────────────

  /** Remaining budget in USD. */
  get remaining(): number {
    return Math.max(0, this.cap - this.spent);
  }

  /** Percentage of budget consumed (0–100). */
  get percentageUsed(): number {
    return this.cap > 0 ? (this.spent / this.cap) * 100 : 0;
  }

  /** Whether the budget cap has been reached or exceeded. */
  get isExhausted(): boolean {
    return this.spent >= this.cap;
  }

  // ── Public API ────────────────────────────────────────────────────

  /**
   * Record an AI API call's cost and token usage.
   * Logs a warning the first time 80 % is crossed.
   * Logs an error when the cap is reached.
   */
  record(cost: number, tokens: number): void {
    this.spent += cost;
    this.totalTokens += tokens;

    if (!this.warned80pct && this.spent >= this.warnThreshold) {
      this.warned80pct = true;
      console.warn(
        `[Budget] ⚠️  80 % budget consumed ($${this.spent.toFixed(4)} / $${this.cap.toFixed(2)})`,
      );
    }

    if (this.isExhausted) {
      console.error(
        `[Budget] 🛑 Budget cap reached ($${this.cap.toFixed(2)}). Halting further AI calls.`,
      );
    }
  }

  /**
   * Call BEFORE every AI API call.
   * Returns `true` if there is budget remaining, `false` if exhausted.
   */
  check(): boolean {
    if (this.isExhausted) {
      console.warn(
        `[Budget] Budget exhausted ($${this.spent.toFixed(6)} / $${this.cap.toFixed(2)}). Skipping AI call.`,
      );
      return false;
    }
    return true;
  }

  /** Return a snapshot of the current budget state. */
  getSummary(): { spent: number; tokens: number; remaining: number; percentage: number } {
    return {
      spent: Math.round(this.spent * 1_000_000) / 1_000_000,
      tokens: this.totalTokens,
      remaining: this.remaining,
      percentage: this.percentageUsed,
    };
  }
}
