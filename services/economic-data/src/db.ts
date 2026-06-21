import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_PATH =
  process.env.DB_PATH ?? path.resolve(__dirname, '..', '..', '..', 'data', 'argentina-radar.db');

let db: Database.Database | null = null;

/**
 * Returns the shared SQLite connection. Creates the DB file and runs
 * migrations on first call. WAL mode is enabled for concurrent reads.
 */
export function getDb(): Database.Database {
  if (db) return db;

  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  runMigrations(db);
  console.log(`[economic-data/db] Connected to SQLite at ${DB_PATH} (WAL mode)`);
  return db;
}

/**
 * Close the database connection gracefully.
 */
export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
    console.log('[economic-data/db] Connection closed');
  }
}

/**
 * Run schema migrations for economic data tables.
 */
function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS economic_data (
      type           TEXT PRIMARY KEY,
      value          REAL NOT NULL,
      previous_value REAL,
      source         TEXT NOT NULL,
      timestamp      TEXT NOT NULL DEFAULT (datetime('now')),
      stale          INTEGER NOT NULL DEFAULT 0,
      partial        INTEGER NOT NULL DEFAULT 0,
      metadata       TEXT
    );
  `);
  console.log('[economic-data/db] Migrations up to date');
}

/**
 * Economic indicator row shape as stored in SQLite.
 */
export interface EconomicRow {
  type: string;
  value: number;
  previous_value: number | null;
  source: string;
  timestamp: string;
  stale: number;
  partial: number;
  metadata: string | null;
}

/**
 * Upsert an economic indicator into the DB.
 * Moves the current value to previous_value before writing the new one.
 */
export function upsertIndicator(
  type: string,
  value: number,
  source: string,
  partial: boolean,
  stale: boolean,
  metadata?: Record<string, unknown>,
): void {
  const database = getDb();

  // Read current row to capture previous_value
  const existing = database
    .prepare('SELECT value FROM economic_data WHERE type = ?')
    .get(type) as { value: number } | undefined;

  const previousValue = existing?.value ?? null;
  const metadataStr = metadata ? JSON.stringify(metadata) : null;

  database
    .prepare(
      `INSERT INTO economic_data (type, value, previous_value, source, timestamp, stale, partial, metadata)
       VALUES (?, ?, ?, ?, datetime('now'), ?, ?, ?)
       ON CONFLICT(type) DO UPDATE SET
         value          = excluded.value,
         previous_value = excluded.previous_value,
         source         = excluded.source,
         timestamp      = excluded.timestamp,
         stale          = excluded.stale,
         partial        = excluded.partial,
         metadata       = excluded.metadata`,
    )
    .run(type, value, previousValue, source, stale ? 1 : 0, partial ? 1 : 0, metadataStr);
}

/**
 * Mark an indicator as stale.
 */
export function markStale(type: string, stale: boolean): void {
  const database = getDb();
  database
    .prepare('UPDATE economic_data SET stale = ?, timestamp = datetime(\'now\') WHERE type = ?')
    .run(stale ? 1 : 0, type);
}

/**
 * Get all economic indicators from the DB.
 */
export function getAllIndicators(): EconomicRow[] {
  const database = getDb();
  return database.prepare('SELECT * FROM economic_data ORDER BY type').all() as EconomicRow[];
}

/**
 * Get a single economic indicator by type.
 */
export function getIndicator(type: string): EconomicRow | undefined {
  const database = getDb();
  return database.prepare('SELECT * FROM economic_data WHERE type = ?').get(type) as
    | EconomicRow
    | undefined;
}
