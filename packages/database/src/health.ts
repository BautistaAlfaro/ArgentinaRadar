import type Database from "better-sqlite3";
import { prisma } from "./client.js";

export interface HealthStatus {
  postgres: { connected: boolean; latency?: number; error?: string };
  sqlite: { connected: boolean; error?: string };
}

let lastError: string | null = null;

/**
 * Record the most recent PostgreSQL write failure.
 */
export function setLastError(error: string): void {
  lastError = error;
}

/**
 * Return the last recorded PostgreSQL error (or null).
 */
export function getLastError(): string | null {
  return lastError;
}

/**
 * Ping PostgreSQL via Prisma — returns connection status + latency in ms.
 */
export async function checkPostgresHealth(): Promise<{
  connected: boolean;
  latency?: number;
  error?: string;
}> {
  const start = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1 AS ok`;
    return { connected: true, latency: Date.now() - start };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { connected: false, error: msg };
  }
}

/**
 * Ping SQLite — returns connection status.
 */
export function checkSqliteHealth(
  db: Database.Database,
): { connected: boolean; error?: string } {
  try {
    db.prepare("SELECT 1 AS ok").get();
    return { connected: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { connected: false, error: msg };
  }
}

/**
 * Health-check both databases in parallel and return a combined status.
 */
export async function getDualWriteStatus(
  db: Database.Database,
): Promise<HealthStatus> {
  const [postgres, sqlite] = await Promise.all([
    checkPostgresHealth(),
    Promise.resolve(checkSqliteHealth(db)),
  ]);
  return { postgres, sqlite };
}
