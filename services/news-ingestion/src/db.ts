import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import { runMigrations } from './migrations.js';

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

  // Enable WAL mode for better concurrent read performance
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  runMigrations(db);

  console.log(`[db] Connected to SQLite at ${DB_PATH} (WAL mode)`);
  return db;
}

/**
 * Close the database connection gracefully.
 */
export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
    console.log('[db] Connection closed');
  }
}
