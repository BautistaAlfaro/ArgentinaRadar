/* eslint-env node */
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const LOG_DIR = path.join(ROOT, 'logs');

module.exports = {
  apps: [
    {
      name: 'web-app',
      cwd: ROOT,
      script: 'cmd.exe',
      args: '/c npx.cmd --workspace=@argentinaradar/web vite --host',
      interpreter: 'none',
      windowsHide: true,
      env: {
        NODE_ENV: 'development',
      },
      watch: false,
      max_memory_restart: '500M',
      error_file: path.join(LOG_DIR, 'web-error.log'),
      out_file: path.join(LOG_DIR, 'web-out.log'),
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,
    },
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
  ],
};
