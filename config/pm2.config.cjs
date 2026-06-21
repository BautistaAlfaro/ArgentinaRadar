/* eslint-env node */
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const LOG_DIR = path.join(ROOT, 'logs');

module.exports = {
  apps: [
    // ─── Web app (Vite dev server) ──────────────────────────────
    {
      name: 'web-app',
      cwd: ROOT,
      script: 'cmd.exe',
      args: '/c npx.cmd --workspace=@argentinaradar/web vite --host',
      interpreter: 'none',
      windowsHide: true,
      env: { NODE_ENV: 'development' },
      watch: false,
      max_memory_restart: '500M',
      error_file: path.join(LOG_DIR, 'web-error.log'),
      out_file: path.join(LOG_DIR, 'web-out.log'),
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,
    },

    // ─── News ingestion ─────────────────────────────────────────
    {
      name: 'news-ingestion',
      cwd: ROOT,
      script: 'cmd.exe',
      args: '/c node --loader ts-node/esm services/news-ingestion/src/index.ts',
      interpreter: 'none',
      windowsHide: true,
      env: {
        NODE_ENV: 'development',
        PORT: '3001',
        INGESTION_INTERVAL: '300000',
      },
      watch: ['services/news-ingestion/src', 'shared/types', 'data/sources.json'],
      max_memory_restart: '500M',
      error_file: path.join(LOG_DIR, 'news-ingestion-error.log'),
      out_file: path.join(LOG_DIR, 'news-ingestion-out.log'),
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,
    },

    // ─── Geolocation ────────────────────────────────────────────
    {
      name: 'geolocation',
      cwd: ROOT,
      script: 'cmd.exe',
      args: '/c node --loader ts-node/esm services/geolocation/src/server.ts',
      interpreter: 'none',
      windowsHide: true,
      env: {
        NODE_ENV: 'development',
        PORT: '3002',
        NEWS_SERVICE_URL: 'http://localhost:3001',
        POLL_INTERVAL: '30000',
      },
      watch: ['services/geolocation/src', 'shared/gazetteer', 'shared/types'],
      max_memory_restart: '500M',
      error_file: path.join(LOG_DIR, 'geolocation-error.log'),
      out_file: path.join(LOG_DIR, 'geolocation-out.log'),
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,
    },

    // ─── AI Filter (Python / FastAPI) ───────────────────────────
    {
      name: 'ai-filter',
      cwd: path.join(ROOT, 'services', 'ai-filter'),
      script: 'cmd.exe',
      args: '/c python -m uvicorn src.server:app --host 0.0.0.0 --port 3003',
      interpreter: 'none',
      windowsHide: true,
      env: {
        NODE_ENV: 'development',
        PORT: '3003',
        PYTHONPATH: '.',
        DB_PATH: path.join(ROOT, 'data', 'argentina-radar.db'),
        GEOLOCATION_URL: 'http://localhost:3002',
        POLL_INTERVAL: '60',
        AI_DAILY_BUDGET: '0.50',
      },
      watch: ['src'],
      max_memory_restart: '500M',
      error_file: path.join(LOG_DIR, 'ai-filter-error.log'),
      out_file: path.join(LOG_DIR, 'ai-filter-out.log'),
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,
    },

    // ─── Twitter Publisher (Node.js / Express)  ─────────────────
    {
      name: 'twitter-publisher',
      cwd: ROOT,
      script: 'cmd.exe',
      args: '/c node --loader ts-node/esm services/twitter-publisher/src/index.ts',
      interpreter: 'none',
      windowsHide: true,
      env: {
        NODE_ENV: 'development',
        PORT: '3004',
        AI_FILTER_URL: 'http://localhost:3003',
        POLL_INTERVAL: '300000',
      },
      watch: ['services/twitter-publisher/src', 'shared/types'],
      max_memory_restart: '500M',
      error_file: path.join(LOG_DIR, 'twitter-publisher-error.log'),
      out_file: path.join(LOG_DIR, 'twitter-publisher-out.log'),
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,
    },
  ],
};
