/**
 * Trend Analyzer configuration
 *
 * Reads environment variables with sensible defaults.
 */

/** Port the REST API listens on */
export const PORT = parseInt(process.env.PORT ?? '3009', 10);

/** Interval (ms) between trend recalculation runs */
export const ANALYSIS_INTERVAL = parseInt(process.env.ANALYSIS_INTERVAL ?? '1800000', 10); // 30 min

/** How far back (ms) the "current 24h" window reaches */
export const CURRENT_WINDOW_MS = 24 * 60 * 60 * 1000;

/** The 24h window immediately before the current one */
export const PREVIOUS_WINDOW_MS = 2 * 24 * 60 * 60 * 1000;
