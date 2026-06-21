/**
 * Market-hours-aware scheduler for economic data fetches.
 *
 * Argentina Market hours: Mon–Fri 10:00–17:00 ART (UTC-3).
 * Outside those hours, fetch calls are skipped until the next window.
 */

const ART_OFFSET = -3; // hours from UTC

/**
 * Check whether the current time falls within Argentina market hours.
 * Market hours: Mon–Fri 10:00–17:00 ART.
 */
export function isMarketHours(now: Date = new Date()): boolean {
  // Convert local time to ART (UTC-3)
  const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  const artMinutes = utcMinutes + ART_OFFSET * 60;
  const clampedMinutes = ((artMinutes % 1440) + 1440) % 1440; // wrap to [0, 1440)

  const day = now.getUTCDay(); // 0=Sun, 6=Sat
  const hour = Math.floor(clampedMinutes / 60);
  const minute = clampedMinutes % 60;

  // Weekday check
  if (day === 0 || day === 6) return false;

  // 10:00 – 17:00 ART
  if (hour < 10 || hour > 17) return false;
  if (hour === 17 && minute > 0) return false; // strictly up to 17:00

  return true;
}

/**
 * Check whether current time is within the market close window (±30 min around 17:00 ART).
 * Used for daily fetchers that should run once at close.
 */
export function isMarketCloseWindow(now: Date = new Date()): boolean {
  const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  const artMinutes = utcMinutes + ART_OFFSET * 60;
  const clampedMinutes = ((artMinutes % 1440) + 1440) % 1440;

  const day = now.getUTCDay();
  if (day === 0 || day === 6) return false;

  // 16:30 – 17:30 ART (±30 min around close)
  return clampedMinutes >= 16 * 60 + 30 && clampedMinutes < 17 * 60 + 30;
}

export interface SchedulerOptions {
  /** Interval in milliseconds between fetch attempts */
  intervalMs: number;
  /** Fetch function to call */
  fetchFn: () => Promise<void>;
  /** Name for logging */
  name: string;
  /** If true, only fetch during market hours (default: true) */
  marketHoursOnly?: boolean;
  /** If true, only fetch once per day during the market close window (default: false) */
  dailyAtClose?: boolean;
}

/**
 * Create a recurring scheduler that respects market hours.
 * Returns a controller with a `stop()` method.
 */
export function scheduleFetch(options: SchedulerOptions): { stop: () => void } {
  const { intervalMs, fetchFn, name, marketHoursOnly = true, dailyAtClose = false } = options;
  let lastDailyRunDate = '';

  console.log(`[scheduler] ${name} — starting with interval ${intervalMs}ms`);

  // Always run immediately on start (regardless of market hours)
  // This ensures we have data even outside market hours
  if (!dailyAtClose) {
    fetchFn().catch((err) => console.error(`[scheduler] ${name} initial fetch error:`, err));
  } else {
    // For daily fetchers, run immediately if in close window, otherwise run once at next opportunity
    if (isMarketCloseWindow()) {
      const today = new Date().toISOString().slice(0, 10);
      lastDailyRunDate = today;
      fetchFn().catch((err) => console.error(`[scheduler] ${name} initial fetch error:`, err));
    } else {
      // Run once immediately even outside close window
      const today = new Date().toISOString().slice(0, 10);
      lastDailyRunDate = today;
      fetchFn().catch((err) => console.error(`[scheduler] ${name} initial fetch error:`, err));
    }
  }

  const timer = setInterval(() => {
    if (dailyAtClose) {
      const today = new Date().toISOString().slice(0, 10);
      if (lastDailyRunDate === today) return;
      if (isMarketCloseWindow()) {
        lastDailyRunDate = today;
        fetchFn().catch((err) => console.error(`[scheduler] ${name} fetch error:`, err));
      }
      return;
    }

    if (marketHoursOnly && !isMarketHours()) {
      // Silent skip outside hours
      return;
    }

    fetchFn().catch((err) => console.error(`[scheduler] ${name} fetch error:`, err));
  }, intervalMs);

  return {
    stop: () => {
      clearInterval(timer);
      console.log(`[scheduler] ${name} — stopped`);
    },
  };
}

/** Convert an interval in minutes to milliseconds. */
export function minutes(min: number): number {
  return min * 60 * 1000;
}

/** Convert an interval in hours to milliseconds. */
export function hours(h: number): number {
  return h * 60 * 60 * 1000;
}
