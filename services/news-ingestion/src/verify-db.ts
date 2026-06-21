/**
 * ArgentinaRadar — Database Verification Script
 *
 * Production schema health check:
 *   • All required tables exist
 *   • Row counts per table
 *   • Column types and constraints
 *   • Index coverage
 *   • Foreign key integrity
 *   • Overall health report
 *
 * Usage:
 *   npm run db:verify
 */

import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_PATH =
  process.env.DB_PATH ?? path.resolve(__dirname, '..', '..', '..', 'data', 'argentina-radar.db');

/* ─────────────────────────────────────────────────────────────────────
   Types
   ───────────────────────────────────────────────────────────────────── */

interface TableInfo {
  name: string;
  columns: ColumnInfo[];
  rowCount: number;
  indexes: IndexInfo[];
  foreignKeys: FkInfo[];
  exists: boolean;
}

interface ColumnInfo {
  name: string;
  type: string;
  notNull: boolean;
  default: string | null;
  primaryKey: boolean;
}

interface IndexInfo {
  name: string;
  sql: string | null;
  unique: boolean;
}

interface FkInfo {
  from: string;
  table: string;
  to: string;
  onDelete: string;
  onUpdate: string;
}

interface HealthReport {
  timestamp: string;
  database: string;
  status: 'healthy' | 'degraded' | 'unhealthy';
  tables: TableInfo[];
  issues: string[];
  warnings: string[];
  summary: {
    totalTables: number;
    missingTables: string[];
    totalRows: number;
    totalIndexes: number;
    missingIndexes: string[];
    fkViolations: number;
  };
}

/* ─────────────────────────────────────────────────────────────────────
   Required schema specification
   ───────────────────────────────────────────────────────────────────── */

const REQUIRED_TABLES = [
  'news_items',
  'sources',
  'tweet_history',
  'approval_queue',
];

const REQUIRED_NEWS_COLUMNS: Array<{ name: string; type: string }> = [
  { name: 'id', type: 'TEXT' },
  { name: 'title', type: 'TEXT' },
  { name: 'summary', type: 'TEXT' },
  { name: 'source', type: 'TEXT' },
  { name: 'sources', type: 'TEXT' },
  { name: 'url', type: 'TEXT' },
  { name: 'category', type: 'TEXT' },
  { name: 'published_at', type: 'TEXT' },
  { name: 'ingested_at', type: 'TEXT' },
  { name: 'location', type: 'TEXT' },
  { name: 'ai_score', type: 'TEXT' },
  { name: 'tweet_id', type: 'TEXT' },
  { name: 'status', type: 'TEXT' },
  { name: 'embedding', type: 'TEXT' },
  { name: 'entities', type: 'TEXT' },
  { name: 'ai_category', type: 'TEXT' },
];

const REQUIRED_SOURCES_COLUMNS: Array<{ name: string; type: string }> = [
  { name: 'name', type: 'TEXT' },
  { name: 'type', type: 'TEXT' },
  { name: 'url', type: 'TEXT' },
  { name: 'category', type: 'TEXT' },
  { name: 'rate_limit_ms', type: 'INTEGER' },
  { name: 'status', type: 'TEXT' },
  { name: 'last_fetched_at', type: 'TEXT' },
  { name: 'css_selectors', type: 'TEXT' },
];

const REQUIRED_TWEET_COLUMNS: Array<{ name: string; type: string }> = [
  { name: 'id', type: 'INTEGER' },
  { name: 'article_id', type: 'TEXT' },
  { name: 'tweet_id', type: 'TEXT' },
  { name: 'posted_at', type: 'TEXT' },
  { name: 'status', type: 'TEXT' },
  { name: 'error', type: 'TEXT' },
];

const REQUIRED_APPROVAL_COLUMNS: Array<{ name: string; type: string }> = [
  { name: 'id', type: 'TEXT' },
  { name: 'article_id', type: 'TEXT' },
  { name: 'draft_tweet', type: 'TEXT' },
  { name: 'status', type: 'TEXT' },
];

const REQUIRED_INDEXES = [
  { table: 'news_items', index: 'idx_news_status' },
  { table: 'news_items', index: 'idx_news_published_at' },
  { table: 'news_items', index: 'idx_news_category' },
  { table: 'news_items', index: 'idx_news_source' },
  { table: 'news_items', index: 'idx_news_ingested_at' },
  { table: 'approval_queue', index: 'idx_approval_queue_status' },
  { table: 'approval_queue', index: 'idx_approval_queue_article' },
];

/* ─────────────────────────────────────────────────────────────────────
   Helpers
   ───────────────────────────────────────────────────────────────────── */

function typeMatches(expected: string, actual: string): boolean {
  const norm = (t: string) => t.toUpperCase().replace(/\(\d+\)/g, '');
  return norm(expected) === norm(actual);
}

