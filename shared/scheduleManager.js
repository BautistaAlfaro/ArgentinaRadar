/**
 * Schedule Manager — ArgentinaRadar
 *
 * Manages scheduled Bluesky posts with retry support.
 * Handles CRUD for scheduled_posts table and the retry logic
 * with exponential backoff (30s, 2min, 5min, max 3 retries).
 *
 * Usage (CommonJS):
 *   const scheduleManager = require('../../shared/scheduleManager');
 *   const id = scheduleManager.schedulePost('abc123', 'text...', new Date('2026-06-21T14:30'));
 *   const due = scheduleManager.getDuePosts();
 *
 * Also available as a standalone init script:
 *   node shared/scheduleManager.js  (runs table creation only)
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

/** @typedef {Object} ScheduledPost
 * @property {number} id
 * @property {string} article_id
 * @property {string} text
 * @property {string|null} image_url
 * @property {string|null} url
 * @property {string} scheduled_for  - ISO datetime string
 * @property {'scheduled'|'published'|'failed'|'cancelled'} status
 * @property {string|null} published_at
 * @property {number} retry_count
 * @property {string|null} last_error
 * @property {string} created_at
 */

// ─── Database ───────────────────────────────────────────────────────────

/**
 * Resolve DB path relative to project root (two levels up from shared/).
 */
function resolveDbPath() {
  // Try to locate the project root by looking for data/ directory
  let dir = __dirname;
  for (let i = 0; i < 5; i++) {
    const candidate = path.join(dir, 'data');
    if (fs.existsSync(candidate)) {
      return path.join(candidate, 'argentina-radar.db');
    }
    const parent = path.dirname(dir);
    if (parent === dir) break; // hit filesystem root
    dir = parent;
  }
  // Fallback to the standard project layout
  return path.resolve(__dirname, '..', 'data', 'argentina-radar.db');
}

const DB_PATH = resolveDbPath();

/**
 * Open a connection to the shared SQLite DB and ensure the scheduled_posts table exists.
 * @returns {import('better-sqlite3').Database}
 */
function getDb() {
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS scheduled_posts (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      article_id     TEXT    NOT NULL,
      text           TEXT    NOT NULL,
      image_url      TEXT,
      url            TEXT,
      scheduled_for  TEXT    NOT NULL,
      status         TEXT    DEFAULT 'scheduled'
                             CHECK(status IN ('scheduled','published','failed','cancelled')),
      published_at   TEXT,
      retry_count    INTEGER DEFAULT 0,
      last_error     TEXT,
      created_at     TEXT    DEFAULT (datetime('now'))
    )
  `);
  return db;
}

// ─── Backoff Calculator ─────────────────────────────────────────────────

/**
 * Calculate the backoff delay in seconds for a given retry count.
 * Uses exponential backoff: 30s, 2min, 5min.
 * @param {number} retryCount - 0-based retry attempt (0 = first retry)
 * @returns {number} Delay in seconds
 */
function getBackoffSeconds(retryCount) {
  const backoffs = [30, 120, 300]; // 30s, 2min, 5min
  const idx = Math.min(retryCount, backoffs.length - 1);
  return backoffs[idx];
}

// ─── CRUD Operations ────────────────────────────────────────────────────

/**
 * Schedule a post for future publication.
 *
 * @param {string} articleId     - The news article ID
 * @param {string} text          - The Bluesky post text
 * @param {Date}   scheduledFor  - When to publish
 * @param {string} [imageUrl]    - Optional image URL
 * @param {string} [url]         - Optional article URL
 * @returns {number} The inserted row ID
 */
function schedulePost(articleId, text, scheduledFor, imageUrl, url) {
  const db = getDb();
  try {
    // Validate
    if (!articleId || !text || !scheduledFor) {
      throw new Error('articleId, text, and scheduledFor are required');
    }
    const isoDate = scheduledFor instanceof Date
      ? scheduledFor.toISOString()
      : new Date(scheduledFor).toISOString();

    const result = db.prepare(`
      INSERT INTO scheduled_posts (article_id, text, image_url, url, scheduled_for)
      VALUES (?, ?, ?, ?, ?)
    `).run(articleId, text, imageUrl || null, url || null, isoDate);

    console.log(`[scheduleManager] Scheduled post #${result.lastInsertRowid} for ${isoDate} (${articleId.slice(0, 8)})`);
    return Number(result.lastInsertRowid);
  } finally {
    db.close();
  }
}

/**
 * Get all scheduled posts (any status), newest first.
 * @returns {ScheduledPost[]}
 */
