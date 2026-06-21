/**
 * Simple Telegram Approval Notifier
 * Polls approval_queue and sends approval requests to Telegram with inline buttons.
 * Runs as a standalone Node.js process.
 */
const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.resolve(__dirname, '..', '..', 'data', 'argentina-radar.db');
const BOT_TOKEN = '8653838115:AAFBRBhHEq3VXbfgiZwV1dtNjesBYwvhUqg';
const CHAT_ID = '1923443777';
const POLL_INTERVAL = 10000; // 10 seconds

const db = new Database(DB_PATH);

async function sendToTelegram(text, keyboard) {
  const body = JSON.stringify({
    chat_id: parseInt(CHAT_ID),
    text: text,
    parse_mode: 'Markdown',
    reply_markup: keyboard || undefined,
  });

  try {
    const resp = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body,
    });
    const data = await resp.json();
    return data;
  } catch (e) {
    console.error('Telegram error:', e.message);
    return null;
  }
}

async function sendPhoto(caption, imageUrl, keyboard) {
  const body = JSON.stringify({
    chat_id: parseInt(CHAT_ID),
    photo: imageUrl,
    caption: caption,
    parse_mode: 'Markdown',
    reply_markup: keyboard || undefined,
  });
  try {
    const resp = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body,
    });
    return await resp.json();
  } catch (e) {
    console.error('Telegram photo error:', e.message);
    return null;
  }
}

async function checkPendingApprovals() {
  try {
    const pending = db.prepare(
      `SELECT aq.id, aq.article_id, aq.draft_tweet, n.title, n.source 
       FROM approval_queue aq 
       JOIN news_items n ON aq.article_id = n.id 
       WHERE aq.status = 'pending' AND (aq.telegram_message_id IS NULL OR aq.telegram_message_id = 0)
       LIMIT 3`
    ).all();

    if (pending.length === 0) return;

    console.log(`Found ${pending.length} pending approvals`);

    for (const entry of pending) {
      // 🔒 DEDUP: delete any other pending entries for the same article
      db.prepare(
        `DELETE FROM approval_queue WHERE article_id = ? AND id != ? AND status = 'pending'`
      ).run(entry.article_id, entry.id);

      // Build NanoBanana prompt + image URL
      const headline = (entry.title || '').substring(0, 80);
      const source = (entry.source || 'ARGENTINA').toUpperCase();
      const nanoPrompt = `Professional Argentine news thumbnail. ${headline}. Dark blue (#003087) and gold (#FFD700). ${source} logo. Dramatic lighting, photorealistic, cinematic. Clean modern layout. ULTIMO MOMENTO banner.`;
      const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(nanoPrompt)}?width=1024&height=1024&nologo=true&seed=${Math.floor(Math.random() * 1000)}`;

      // Save image_url for later Bluesky publish
      db.prepare('UPDATE approval_queue SET image_url = ?, image_prompt = ? WHERE id = ?')
        .run(imageUrl, nanoPrompt, entry.id);

      const caption = [
        `📰 *${entry.title}*`,
        ``,
        `📌 ${entry.source} | #ArgentinaRadar`,
      ].join('\n');

      const keyboard = {
        inline_keyboard: [[
          { text: '✅ Aprobar', callback_data: `approve:${entry.article_id}` },
          { text: '❌ Descartar', callback_data: `reject:${entry.article_id}` },
        ]]
      };

      const result = await sendPhoto(caption, imageUrl, keyboard);
      
      if (result && result.ok && result.result?.message_id) {
        db.prepare(
          'UPDATE approval_queue SET telegram_message_id = ? WHERE id = ?'
        ).run(result.result.message_id, entry.id);
        
        console.log(`🖼️  Sent approval for ${entry.article_id.slice(0, 8)} (msg ${result.result.message_id})`);
      } else {
        console.error('Failed to send:', JSON.stringify(result?.description || result));
      }

      // Rate limit: 2 seconds between sends (images take longer)
      await new Promise(r => setTimeout(r, 2000));
    }
  } catch (e) {
    console.error('Check error:', e.message);
  }
}