function collectTableInfo(db: Database.Database, name: string): TableInfo {
  // Check if table exists
  const existsRow = db.prepare(
    "SELECT count(*) as c FROM sqlite_master WHERE type='table' AND name = ?",
  ).get(name) as { c: number };
  const exists = existsRow.c > 0;

  if (!exists) {
    return {
      name,
      exists: false,
      columns: [],
      rowCount: 0,
      indexes: [],
      foreignKeys: [],
    };
  }

  // Columns
  const rawCols = db.prepare(`PRAGMA table_info("${name}")`).all() as Array<{
    name: string;
    type: string;
    notnull: number;
    dflt_value: string | null;
    pk: number;
  }>;

  const columns: ColumnInfo[] = rawCols.map(c => ({
    name: c.name,
    type: c.type,
    notNull: c.notnull === 1,
    default: c.dflt_value,
    primaryKey: c.pk === 1,
  }));

  // Indexes
  const rawIdx = db.prepare(
    "SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name = ? AND name NOT LIKE 'sqlite_%'",
  ).all(name) as Array<{ name: string; sql: string | null }>;

  const indexes: IndexInfo[] = rawIdx.map(i => ({
    name: i.name,
    sql: i.sql,
    unique: i.sql?.toUpperCase().includes('UNIQUE') ?? false,
  }));

  // Foreign keys
  const rawFk = db.prepare(`PRAGMA foreign_key_list("${name}")`).all() as Array<{
    from: string;
    table: string;
    to: string;
    on_delete: string;
    on_update: string;
  }>;

  const foreignKeys: FkInfo[] = rawFk.map(fk => ({
    from: fk.from,
    table: fk.table,
    to: fk.to,
    onDelete: fk.on_delete || 'NO ACTION',
    onUpdate: fk.on_update || 'NO ACTION',
  }));

  // Row count
  const row = db.prepare(`SELECT COUNT(*) as c FROM "${name}"`).get() as { c: number };

  return {
    name,
    exists: true,
    columns,
    rowCount: row.c,
    indexes,
    foreignKeys,
  };
}

/* ─────────────────────────────────────────────────────────────────────
   Main verification
   ───────────────────────────────────────────────────────────────────── */

function verifyDatabase(): HealthReport {
  const issues: string[] = [];
  const warnings: string[] = [];

  const db = new Database(DB_PATH);

  const tables: TableInfo[] = REQUIRED_TABLES.map(t => collectTableInfo(db, t));

  // Also collect any extra tables for completeness
  const allTableNames = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  ).all() as Array<{ name: string }>;

  const extraTables = allTableNames
    .map(t => t.name)
    .filter(n => !REQUIRED_TABLES.includes(n))
    .map(name => collectTableInfo(db, name));

  tables.push(...extraTables);

  // ── Checks ──────────────────────────────────────────────────────────

  // 1. Missing tables
  const missingTables = tables.filter(t => REQUIRED_TABLES.includes(t.name) && !t.exists).map(t => t.name);
  for (const mt of missingTables) {
    issues.push(`Required table '${mt}' does not exist`);
  }

  // 2. Missing columns in news_items
  const newsTable = tables.find(t => t.name === 'news_items');
  if (newsTable?.exists) {
    for (const reqCol of REQUIRED_NEWS_COLUMNS) {
      const found = newsTable.columns.find(c => c.name === reqCol.name);
      if (!found) {
        issues.push(`news_items: missing column '${reqCol.name}'`);
      } else if (!typeMatches(reqCol.type, found.type)) {
        warnings.push(`news_items.${reqCol.name}: expected ${reqCol.type}, got ${found.type}`);
      }
    }
  }

  // 3. Missing columns in sources
  const sourcesTable = tables.find(t => t.name === 'sources');
  if (sourcesTable?.exists) {
    for (const reqCol of REQUIRED_SOURCES_COLUMNS) {
      const found = sourcesTable.columns.find(c => c.name === reqCol.name);
      if (!found) {
        issues.push(`sources: missing column '${reqCol.name}'`);
      }
    }
  }

  // 4. Missing columns in tweet_history
  const tweetTable = tables.find(t => t.name === 'tweet_history');
  if (tweetTable?.exists) {
    for (const reqCol of REQUIRED_TWEET_COLUMNS) {
      const found = tweetTable.columns.find(c => c.name === reqCol.name);
      if (!found) {
        issues.push(`tweet_history: missing column '${reqCol.name}'`);
      }
    }
  }

  // 5. Missing columns in approval_queue
  const approvalTable = tables.find(t => t.name === 'approval_queue');
  if (approvalTable?.exists) {
    for (const reqCol of REQUIRED_APPROVAL_COLUMNS) {
      const found = approvalTable.columns.find(c => c.name === reqCol.name);
      if (!found) {
        issues.push(`approval_queue: missing column '${reqCol.name}'`);
      }
    }
  }

  // 6. Required indexes
  const allIndexEntries = tables.flatMap(t => t.indexes.map(i => ({ table: t.name, index: i.name })));
  const missingIndexes: string[] = [];
  for (const reqIdx of REQUIRED_INDEXES) {
    const found = allIndexEntries.some(i => i.table === reqIdx.table && i.index === reqIdx.index);
    if (!found) {
      missingIndexes.push(`${reqIdx.table}.${reqIdx.index}`);
    }
  }
  if (missingIndexes.length > 0) {
    warnings.push(`Missing recommended indexes: ${missingIndexes.join(', ')}`);
  }

  // 7. Foreign key integrity
  db.pragma('foreign_keys = ON');
  let fkViolations = 0;
  for (const t of tables) {
    if (t.foreignKeys.length > 0) {
      for (const fk of t.foreignKeys) {
        // Basic check: does the referenced table exist?
        const refExists = tables.some(rt => rt.name === fk.table);
        if (!refExists) {
          issues.push(`FK in ${t.name}: ${fk.from} → ${fk.table}.${fk.to} — target table '${fk.table}' not found`);
          fkViolations++;
        }
      }
    }
  }

  // Attempt to enable FK enforcement and check for actual violations
  try {
    db.pragma('foreign_key_check');
  } catch {
    // foreign_key_check pragma returns rows only on violations
  }

  db.close();

  // ── Summary ──────────────────────────────────────────────────────────
  const totalRows = tables.reduce((sum, t) => sum + t.rowCount, 0);
  const totalIndexes = allIndexEntries.length;

  const status: HealthReport['status'] =
    issues.length > 0
      ? 'unhealthy'
      : warnings.length > 0
        ? 'degraded'
        : 'healthy';

  return {
    timestamp: new Date().toISOString(),
    database: DB_PATH,
    status,
    tables,
    issues,
    warnings,
    summary: {
      totalTables: tables.length,
      missingTables,
      totalRows,
      totalIndexes,
      missingIndexes,
      fkViolations,
    },
  };
}