function getScheduledPosts() {
  const db = getDb();
  try {
    return db.prepare(`
      SELECT * FROM scheduled_posts ORDER BY created_at DESC
    `).all();
  } finally {
    db.close();
  }
}

/**
 * Get posts that are due for publishing:
 *   status = 'scheduled' AND scheduled_for <= datetime('now')
 * Ordered by scheduled_for ASC (oldest first).
 * @returns {ScheduledPost[]}
 */
function getDuePosts() {
  const db = getDb();
  try {
    return db.prepare(`
      SELECT * FROM scheduled_posts
      WHERE status = 'scheduled' AND scheduled_for <= datetime('now')
      ORDER BY scheduled_for ASC
    `).all();
  } finally {
    db.close();
  }
}

/**
 * Cancel a scheduled post.
 * @param {number} id - The scheduled post ID
 * @returns {boolean} True if a row was cancelled
 */
function cancelSchedule(id) {
  const db = getDb();
  try {
    const result = db.prepare(`
      UPDATE scheduled_posts SET status = 'cancelled' WHERE id = ? AND status = 'scheduled'
    `).run(id);
    const cancelled = result.changes > 0;
    if (cancelled) {
      console.log(`[scheduleManager] Cancelled scheduled post #${id}`);
    }
    return cancelled;
  } finally {
    db.close();
  }
}

/**
 * Mark a scheduled post as published.
 * @param {number} id - The scheduled post ID
 */
function markPublished(id) {
  const db = getDb();
  try {
    db.prepare(`
      UPDATE scheduled_posts
      SET status = 'published', published_at = datetime('now')
      WHERE id = ?
    `).run(id);
    console.log(`[scheduleManager] Marked post #${id} as published`);
  } finally {
    db.close();
  }
}

/**
 * Mark a scheduled post as failed (permanent failure after all retries exhausted).
 * @param {number} id    - The scheduled post ID
 * @param {string} error - The error message
 */
function markFailed(id, error) {
  const db = getDb();
  try {
    db.prepare(`
      UPDATE scheduled_posts
      SET status = 'failed', last_error = ?, published_at = datetime('now')
      WHERE id = ?
    `).run(error, id);
    console.log(`[scheduleManager] Marked post #${id} as failed: ${error.slice(0, 100)}`);
  } finally {
    db.close();
  }
}

/**
 * Handle a publish failure with retry logic.
 *
 * Increments retry_count. If retry_count < 3, reschedules the post
 * with exponential backoff (30s, 2min, 5min). Otherwise marks as failed.
 *
 * @param {number} id    - The scheduled post ID
 * @param {string} error - The error message
 */
function markFailedAndRetry(id, error) {
  const db = getDb();
  try {
    const post = db.prepare('SELECT retry_count FROM scheduled_posts WHERE id = ?').get(id);
    if (!post) {
      console.error(`[scheduleManager] Cannot retry: post #${id} not found`);
      return;
    }

    const retryCount = (post.retry_count || 0) + 1;
    const maxRetries = 3;

    if (retryCount >= maxRetries) {
      // Permanent failure — mark as failed
      db.prepare(`
        UPDATE scheduled_posts
        SET status = 'failed', last_error = ?, retry_count = ?
        WHERE id = ?
      `).run(error, retryCount, id);
      console.log(`[scheduleManager] Post #${id} failed permanently after ${retryCount} retries: ${error.slice(0, 100)}`);
    } else {
      // Reschedule with backoff
      const backoffSec = getBackoffSeconds(retryCount - 1);
      const newTime = new Date(Date.now() + backoffSec * 1000).toISOString();
      db.prepare(`
        UPDATE scheduled_posts
        SET status = 'scheduled', scheduled_for = ?, last_error = ?, retry_count = ?
        WHERE id = ?
      `).run(newTime, error, retryCount, id);
      console.log(`[scheduleManager] Post #${id} retry #${retryCount} — rescheduled in ${backoffSec}s`);
    }
  } finally {
    db.close();
  }
}

// ─── Standalone init ──────────────────────────────────────────────────

// If run directly as a script, initialize the table
if (require.main === module) {
  const db = getDb();
  console.log('[scheduleManager] ✅ scheduled_posts table ready');
  console.log(`[scheduleManager] DB: ${DB_PATH}`);
  db.close();
}

// ─── Exports ────────────────────────────────────────────────────────────

module.exports = {
  schedulePost,
  getScheduledPosts,
  getDuePosts,
  cancelSchedule,
  markPublished,
  markFailed,
  markFailedAndRetry,
};
