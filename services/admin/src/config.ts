// ─────────────────────────────────────────────────────────
//  Admin Dashboard Service — Environment configuration
// ─────────────────────────────────────────────────────────

export const config = {
  port: parseInt(process.env.ADMIN_PORT ?? "3012", 10),

  jwtSecret: process.env.JWT_SECRET ?? "dev-jwt-secret-change-in-production",

  /** URL base for internal service calls */
  eventDetectorUrl: process.env.EVENT_DETECTOR_URL ?? "http://127.0.0.1:3008",

  /** Pipeline service URLs for health checks (use 127.0.0.1 not localhost — Node resolves localhost to IPv6 ::1 which breaks Python/uvicorn) */
  newsServiceUrl: process.env.NEWS_SERVICE_URL ?? "http://127.0.0.1:3001",
  geolocationUrl: process.env.GEOLOCATION_URL ?? "http://127.0.0.1:3002",
  aiProcessorUrl: process.env.AI_PROCESSOR_URL ?? "http://127.0.0.1:3013",
  twitterPublisherUrl: process.env.TWITTER_PUBLISHER_URL ?? "http://127.0.0.1:3004",

  /** Collector interval in milliseconds (default: 1 hour) */
  collectorIntervalMs: parseInt(
    process.env.COLLECTOR_INTERVAL ?? String(60 * 60 * 1000),
    10,
  ),
};
