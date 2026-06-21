// ─────────────────────────────────────────────────────────
//  Admin Dashboard Service — Environment configuration
// ─────────────────────────────────────────────────────────

export const config = {
  port: parseInt(process.env.ADMIN_PORT ?? "3012", 10),

  jwtSecret: process.env.JWT_SECRET ?? "dev-jwt-secret-change-in-production",

  /** URL base for internal service calls */
  eventDetectorUrl: process.env.EVENT_DETECTOR_URL ?? "http://localhost:3008",

  /** Collector interval in milliseconds (default: 1 hour) */
  collectorIntervalMs: parseInt(
    process.env.COLLECTOR_INTERVAL ?? String(60 * 60 * 1000),
    10,
  ),
};
