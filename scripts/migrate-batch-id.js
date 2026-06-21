const Database = require('better-sqlite3');
const path = require('path');
const dbPath = path.resolve(__dirname, '..', 'data', 'argentina-radar.db');
const db = new Database(dbPath);

// Add batch_id to approval_queue if it doesn't exist
const cols = db.prepare("PRAGMA table_info(approval_queue)").all().map(c => c.name);
if (!cols.includes('batch_id')) {
  db.exec('ALTER TABLE approval_queue ADD COLUMN batch_id TEXT');
  console.log('✅ batch_id column added to approval_queue');
} else {
  console.log('ℹ️  batch_id already exists');
}

db.close();