// ─── Menus ────────────────────────────────────────────────────────────

const MAIN_MENU = {
  inline_keyboard: [
    [{ text: '📰 Noticias Pendientes', callback_data: 'menu:pending' }],
    [{ text: '📊 Estadísticas', callback_data: 'menu:stats' }],
    [{ text: '⭐ Bluesky', text: '🔗 Ver perfil', url: 'https://bsky.app/profile/sitearsdevs.bsky.social' }],
    [{ text: '⚙️ Servicios', callback_data: 'menu:services' }],
    [{ text: '❓ Ayuda', callback_data: 'menu:help' }],
  ]
};

function statsKeyboard() {
  const total = db.prepare('SELECT COUNT(*) c FROM news_items').get().c;
  const pending = db.prepare("SELECT COUNT(*) c FROM approval_queue WHERE status = 'pending'").get().c;
  const approved = db.prepare("SELECT COUNT(*) c FROM approval_queue WHERE status = 'approved'").get().c;
  const published = db.prepare("SELECT COUNT(*) c FROM news_items WHERE status = 'published'").get().c;
  return {
    text: `📊 *ArgentinaRadar Stats*\n\n` +
      `📰 Artículos totales: *${total}*\n` +
      `⏳ Pendientes: *${pending}*\n` +
      `✅ Aprobados: *${approved}*\n` +
      `🚀 Publicados: *${published}*`,
    keyboard: { inline_keyboard: [[{ text: '🔙 Volver', callback_data: 'menu:main' }]] }
  };
}

function pendingKeyboard() {
  const pending = db.prepare(
    `SELECT aq.article_id, n.title, n.source FROM approval_queue aq
     JOIN news_items n ON aq.article_id = n.id
     WHERE aq.status = 'pending' AND aq.telegram_message_id IS NOT NULL AND aq.telegram_message_id > 0
     ORDER BY aq.rowid DESC LIMIT 5`
  ).all();
  const buttons = pending.map(p => [{
    text: `📰 ${(p.title || '').substring(0, 40)}`,
    callback_data: `info:${p.article_id}`
  }]);
  buttons.push([{ text: '🔙 Volver', callback_data: 'menu:main' }]);
  return {
    text: pending.length ? `📋 *${pending.length} noticias pendientes*` : '✅ *No hay noticias pendientes*',
    keyboard: { inline_keyboard: buttons }
  };
}

// ─── Command / Message handler ────────────────────────────────────────

async function handleMenuAction(action, chatId, messageId) {
  const editMsg = (text, kb) => fetch(`https://api.telegram.org/bot${BOT_TOKEN}/editMessageText`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, message_id: messageId, text, parse_mode: 'Markdown', reply_markup: kb })
  });

  if (action === 'main') {
    await editMsg('🤖 *ArgentinaRadar Bot*\n\nSeleccioná una opción:', MAIN_MENU);
  } else if (action === 'stats') {
    const s = statsKeyboard();
    await editMsg(s.text, s.keyboard);
  } else if (action === 'pending') {
    const p = pendingKeyboard();
    await editMsg(p.text, p.keyboard);
  } else if (action === 'services') {
    await editMsg(
      '⚙️ *Servicios*\n\n' +
      '🔵 Bluesky Publisher: puerto 3004\n' +
      '🟢 Telegram Notifier: activo\n' +
      '🟡 Hermes Bridge: puerto 3005\n\n' +
      '_Los servicios se gestionan desde el Dashboard_',
      { inline_keyboard: [[{ text: '🔙 Volver', callback_data: 'menu:main' }]] }
    );
  } else if (action === 'help') {
    await editMsg(
      '❓ *Ayuda*\n\n' +
      '• Las noticias llegan automáticamente para revisión\n' +
      '• ✅ Aprobar → publica en Bluesky con imagen\n' +
      '• ❌ Descartar → archiva sin publicar\n' +
      '• Usá /menu para ver este menú',
      { inline_keyboard: [[{ text: '🔙 Volver', callback_data: 'menu:main' }]] }
    );
  }
}