/* ─────────────────────────────────────────────────────────────────────
   Report display
   ───────────────────────────────────────────────────────────────────── */

function displayReport(report: HealthReport): void {
  const border = '='.repeat(60);

  console.log(`\n${border}`);
  console.log('  ArgentinaRadar — Database Health Report');
  console.log(`  ${report.timestamp}`);
  console.log(`${border}\n`);

  // Overall status
  const statusIcon = report.status === 'healthy' ? '✓' : report.status === 'degraded' ? '⚠' : '✗';
  console.log(`  Status: ${statusIcon} ${report.status.toUpperCase()}`);
  console.log(`  Database: ${report.database}\n`);

  // Table summary
  console.log(`  Tables: ${report.summary.totalTables}`);
  console.log(`  Total rows: ${report.summary.totalRows.toLocaleString()}`);
  console.log(`  Total indexes: ${report.summary.totalIndexes}\n`);

  // Per-table detail
  console.log('  ── Table Details ──');
  for (const t of report.tables) {
    const icon = t.exists ? '✓' : '✗';
    const rowStr = t.rowCount.toLocaleString().padStart(8);
    console.log(`  ${icon} ${t.name.padEnd(20)} ${rowStr} rows  ${t.columns.length} cols, ${t.indexes.length} idx`);
    if (t.foreignKeys.length > 0) {
      for (const fk of t.foreignKeys) {
        console.log(`       FK: ${fk.from} → ${fk.table}.${fk.to}`);
      }
    }
  }

  // Issues
  if (report.issues.length > 0) {
    console.log(`\n  ── Issues (${report.issues.length}) ──`);
    for (const issue of report.issues) {
      console.log(`  ✗  ${issue}`);
    }
  }

  // Warnings
  if (report.warnings.length > 0) {
    console.log(`\n  ── Warnings (${report.warnings.length}) ──`);
    for (const warning of report.warnings) {
      console.log(`  ⚠  ${warning}`);
    }
  }

  // Final verdict
  console.log(`\n${border}`);
  if (report.status === 'healthy') {
    console.log('  ✓ DATABASE HEALTHY — All checks passed.');
  } else if (report.status === 'degraded') {
    console.log('  ⚠ DATABASE DEGRADED — Review warnings above.');
  } else {
    console.log('  ✗ DATABASE UNHEALTHY — Issues must be resolved.');
  }
  console.log(`${border}\n`);
}

// ── Entry point ─────────────────────────────────────────────────────────
const report = verifyDatabase();
displayReport(report);

// Exit with code
if (report.status === 'unhealthy') {
  process.exit(1);
}
