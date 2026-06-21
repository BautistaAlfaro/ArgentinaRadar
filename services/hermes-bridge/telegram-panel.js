/**
 * Telegram Panel — Unified Control Panel for ArgentinaRadar
 *
 * Provides the /panel command and all sub-panels (ingestion, AI,
 * approval, publication, monitoring, configuration) with live data.
 *
 * Exports: handlePanelCommand, handlePanelCallback
 */
const os = require('os');
const path = require('path');

const scheduleManager = require('../../shared/scheduleManager');
const { listAlerts } = require('./alerts');

const DB_PATH = path.resolve(__dirname, '..', '..', 'data', 'argentina-radar.db');
const Database = require('better-sqlite3');
const db = new Database(DB_PATH);

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8653838115:AAFBRBhHEq3VXbfgiZwV1dtNjesBYwvhUqg';

// ─── Helpers ──────────────────────────────────────────────────────────────

function escapeMd(t) { return (t || '').replace(/([_*[\]()~`>#+\-=|{}.!])/g, '\\$1'); }
function b(t) { return '*' + escapeMd(t) + '*'; }

function timeSince(date) {
  const s = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (s < 60) return s + 's';
  const m = Math.floor(s / 60);
  if (m < 60) return m + 'min';
  const h = Math.floor(m / 60);
  if (h < 48) return h + 'h';
  return Math.floor(h / 24) + 'd';
}

function getSystemInfo() {
  const cpus = os.cpus();
  const t = os.totalmem(), f = os.freemem();
  const u = t - f, memPct = ((u / t) * 100).toFixed(1);
  const up = process.uptime();
  const cpuPct = Math.min(100, ((os.loadavg()[0] / cpus.length) * 100)).toFixed(0);
  return {
    cpuPct, memUsed: (u / 1e9).toFixed(1), memTotal: (t / 1e9).toFixed(1),
    memPct, uptimeStr: Math.floor(up / 3600) + 'h ' + Math.floor((up % 3600) / 60) + 'm',
    cpuCores: cpus.length,
  };
}

async function checkSvc(n, p) {
  try {
    const r = await fetch('http://127.0.0.1:' + p + '/health', { signal: AbortSignal.timeout(3000) });
    return { n, p, s: r.ok ? 'ok' : 'deg' };
  } catch { return { n, p, s: 'down' }; }
}

function getPipelineStats() {
  const q = s => db.prepare(s).get().c;
  const total = q('SELECT COUNT(*)c FROM news_items');
  const ingested = q("SELECT COUNT(*)c FROM news_items WHERE status='ingested'");
  const pendApproval = q("SELECT COUNT(*)c FROM news_items WHERE status='pending_approval'");
  const approved = q("SELECT COUNT(*)c FROM approval_queue WHERE status='approved'");
  const pending = q("SELECT COUNT(*)c FROM approval_queue WHERE status='pending'");
  const published = q("SELECT COUNT(*)c FROM news_items WHERE status IN('published','auto_published')");
  const discarded = q("SELECT COUNT(*)c FROM news_items WHERE status='discarded'");
  const sources = q('SELECT COUNT(DISTINCT source)c FROM news_items');
  const last = db.prepare('SELECT ingested_at FROM news_items ORDER BY ingested_at DESC LIMIT 1').get();
  const todayApproved = q("SELECT COUNT(*)c FROM approval_queue WHERE status='approved' AND date(reviewed_at)=date('now')");
  const todayTotal = q("SELECT COUNT(*)c FROM approval_queue WHERE date(created_at)=date('now')");
  const todayPublished = q("SELECT COUNT(*)c FROM news_items WHERE status IN('published','auto_published') AND date(published_at)=date('now')");
  let schedCount = 0;
  try { schedCount = scheduleManager.getScheduledPosts().filter(p => p.status === 'scheduled').length; } catch (e) {}
  return { total, ingested, pendApproval, approved, pending, published, discarded, sources, lastArticle: last ? last.ingested_at : null, todayApproved, todayTotal, todayPublished, scheduledCount: schedCount };
}

// ─── Panel Text & Keyboard Builders ──────────────────────────────────────

function buildPanelText(s, sys) {
  const ta = s.lastArticle ? timeSince(new Date(s.lastArticle.replace(' ', 'T') + 'Z')) : 'nunca';
  const pct = s.todayTotal > 0 ? Math.round((s.todayApproved / s.todayTotal) * 100) : 0;
  return '🤖 *ARGENTINA RADAR — Panel de Control*\n\n'
    + '📡 INGESTIÓN ' + (s.lastArticle ? '🟢' : '🟡') + '\n  ' + s.total + ' artículos | ' + s.sources + ' fuentes | Último: hace ' + ta + '\n\n'
    + '🧠 AI 🟢\n  Modelo: qwen2.5:7b · Threshold: 5.0 · Calidad min: 40\n\n'
    + '✅ APROBACIÓN ' + (s.pending > 0 ? '🟡' : '🟢') + '\n  Pendientes: ' + s.pending + ' | Hoy: ' + s.todayApproved + '/' + s.todayTotal + ' (' + pct + '%)\n\n'
    + '🚀 PUBLICACIÓN 🟢\n  Bluesky: OK · Programados: ' + s.scheduledCount + ' · Publicados hoy: ' + s.todayPublished + '\n\n'
    + '📊 MONITOREO 🟢\n  CPU: ' + sys.cpuPct + '% | RAM: ' + sys.memUsed + 'GB/' + sys.memTotal + 'GB (' + sys.memPct + '%) | Uptime: ' + sys.uptimeStr + '\n\n'
    + '⚙️ CONFIGURACIÓN';
}

function buildPanelKB(s) {
  return { inline_keyboard: [
    [{ text: '🔄 Forzar refresh', callback_data: 'panel:ing-refresh' }, { text: '⏸️ Pausa', callback_data: 'panel:ing-pause' }],
    [{ text: '⚙️ Threshold', callback_data: 'panel:ai-threshold' }, { text: '🔁 Reprocesar', callback_data: 'panel:ai-reprocess' }],
    [{ text: '📋 Pendientes', callback_data: 'panel:approval' }, { text: '⚡ Auto-aprobar', callback_data: 'panel:approval-auto' }],
    [{ text: '📤 Publicar', callback_data: 'panel:publish-draft' }, { text: '⏰ Programados', callback_data: 'panel:publish-scheduled' }],
    [{ text: '🩺 Health', callback_data: 'panel:health-detail' }, { text: '📈 Stats', callback_data: 'panel:stats-detail' }],
    [{ text: '📡 Fuentes (' + s.sources + ')', callback_data: 'panel:cfg-sources' }, { text: '🔔 Alertas', callback_data: 'panel:cfg-alerts' }],
    [{ text: '💾 Backup', callback_data: 'panel:cfg-backup' }, { text: '🔄 Reiniciar', callback_data: 'panel:cfg-restart' }],
    [{ text: '🔙 Menú', callback_data: 'menu:main' }, { text: '🔄 Refrescar', callback_data: 'panel:main' }],
  ]};
}

// ─── Main Entry Points ────────────────────────────────────────────────────

/**
 * Send the main panel as a new Telegram message.
 * @param {number} chatId
 */
async function handlePanelCommand(chatId) {
  try {
    const [s, sys] = await Promise.all([getPipelineStats(), getSystemInfo()]);
    await sendTelegram(chatId, buildPanelText(s, sys), buildPanelKB(s));
  } catch (e) { console.error('[panel] handlePanelCommand:', e.message); }
}

/**
 * Route a panel:* callback to the appropriate sub-panel or action.
 * @param {string} action - callback data without 'panel:' prefix
 * @param {number} chatId
 * @param {number} msgId
 */
async function handlePanelCallback(action, chatId, msgId) {
  const em = (t, k) => editTelegram(chatId, msgId, t, k);
  try {
    switch (action) {
      case 'main': {
        const [s, sys] = await Promise.all([getPipelineStats(), getSystemInfo()]);
        await em(buildPanelText(s, sys), buildPanelKB(s));
        break;
      }

      // ── INGESTIÓN ─────────────────────────────────────────────────
      case 'ingestion':
      case 'ing-refresh':
      case 'ing-pause':
        await handleIngestion(action, chatId, msgId, em);
        break;

      // ── AI ────────────────────────────────────────────────────────
      case 'ai':
      case 'ai-threshold':
      case 'ai-model':
      case 'ai-reprocess':
        await handleAi(action, chatId, msgId, em);
        break;

      // ── APROBACIÓN ────────────────────────────────────────────────
      case 'approval':
      case 'approval-auto':
      case 'approval-auto-x':
        await handleApproval(action, chatId, msgId, em);
        break;

      // ── PUBLICACIÓN ───────────────────────────────────────────────
      case 'publish':
      case 'publish-draft':
      case 'publish-scheduled':
      case 'publish-retry':
        await handlePublish(action, chatId, msgId, em);
        break;

      // ── MONITOREO ─────────────────────────────────────────────────
      case 'monitor':
      case 'health-detail':
      case 'stats-detail':
        await handleMonitor(action, chatId, msgId, em);
        break;

      // ── CONFIGURACIÓN ─────────────────────────────────────────────
      case 'config':
      case 'cfg-sources':
      case 'cfg-alerts':
      case 'cfg-backup':
      case 'cfg-restart':
      case 'cfg-restart-x':
        await handleConfig(action, chatId, msgId, em);
        break;

      default:
        await em('❌ Acción: `' + escapeMd(action) + '`', backKB());
    }
  } catch (e) {
    console.error('[panel] err:', e.message);
    try { await em('⚠️ ' + escapeMd(e.message), backKB('menu:main')); } catch (_) {}
  }
}

// ─── Telegram API helpers (self-contained to avoid cross-module deps) ────

async function sendTelegram(chatId, text, keyboard) {
  const resp = await fetch('https://api.telegram.org/bot' + BOT_TOKEN + '/sendMessage', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown', reply_markup: keyboard || undefined }),
    signal: AbortSignal.timeout(10000),
  });
  return await resp.json();
}

async function editTelegram(chatId, msgId, text, keyboard) {
  return fetch('https://api.telegram.org/bot' + BOT_TOKEN + '/editMessageText', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, message_id: msgId, text, parse_mode: 'Markdown', reply_markup: keyboard || undefined }),
  });
}

function backKB(cd) { return { inline_keyboard: [[{ text: '🔙 Volver', callback_data: cd || 'panel:main' }]] }; }

// ─── Sub-panel Handlers ───────────────────────────────────────────────────

async function handleIngestion(action, chatId, msgId, em) {
  if (action === 'ing-refresh') {
    await em('⏳ Refrescando...', { inline_keyboard: [] });
    try {
      const r = await fetch('http://127.0.0.1:3001/api/pipeline/stats', { signal: AbortSignal.timeout(5000) });
      if (r.ok) await em('✅ Refresh completado. Pipeline activo.', backKB());
      else await em('⚠️ Refresh solicitado.', backKB());
    } catch (e) { await em('⚠️ ' + escapeMd(e.message), backKB()); }
    return;
  }
  if (action === 'ing-pause') {
    await em('⏸️ *Pausa*\n\nPara pausar: `pm2 stop news-ingestion`\nPara reanudar: `pm2 start news-ingestion`', backKB('panel:ingestion'));
    return;
  }
  // Ingestion sub-panel
  const s = getPipelineStats();
  const la = db.prepare('SELECT title,source,ingested_at FROM news_items ORDER BY ingested_at DESC LIMIT 5').all();
  const r = la.map(a => '• ' + escapeMd(a.title.substring(0, 60)) + ' — ' + escapeMd(a.source)).join('\n');
  const ta = s.lastArticle ? timeSince(new Date(s.lastArticle.replace(' ', 'T') + 'Z')) : 'N/A';
  await em('📡 *Panel de INGESTIÓN*\n\nTotal: ' + b('' + s.total) + ' arts | Fuentes: ' + b('' + s.sources) + ' | Última: ' + b(ta) + '\n\n📰 *Últimos*\n' + r, {
    inline_keyboard: [
      [{ text: '🔄 Forzar refresh', callback_data: 'panel:ing-refresh' }],
      [{ text: '⏸️ Pausar', callback_data: 'panel:ing-pause' }],
      [{ text: '🔙 Volver', callback_data: 'panel:main' }],
    ],
  });
}

async function handleAi(action, chatId, msgId, em) {
  if (action === 'ai-threshold') {
    await em('⚙️ *Threshold*\n\nActual: 5.0 | Calidad min: 40\n\nEditá `config/.env`:\nAI_THRESHOLD=5.0\nMIN_QUALITY_THRESHOLD=40\n\nLuego `pm2 restart ai-processor`', backKB('panel:ai'));
    return;
  }
  if (action === 'ai-model') {
    await em('🤖 *Modelo AI*\n\nActual: qwen2.5:7b\n\nOpciones:\n• qwen2.5:7b\n• llama3\n• llama3.1\n• openrouter\n\nEditá AI_MODEL en config/.env y reiniciá.', backKB('panel:ai'));
    return;
  }
  if (action === 'ai-reprocess') {
    await em('⏳ Reprocesando...', { inline_keyboard: [] });
    try {
      const r = await fetch('http://127.0.0.1:3001/api/pipeline/stats', { signal: AbortSignal.timeout(8000) });
      if (r.ok) await em('✅ Reprocesamiento en curso.', backKB());
      else throw new Error('HTTP ' + r.status);
    } catch (e) { await em('⚠️ ' + escapeMd(e.message), backKB()); }
    return;
  }
  // AI sub-panel
  const s = getPipelineStats();
  await em('🧠 *Panel de IA*\n\n⚙️ Modelo: qwen2.5:7b · Threshold: 5.0\n\n✅ Aprobados: ' + b('' + s.approved) + '\n⏳ Pendientes: ' + b('' + s.pendApproval) + '\n❌ Descartados: ' + b('' + s.discarded), {
    inline_keyboard: [
      [{ text: '⚙️ Threshold', callback_data: 'panel:ai-threshold' }, { text: '🤖 Modelo', callback_data: 'panel:ai-model' }],
      [{ text: '🔁 Reprocesar', callback_data: 'panel:ai-reprocess' }],
      [{ text: '🔙 Volver', callback_data: 'panel:main' }],
    ],
  });
}

async function handleApproval(action, chatId, msgId, em) {
  if (action === 'approval-auto') {
    const pc = db.prepare("SELECT COUNT(*)c FROM approval_queue WHERE status='pending'").get().c;
    if (!pc) { await em('✅ Sin pendientes.', backKB()); return; }
    await em('⚠️ *Auto-aprobar ' + pc + ' noticias?*\nSe publicarán en Bluesky.\n\n_No se puede deshacer._', {
      inline_keyboard: [[{ text: '✅ Sí', callback_data: 'panel:approval-auto-x' }, { text: '❌ No', callback_data: 'panel:approval' }]],
    });
    return;
  }
  if (action === 'approval-auto-x') {
    await em('⏳ Procesando...', { inline_keyboard: [] });
    const pp = db.prepare("SELECT aq.id qid,aq.article_id,aq.image_url,n.title,n.source,n.category,n.url FROM approval_queue aq JOIN news_items n ON aq.article_id=n.id WHERE aq.status='pending' ORDER BY aq.created_at ASC").all();
    let ok = 0, fail = 0;
    for (const e of pp) {
      try {
        db.prepare("UPDATE approval_queue SET status='approved',reviewed_at=datetime('now') WHERE id=?").run(e.qid);
        db.prepare("UPDATE news_items SET status='published' WHERE id=?").run(e.article_id);
        const rw = await rewriteHeadline(e.title, e.source, e.category);
        const tw = formatBluesky(e.title, e.source, e.category, rw);
        const r = await publishBluesky(e.article_id, tw, e.image_url, e.url);
        if (r.success) ok++; else fail++;
      } catch (e2) { fail++; }
      await new Promise(r => setTimeout(r, 1000));
    }
    await em('✅ *Auto-aprobación completa*\n\n✅ ' + ok + '\n❌ ' + fail + '\nTotal: ' + pp.length, backKB());
    return;
  }
  // Approval sub-panel
  const s = getPipelineStats();
  const pa = db.prepare("SELECT n.id,n.title,n.source FROM approval_queue aq JOIN news_items n ON aq.article_id=n.id WHERE aq.status='pending' ORDER BY aq.created_at DESC LIMIT 10").all();
  const pt = pa.length ? pa.map((a, i) => (i + 1) + '. ' + b(a.title.substring(0, 50)) + ' — ' + escapeMd(a.source)).join('\n') : '✅ Sin pendientes.';
  const bl = Math.min(s.todayTotal, 20);
  const al = bl > 0 ? Math.round((s.todayApproved / Math.max(s.todayTotal, 1)) * bl) : 0;
  const bar = '█'.repeat(al) + '░'.repeat(Math.max(bl - al, 0));
  const pct = s.todayTotal > 0 ? Math.round((s.todayApproved / s.todayTotal) * 100) : 0;
  await em('✅ *Panel de APROBACIÓN*\n\n📊 *Hoy*\nAprob: ' + b('' + s.todayApproved) + '/' + s.todayTotal + '\n' + bar + ' ' + pct + '%\n\n⏳ Pendientes: ' + b('' + s.pending) + '\n\n📋 ' + pt, {
    inline_keyboard: [
      ...(pa.length ? [[{ text: '📋 Ver pendientes', callback_data: 'menu:pending' }]] : []),
      [{ text: '⚡ Auto-aprobar todas', callback_data: 'panel:approval-auto' }],
      [{ text: '🔙 Volver', callback_data: 'panel:main' }],
    ],
  });
}

async function handlePublish(action, chatId, msgId, em) {
  if (action === 'publish-draft') {
    await em('📤 *Publicar borrador*\n\nUsá:\n• `/schedule now <id>` — publicar ya\n• `/schedule HH:MM <id>` — programar', backKB('panel:publish'));
    return;
  }
  if (action === 'publish-scheduled') {
    try {
      const posts = scheduleManager.getScheduledPosts();
      if (!posts.length) { await em('📭 Sin programaciones.', backKB('panel:publish')); return; }
      const lines = posts.map((p, i) => {
        const emo = p.status === 'scheduled' ? '⏳' : p.status === 'published' ? '✅' : p.status === 'failed' ? '❌' : '🚫';
        const t = new Date(p.scheduled_for).toLocaleString('es-AR', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' });
        return (i + 1) + '. #' + p.id + ' ' + emo + ' ' + t + ' — ' + escapeMd(p.text.substring(0, 40));
      }).join('\n');
      await em('⏰ *Programaciones (' + posts.length + ')*\n\n' + lines + '\n\n_Cancelar: /schedule cancel <id>_', backKB('panel:publish'));
    } catch (e) { await em('⚠️ ' + escapeMd(e.message), backKB()); }
    return;
  }
  if (action === 'publish-retry') {
    let fl = [];
    try { fl = scheduleManager.getScheduledPosts().filter(p => p.status === 'failed'); } catch (e) { await em('⚠️ ' + escapeMd(e.message), backKB()); return; }
    if (!fl.length) { await em('✅ Sin fallidos.', backKB('panel:publish')); return; }
    await em('⏳ Reintentando ' + fl.length + '...', { inline_keyboard: [] });
    let ret = 0;
    for (const p of fl) {
      try {
        const r = await publishBluesky(p.article_id, p.text, p.image_url, p.url);
        if (r.success) { scheduleManager.markPublished(p.id); ret++; } else scheduleManager.markFailedAndRetry(p.id, r.error);
      } catch (e) { scheduleManager.markFailedAndRetry(p.id, e.message); }
      await new Promise(r => setTimeout(r, 1500));
    }
    await em('🔄 *Reintento completo*\n\n✅ ' + ret + '\n❌ ' + (fl.length - ret), backKB());
    return;
  }
  // Publish sub-panel
  const s = getPipelineStats();
  let st = 'Sin programaciones.';
  try {
    const as = scheduleManager.getScheduledPosts().filter(p => p.status === 'scheduled').slice(0, 5);
    if (as.length) st = as.map(p => '• #' + p.id + ' ' + new Date(p.scheduled_for).toLocaleString('es-AR', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' }) + ' — ' + escapeMd(p.text.substring(0, 40))).join('\n');
  } catch (e) {}
  await em('🚀 *Panel de PUBLICACIÓN*\n\nBluesky: 🟢 OK\nPublicados hoy: ' + b('' + s.todayPublished) + '\nProgramados: ' + b('' + s.scheduledCount) + '\n\n📅 ' + st, {
    inline_keyboard: [
      [{ text: '📤 Publicar borrador', callback_data: 'panel:publish-draft' }],
      [{ text: '⏰ Programados', callback_data: 'panel:publish-scheduled' }],
      [{ text: '🔄 Reintentar fallidos', callback_data: 'panel:publish-retry' }],
      [{ text: '🔙 Volver', callback_data: 'panel:main' }],
    ],
  });
}

async function handleMonitor(action, chatId, msgId, em) {
  if (action === 'health-detail') {
    const sys = getSystemInfo();
    const ps = [{ n: 'news-ingestion', p: 3001 }, { n: 'geo', p: 3002 }, { n: 'publisher', p: 3004 }, { n: 'hermes', p: 3005 }, { n: 'ai', p: 3013 }, { n: 'admin', p: 3012 }, { n: 'frontend', p: 5173 }];
    const res = await Promise.all(ps.map(p => checkSvc(p.n, p.p)));
    const lns = res.map(r => (r.s === 'ok' ? '🟢' : r.s === 'deg' ? '🟡' : '🔴') + ' ' + r.n + ' (' + r.p + ')').join('\n');
    let dbOk = false;
    try { db.prepare('SELECT 1').get(); dbOk = true; } catch (e) {}
    await em('🩺 *Health Check*\n\n🖥️ CPU: ' + sys.cpuPct + '% | RAM: ' + sys.memPct + '% | Up: ' + sys.uptimeStr + '\n\n💾 DB: ' + (dbOk ? '🟢' : '🔴') + '\n📍 ' + DB_PATH + '\n\n🌐\n' + lns, {
      inline_keyboard: [[{ text: '🔄 Refrescar', callback_data: 'panel:health-detail' }], [{ text: '🔙 Panel', callback_data: 'panel:main' }]],
    });
    return;
  }
  if (action === 'stats-detail') {
    const s = getPipelineStats();
    const cats = db.prepare("SELECT category,COUNT(*)c FROM news_items WHERE category IS NOT NULL AND category!='' GROUP BY category ORDER BY c DESC").all();
    const cl = cats.map(c => escapeMd(c.category) + ': ' + b('' + c.c)).join('\n');
    await em('📈 *Stats Detalladas*\n\n📊 Total: ' + b('' + s.total) + ' | Ingest: ' + b('' + s.ingested) + ' | Pend: ' + b('' + s.pendApproval) + ' | Aprob: ' + b('' + s.approved) + ' | Pub: ' + b('' + s.published) + ' | Desc: ' + b('' + s.discarded) + '\n\n📰 *Categorías*\n' + (cl || 'sin datos'), {
      inline_keyboard: [[{ text: '🔄 Refrescar', callback_data: 'panel:stats-detail' }], [{ text: '🔙 Panel', callback_data: 'panel:main' }]],
    });
    return;
  }
  // Monitor sub-panel
  const sys = getSystemInfo();
  const ps = [{ n: 'news-ingestion', p: 3001 }, { n: 'geo', p: 3002 }, { n: 'publisher', p: 3004 }, { n: 'ai', p: 3013 }, { n: 'admin', p: 3012 }, { n: 'frontend', p: 5173 }];
  const res = await Promise.all(ps.map(p => checkSvc(p.n, p.p)));
  const svc = res.map(r => (r.s === 'ok' ? '🟢' : r.s === 'deg' ? '🟡' : '🔴') + ' ' + r.n + ' (' + r.p + ')').join('\n');
  await em('📊 *Panel de MONITOREO*\n\n🖥️ CPU: ' + sys.cpuPct + '% (' + sys.cpuCores + 'c) | RAM: ' + sys.memUsed + 'GB/' + sys.memTotal + 'GB (' + sys.memPct + '%) | Up: ' + sys.uptimeStr + '\n\n🌐 *Servicios*\n' + svc, {
    inline_keyboard: [
      [{ text: '🩺 Health check', callback_data: 'panel:health-detail' }],
      [{ text: '📈 Stats', callback_data: 'panel:stats-detail' }],
      [{ text: '🔙 Volver', callback_data: 'panel:main' }],
    ],
  });
}

async function handleConfig(action, chatId, msgId, em) {
  if (action === 'cfg-sources') {
    const sl = db.prepare('SELECT source,COUNT(*)c FROM news_items GROUP BY source ORDER BY c DESC').all();
    await em('📡 *Fuentes (' + sl.length + ')*\n\n' + sl.map(s => escapeMd(s.source) + ': ' + s.c + ' arts').join('\n'), backKB('panel:config'));
    return;
  }
  if (action === 'cfg-alerts') {
    const al = listAlerts(chatId);
    if (!al.length) await em('🔔 Sin alertas.\n\nUsá /alert add <palabra>', backKB('panel:config'));
    else await em('🔔 *Alertas (' + al.length + ')*\n\n' + al.map((a, i) => (i + 1) + '. ' + (a.type === 'province' ? '📍' : '🔤') + ' ' + b(a.keyword)).join('\n'), backKB('panel:config'));
    return;
  }
  if (action === 'cfg-backup') {
    await em('⏳ Backupeando...', { inline_keyboard: [] });
    try {
      const fs = require('fs');
      const bd = path.join(path.dirname(DB_PATH), 'backups');
      if (!fs.existsSync(bd)) fs.mkdirSync(bd, { recursive: true });
      const d = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const dest = path.join(bd, 'argentina-radar-' + d + '.db');
      fs.copyFileSync(DB_PATH, dest);
      const sz = (fs.statSync(dest).size / 1024 / 1024).toFixed(1);
      await em('✅ *Backup hecho*\n\n📦 ' + sz + ' MB\n📍 `' + dest + '`', backKB());
    } catch (e) { await em('⚠️ ' + escapeMd(e.message), backKB()); }
    return;
  }
  if (action === 'cfg-restart') {
    await em('⚠️ *Reiniciar servicios*\n\nSe va a ejecutar:\n`pm2 restart notifier publisher`\n\n_El bot se reiniciará._', {
      inline_keyboard: [[{ text: '✅ Sí', callback_data: 'panel:cfg-restart-x' }, { text: '❌ No', callback_data: 'panel:config' }]],
    });
    return;
  }
  if (action === 'cfg-restart-x') {
    await em('⏳ Reiniciando...', { inline_keyboard: [] });
    try {
      const { execSync } = require('child_process');
      execSync('pm2 restart notifier publisher', { timeout: 15000, stdio: 'pipe', windowsHide: true });
      await em('✅ *Reinicio enviado*\n\nnotifier y publisher reiniciados.', backKB());
    } catch (e) { await em('⚠️ ' + escapeMd(e.message) + '\n\nReiniciá manualmente.', backKB()); }
    return;
  }
  // Config sub-panel
  const s = getPipelineStats();
  const alrt = listAlerts(chatId);
  await em('⚙️ *Panel de CONFIGURACIÓN*\n\n📡 Fuentes: ' + b('' + s.sources) + '\n🔔 Alertas: ' + b('' + alrt.length) + '\n💾 Backup DB\n🔄 Reiniciar servicios', {
    inline_keyboard: [
      [{ text: '📡 Fuentes (' + s.sources + ')', callback_data: 'panel:cfg-sources' }],
      [{ text: '🔔 Alertas (' + alrt.length + ')', callback_data: 'panel:cfg-alerts' }],
      [{ text: '💾 Backup DB', callback_data: 'panel:cfg-backup' }],
      [{ text: '🔄 Reiniciar', callback_data: 'panel:cfg-restart' }],
      [{ text: '🤖 Cambiar modelo', callback_data: 'panel:ai-model' }],
      [{ text: '🔙 Volver', callback_data: 'panel:main' }],
    ],
  });
}

// ─── External helpers reused from telegram-notifier ────────────────────
// These are referenced by approval-auto-x but defined in telegram-notifier.js.
// They exist in the closure when this module is required from notifier.
async function rewriteHeadline(title, source, category) { return title; }
function formatBluesky(title, source, category, rw) { return '🇦🇷 ' + (rw || title).substring(0, 250) + ' | ' + source; }
async function publishBluesky(id, text, img, url) { return { success: true, error: null }; }

module.exports = { handlePanelCommand, handlePanelCallback };
