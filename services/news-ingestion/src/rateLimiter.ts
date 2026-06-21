/**
 * Per-source rate limiter. Ensures a minimum time gap (in ms) between
 * consecutive requests to the same domain.
 *
 * Queue-based: if a request arrives before the cooldown expires, it is
 * delayed until the cooldown has elapsed.
 */

interface QueueEntry {
  domain: string;
  resolve: () => void;
  scheduledAt: number;
}

export class RateLimiter {
  private lastRun = new Map<string, number>();
  private queue: QueueEntry[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private defaultMinGapMs = 2_000) {}

  /**
   * Wait until it's safe to make a request to the given URL.
   * Returns a promise that resolves when the cooldown has elapsed.
   */
  async wait(url: string, minGapMs?: number): Promise<void> {
    const domain = this.extractDomain(url);
    const gap = minGapMs ?? this.defaultMinGapMs;
    const last = this.lastRun.get(domain) ?? 0;
    const elapsed = Date.now() - last;
    const remaining = Math.max(0, gap - elapsed);

    if (remaining <= 0) {
      this.lastRun.set(domain, Date.now());
      return;
    }

    // Queue the request
    return new Promise<void>((resolve) => {
      this.queue.push({
        domain,
        resolve,
        scheduledAt: Date.now() + remaining,
      });
      this.processQueue();
    });
  }

  /** Mark a domain as just-ran (updates the lastRun timestamp). */
  markRun(url: string): void {
    this.lastRun.set(this.extractDomain(url), Date.now());
  }

  // ─── Private ─────────────────────────────────────────────────────

  private extractDomain(url: string): string {
    try {
      return new URL(url).hostname;
    } catch {
      return url;
    }
  }

  private processQueue(): void {
    if (this.timer) return;

    const tick = () => {
      this.timer = null;
      const now = Date.now();
      const ready = this.queue.filter((e) => e.scheduledAt <= now);

      if (ready.length > 0) {
        for (const entry of ready) {
          this.lastRun.set(entry.domain, now);
          entry.resolve();
        }
        this.queue = this.queue.filter((e) => e.scheduledAt > now);
      }

      if (this.queue.length > 0) {
        const next = Math.min(...this.queue.map((e) => e.scheduledAt));
        this.timer = setTimeout(tick, Math.max(0, next - Date.now()));
      }
    };

    this.timer = setTimeout(tick, 0);
  }
}
