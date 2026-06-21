// ─────────────────────────────────────────────────────────
//  Auth Service — Environment configuration
// ─────────────────────────────────────────────────────────

if (!process.env.JWT_SECRET && process.env.NODE_ENV === "production") {
  throw new Error("JWT_SECRET environment variable is required in production");
}

export const config = {
  port: parseInt(process.env.PORT ?? "3010", 10),

  jwtSecret: process.env.JWT_SECRET ?? "dev-jwt-secret-change-in-production",
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? "15m",

  /** Refresh token lifetime in milliseconds (default: 7 days). */
  refreshTokenExpiresInMs: parseDuration(
    process.env.REFRESH_TOKEN_EXPIRES_IN ?? "7d",
  ),
};

/**
 * Parse a human-readable duration string like "7d", "15m", "1h" into
 * milliseconds.
 */
function parseDuration(dur: string): number {
  const match = dur.match(/^(\d+)\s*([dhms])$/);
  if (!match) return 7 * 24 * 60 * 60 * 1000;

  const val = parseInt(match[1], 10);
  const multipliers: Record<string, number> = {
    d: 86_400_000,
    h: 3_600_000,
    m: 60_000,
    s: 1_000,
  };
  return val * (multipliers[match[2]] ?? 86_400_000);
}
