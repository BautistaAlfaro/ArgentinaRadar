#!/usr/bin/env node
/**
 * Clean Image Cache — ArgentinaRadar
 *
 * Removes cached Gemini-generated images older than 7 days
 * from data/images/ to free disk space.
 *
 * Usage:
 *   node scripts/clean-image-cache.js              # dry-run (no delete)
 *   node scripts/clean-image-cache.js --apply       # actually delete expired files
 *   node scripts/clean-image-cache.js --max-age 14  # custom max age in days
 *   node scripts/clean-image-cache.js --apply --max-age 14
 *
 * Can also be run as a cron job / scheduled task:
 *   0 3 * * * cd /path/to/argentinaradar && node scripts/clean-image-cache.js --apply
 */

const fs = require('fs');
const path = require('path');

// ─── Config ────────────────────────────────────────────────────────────────

const IMAGE_CACHE_DIR = path.resolve(__dirname, '..', 'data', 'images');
const DEFAULT_MAX_AGE_DAYS = 7;

// ─── Parse CLI args ────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const HELP = args.includes('--help') || args.includes('-h');

let maxAgeDays = DEFAULT_MAX_AGE_DAYS;
const ageArg = args.find(a => a.startsWith('--max-age='));
if (ageArg) {
  const parsed = parseInt(ageArg.split('=')[1], 10);
  if (!isNaN(parsed) && parsed > 0) maxAgeDays = parsed;
}

// ─── Help ──────────────────────────────────────────────────────────────────

if (HELP) {
  console.log(`
  Clean Image Cache — ArgentinaRadar

  Removes cached images older than ${DEFAULT_MAX_AGE_DAYS} days from data/images/.

  Usage:
    node scripts/clean-image-cache.js              dry-run (list only)
    node scripts/clean-image-cache.js --apply      delete expired files
    node scripts/clean-image-cache.js --max-age=14 custom max age (days)
    node scripts/clean-image-cache.js --help       show this help

  Schedule (cron): 0 3 * * * cd /app && node scripts/clean-image-cache.js --apply
  `);
  process.exit(0);
}

// ─── Main ──────────────────────────────────────────────────────────────────

function main() {
  if (!fs.existsSync(IMAGE_CACHE_DIR)) {
    console.log(`[clean-cache] Cache directory not found: ${IMAGE_CACHE_DIR}`);
    console.log('[clean-cache] Nothing to clean.');
    process.exit(0);
  }

  const files = fs.readdirSync(IMAGE_CACHE_DIR);
  const now = Date.now();
  const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
  const cutoff = new Date(now - maxAgeMs);

  let expiredCount = 0;
  let totalSize = 0;
  const expiredFiles = [];

  for (const file of files) {
    const filePath = path.join(IMAGE_CACHE_DIR, file);

    // Skip directories and non-PNG files (defensive)
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) continue;
    if (!file.endsWith('.png')) continue;

    if (stat.mtimeMs < now - maxAgeMs) {
      expiredCount++;
      totalSize += stat.size;
      expiredFiles.push({ file, size: stat.size, mtime: stat.mtime });
    }
  }

  // ── Summary ──────────────────────────────────────────────────────────────

  const sizeMB = (totalSize / (1024 * 1024)).toFixed(2);
  const keptCount = files.length - expiredCount;

  console.log(`\n  Image Cache: ${IMAGE_CACHE_DIR}`);
  console.log(`  Max age: ${maxAgeDays} days (cutoff: ${cutoff.toISOString().split('T')[0]})`);
  console.log(`  Total files: ${files.length} (${keptCount} kept, ${expiredCount} expired)`);
  console.log(`  Expired size: ${sizeMB} MB`);
  console.log(`  Mode: ${APPLY ? 'APPLY — deleting' : 'DRY-RUN — no changes'}\n`);

  if (expiredFiles.length > 0 && APPLY) {
    for (const { file, size } of expiredFiles) {
      const filePath = path.join(IMAGE_CACHE_DIR, file);
      try {
        fs.unlinkSync(filePath);
        console.log(`  🗑️  Deleted: ${file} (${(size / 1024).toFixed(1)}KB)`);
      } catch (err) {
        console.error(`  ❌ Failed: ${file} — ${err.message}`);
      }
    }

    // Remove directory if empty after cleanup
    const remaining = fs.readdirSync(IMAGE_CACHE_DIR).filter(f => f.endsWith('.png'));
    if (remaining.length === 0) {
      try {
        fs.rmdirSync(IMAGE_CACHE_DIR);
        console.log(`\n  📁 Removed empty cache directory.`);
      } catch (err) {
        // Directory not empty or permission issue — not critical
      }
    }

    console.log(`\n  ✅ Cleaned ${expiredFiles.length} expired images (${sizeMB} MB freed).`);
  } else if (expiredFiles.length > 0) {
    for (const { file, size, mtime } of expiredFiles) {
      const age = Math.round((now - mtime) / (24 * 60 * 60 * 1000));
      console.log(`  📄 ${file} — ${(size / 1024).toFixed(1)}KB — ${age} days old`);
    }
    console.log(`\n  Run with --apply to delete these ${expiredCount} files.`);
  } else {
    console.log('  ✅ No expired images found. Cache is clean.');
  }
}

main();
