/**
 * Admin Dashboard — Pipeline Approval Queue Routes
 *
 * Provides REST endpoints for human review and approval of AI-generated
 * tweet drafts produced by the batch pipeline.
 *
 *   GET  /api/pipeline/approval-queue   — List pending (or filtered) queue items
 *   POST /api/pipeline/approve-batch    — Approve or reject a set of queue items
 *   POST /api/pipeline/publish-batch    — Mark approved items as published in DB
 *   GET  /api/pipeline/batches          — List distinct batches with status summary
 *
 * NOTE: actual Twitter/X posting is out of scope here — these endpoints only
 * update DB state. The publisher service handles the real posting.
 *
 * Auth is enforced by the parent router (see server.ts — /api/pipeline/* is
 * currently public/no-auth; add middleware there if needed).
 */

import { Router } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';

export const pipelineRouter = Router();

// ── DB path ────────────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_PATH =
  process.env.DB_PATH ??
  path.resolve(__dirname, '..', '..', '..', '..', 'data', 'argentina-radar.db');

/** Open a read-write connection and close it after the callback returns. */
function withDb<T>(fn: (db: Database.Database) => T): T {
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

// ── Types ──────────────────────────────────────────────────────────────

interface ApprovalQueueRow {
  id: number;
  article_id: number;
  tweet_draft: string;
  status: string;
  created_at: string;
  approved_at: string | null;
  published_at: string | null;
  tweet_id: string | null;
  batch_id: string | null;
  title: string | null;
  source: string | null;
  url: string | null;
  image_url: string | null;
  category: string | null;
}

interface BatchSummaryRow {
  batch_id: string | null;
  total: number;
  pending: number;
  approved: number;
  rejected: number;
  published: number;
  created_at: string;
}

// ── GET /api/pipeline/approval-queue ──────────────────────────────────
//
// Query params:
//   ?status=pending|approved|rejected|published  (default: pending)
//   ?batch=<batch_id>                            (optional filter by batch)

pipelineRouter.get('/approval-queue', (req, res) => {
  try {
    const status = (req.query.status as string) || 'pending';
    const batchId = req.query.batch as string | undefined;

    const items = withDb((db) => {
      const conditions: string[] = ['aq.status = ?'];
      const params: unknown[] = [status];

      if (batchId) {
        conditions.push('aq.batch_id = ?');
        params.push(batchId);
      }

      const where = conditions.join(' AND ');

      return db
        .prepare<unknown[], ApprovalQueueRow>(
          `SELECT
             aq.id,
             aq.article_id,
             aq.draft_tweet as tweet_draft,
             aq.status,
             aq.created_at,
             aq.reviewed_at as approved_at,
             aq.telegram_message_id as published_at,
             aq.telegram_message_id as tweet_id,
             aq.batch_id,
             ni.title,
             ni.source,
             ni.url,
             aq.image_url,
             ni.category
           FROM approval_queue aq
           LEFT JOIN news_items ni ON ni.id = aq.article_id
           WHERE ${where}
           ORDER BY aq.created_at DESC`,
        )
        .all(...params);
    });

    res.json({ total: items.length, items });
  } catch (err) {
    console.error('[pipeline] GET /approval-queue error:', (err as Error).message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/pipeline/approve-batch ─────────────────────────────────
//
// Body: { ids: number[], action: 'approve' | 'reject' }

pipelineRouter.post('/approve-batch', (req, res) => {
  try {
    const { ids, action } = req.body as { ids: unknown; action: unknown };

    if (!Array.isArray(ids) || ids.length === 0) {
      res.status(400).json({ error: 'ids must be a non-empty array of numbers' });
      return;
    }

    if (action !== 'approve' && action !== 'reject') {
      res.status(400).json({ error: "action must be 'approve' or 'reject'" });
      return;
    }

    const numericIds: number[] = ids.map((id) => Number(id)).filter((id) => Number.isFinite(id));

    if (numericIds.length === 0) {
      res.status(400).json({ error: 'ids must contain valid numbers' });
      return;
    }

    const placeholders = numericIds.map(() => '?').join(', ');
    const now = new Date().toISOString();

    const changes = withDb((db) => {
      if (action === 'approve') {
        const stmt = db.prepare(
          `UPDATE approval_queue
           SET status = 'approved', reviewed_at = ?
           WHERE id IN (${placeholders}) AND status = 'pending'`,
        );
        return stmt.run(now, ...numericIds).changes;
      } else {
        const stmt = db.prepare(
          `UPDATE approval_queue
           SET status = 'rejected'
           WHERE id IN (${placeholders}) AND status = 'pending'`,
        );
        return stmt.run(...numericIds).changes;
      }
    });

    const approved = action === 'approve' ? changes : 0;
    const rejected = action === 'reject' ? changes : 0;

    console.log(`[pipeline] approve-batch: action=${action}, affected=${changes}`);
    res.json({ approved, rejected });
  } catch (err) {
    console.error('[pipeline] POST /approve-batch error:', (err as Error).message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/pipeline/publish-batch ─────────────────────────────────
//
// Body: { ids: number[] }  — approval_queue ids with status='approved'
//
// For each id:
//   1. Update approval_queue.status='published', published_at=now()
//   2. Update news_items.status='published' for the article_id
//   3. Insert into tweet_history (article_id, status='published', posted_at=now())

pipelineRouter.post('/publish-batch', (req, res) => {
  try {
    const { ids } = req.body as { ids: unknown };

    if (!Array.isArray(ids) || ids.length === 0) {
      res.status(400).json({ error: 'ids must be a non-empty array of numbers' });
      return;
    }

    const numericIds: number[] = ids.map((id) => Number(id)).filter((id) => Number.isFinite(id));

    if (numericIds.length === 0) {
      res.status(400).json({ error: 'ids must contain valid numbers' });
      return;
    }

    const published = withDb((db) => {
      const placeholders = numericIds.map(() => '?').join(', ');
      const now = new Date().toISOString();

      // Fetch approved rows so we can propagate to related tables
      const rows = db
        .prepare<unknown[], { id: number; article_id: number }>(
          `SELECT id, article_id FROM approval_queue
           WHERE id IN (${placeholders}) AND status = 'approved'`,
        )
        .all(...numericIds);

      if (rows.length === 0) return 0;

      const updateQueue = db.prepare(
        `UPDATE approval_queue SET status = 'published' WHERE id = ?`,
      );
      const updateArticle = db.prepare(
        `UPDATE news_items SET status = 'published', published_at = ? WHERE id = ?`,
      );
      const insertHistory = db.prepare(
        `INSERT INTO tweet_history (article_id, status, posted_at)
         VALUES (?, 'published', ?)`,
      );

      const publishAll = db.transaction(() => {
        for (const row of rows) {
          updateQueue.run(now, row.id);
          updateArticle.run(now, row.article_id);
          insertHistory.run(row.article_id, now);
        }
      });

      publishAll();
      return rows.length;
    });

    console.log(`[pipeline] publish-batch: published=${published}`);
    res.json({ published });
  } catch (err) {
    console.error('[pipeline] POST /publish-batch error:', (err as Error).message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /api/pipeline/batches ─────────────────────────────────────────
//
// Returns distinct batch_ids with per-status counts.

pipelineRouter.get('/batches', (_req, res) => {
  try {
    const batches = withDb((db) => {
      return db
        .prepare<[], BatchSummaryRow>(
          `SELECT
             batch_id,
             COUNT(*) AS total,
             SUM(CASE WHEN status = 'pending'   THEN 1 ELSE 0 END) AS pending,
             SUM(CASE WHEN status = 'approved'  THEN 1 ELSE 0 END) AS approved,
             SUM(CASE WHEN status = 'rejected'  THEN 1 ELSE 0 END) AS rejected,
             SUM(CASE WHEN status = 'published' THEN 1 ELSE 0 END) AS published,
             MIN(created_at) AS created_at
           FROM approval_queue
           GROUP BY batch_id
           ORDER BY created_at DESC`,
        )
        .all();
    });

    res.json({ batches });
  } catch (err) {
    console.error('[pipeline] GET /batches error:', (err as Error).message);
    res.status(500).json({ error: 'Internal server error' });
  }
});
