/**
 * Twitter Publisher — entry point.
 *
 * Starts the Express REST API server and the auto-publish background loop.
 */

import { config } from './config.js';
import { startServer } from './server.js';
import { startAutoPublish } from './autoPublish.js';
import { getQuotaInfo } from './rateLimiter.js';

console.log('══════════════════════════════════════════════');
console.log('  ArgentinaRadar — Twitter Publisher v0.1.0');
console.log('══════════════════════════════════════════════');

// Print initial quota
const quota = getQuotaInfo();
console.log(`  Monthly quota:   ${quota.used} / ${quota.limit} used (${quota.remaining} remaining)`);
console.log(`  AI filter URL:  ${config.aiFilter.url}`);
console.log(`  DB path:        ${config.db.path}`);
console.log('');

// Start REST API
startServer();

// Start background auto-publish loop
startAutoPublish();