// ─── Update processing (commands + callbacks) ─────────────────────────

// Process incoming callbacks from Telegram
let lastUpdateId = -1;

async function checkCallbacks() {
  try {
    const resp = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getUpdates?offset=${lastUpdateId + 1}&timeout=15`);
    const data = await resp.json();
    
    if (!data.ok || !data.result || data.result.length === 0) return;
    
    for (const update of data.result) {
      lastUpdateId = update.update_id;

      // ── Handle text commands ──
      const msg = update.message;
      if (msg && msg.text) {
        const txt = msg.text.trim();
        if (txt === '/start' || txt === '/menu') {
          await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: msg.chat.id,
              text: '🤖 *ArgentinaRadar Bot*\n\nSeleccioná una opción:',
              parse_mode: 'Markdown',
              reply_markup: MAIN_MENU
            })
          });
        } else if (txt === '/stats') {
          const s = statsKeyboard();
          await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: msg.chat.id, text: s.text, parse_mode: 'Markdown', reply_markup: s.keyboard })
          });
        }
        continue;
      }

      // ── Handle callback queries ──
      const cb = update.callback_query;
      if (!cb) continue;

      const cbData = cb.data || '';

      // Menu navigation callbacks
      if (cbData.startsWith('menu:')) {
        const action = cbData.split(':')[1];
        await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ callback_query_id: cb.id })
        });
        await handleMenuAction(action, cb.message.chat.id, cb.message.message_id);
        continue;
      }

      // Article approve/reject callbacks
      const [action, articleId] = cb.data.split(':');
      
      // ⚡ Answer IMMEDIATELY — before any DB or Bluesky work
      await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          callback_query_id: cb.id,
          text: action === 'approve' ? '✅ Aprobado — publicando en Bluesky' : '❌ Descartado',
        }),
      });
      
      if (action === 'approve') {
        // Get article info + image_url
        const aq = db.prepare('SELECT image_url FROM approval_queue WHERE article_id = ? AND status = ? ORDER BY rowid DESC LIMIT 1').get(articleId, 'pending');
        const article = db.prepare('SELECT title, source FROM news_items WHERE id = ?').get(articleId);
        
        // Mark as approved
        db.prepare('UPDATE approval_queue SET status = ?, reviewed_at = datetime("now") WHERE article_id = ?')
          .run('approved', articleId);
        db.prepare('UPDATE news_items SET status = ? WHERE id = ?').run('published', articleId);
        
        // Publish to Bluesky
        if (article) {
          const tweetText = article.title ? `${article.title.slice(0, 250)}\n\n📌 ${article.source} #ArgentinaRadar` : 'Novedad #ArgentinaRadar';
          try {
            const bskyResp = await fetch('http://127.0.0.1:3004/api/publish-text', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ article_id: articleId, text: tweetText, image_url: aq?.image_url }),
            });
            const bskyResult = await bskyResp.json();
            console.log(`Bluesky: ${bskyResult.success ? 'OK' : 'FAIL'} — ${articleId.slice(0,8)}`);
          } catch(e) {
            console.log(`Bluesky publish failed: ${e.message}`);
          }
        }
        
        console.log(`Approved: ${articleId}`);
      } else if (action === 'reject') {
        db.prepare('UPDATE approval_queue SET status = ?, reviewed_at = datetime("now") WHERE article_id = ?')
          .run('rejected', articleId);
        console.log(`Rejected: ${articleId}`);
      }
    }
  } catch (e) {
    console.error('Callback error:', e.message);
  }
}

// Main loop
async function main() {
  console.log('Telegram Approval Notifier started');
  console.log(`Bot: @ArgRadarBot | Chat: ${CHAT_ID}`);
  console.log(`Polling every ${POLL_INTERVAL / 1000}s`);
  
  while (true) {
    await checkPendingApprovals();
    await checkCallbacks();
    await new Promise(r => setTimeout(r, POLL_INTERVAL));
  }
}

main().catch(console.error);
