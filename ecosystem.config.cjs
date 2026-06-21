/* eslint-env node */
/**
 * ArgentinaRadar — PM2 Ecosystem Configuration (Production)
 *
 * Start all services:   pm2 start ecosystem.config.cjs
 * Stop all services:    pm2 stop ecosystem.config.cjs
 * View status:          pm2 status
 * View logs:            pm2 logs <name>
 *
 * Restart policy:       restart on crash, max 5 restarts/min
 * Memory limit:         512 MB per process
 * Log files:            logs/{app-name}-out.log / logs/{app-name}-err.log
 */

const path = require('path');

const ROOT = __dirname;
const LOG_DIR = path.join(ROOT, 'logs');

/** Shared restart & resource policy applied to every app. */
const COMMON = {
  max_restarts: 5,          // give up after 5 consecutive crashes
  min_uptime: '10s',        // process must stay up at least this long to be "stable"
  max_memory_restart: '512M',
  log_date_format: 'YYYY-MM-DD HH:mm:ss',
  merge_logs: true,
  env: {
    NODE_ENV: 'production',
  },
};

module.exports = {
  apps: [
    // ─── News Ingestion (Node.js / tsx) ─────────────────────────────
    {
      name: 'news-ingestion',
      script: 'npx',
      args: 'tsx --env-file=config/.env src/index.ts',
      cwd: './services/news-ingestion',
      interpreter: 'none',
      error_file: path.join(LOG_DIR, 'news-ingestion-err.log'),
      out_file: path.join(LOG_DIR, 'news-ingestion-out.log'),
      ...COMMON,
    },

    // ─── Twitter Publisher (Node.js / tsx) ──────────────────────────
    {
      name: 'publisher',
      script: 'npx',
      args: 'tsx --env-file=config/.env src/index.ts',
      cwd: './services/twitter-publisher',
      interpreter: 'none',
      error_file: path.join(LOG_DIR, 'publisher-err.log'),
      out_file: path.join(LOG_DIR, 'publisher-out.log'),
      ...COMMON,
    },

    // ─── Telegram Notifier (Node.js / CommonJS — polling bot) ──────
    {
      name: 'notifier',
      script: 'node',
      args: 'services/hermes-bridge/telegram-notifier.js',
      cwd: '.',
      interpreter: 'none',
      error_file: path.join(LOG_DIR, 'notifier-err.log'),
      out_file: path.join(LOG_DIR, 'notifier-out.log'),
      ...COMMON,
    },

    // ─── AI Processor (Python / FastAPI) ────────────────────────────
    {
      name: 'ai-processor',
      script: '-m',
      args: 'uvicorn src.server:app --host 0.0.0.0 --port 3013',
      cwd: './services/ai-processor',
      interpreter: 'python',
      error_file: path.join(LOG_DIR, 'ai-processor-err.log'),
      out_file: path.join(LOG_DIR, 'ai-processor-out.log'),
      ...COMMON,
    },

    // ─── Admin Dashboard (Node.js / Express) ─────────────────────────
    {
      name: 'admin',
      script: 'npx',
      args: 'tsx --env-file=config/.env src/server.ts',
      cwd: './services/admin',
      interpreter: 'none',
      error_file: path.join(LOG_DIR, 'admin-err.log'),
      out_file: path.join(LOG_DIR, 'admin-out.log'),
      ...COMMON,
    },

    // ─── Frontend (Vite dev server — production build serve via preview for prod) ──
    {
      name: 'web',
      script: 'npx',
      args: 'vite --port 5173',
      cwd: './apps/web',
      interpreter: 'none',
      error_file: path.join(LOG_DIR, 'web-err.log'),
      out_file: path.join(LOG_DIR, 'web-out.log'),
      ...COMMON,
    },
  ],
};
