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

async function checkPendingApprovals() {
  try {
    const pending = db.prepare(
      `SELECT aq.id, aq.article_id, aq.draft_tweet, n.title, n.source 
       FROM approval_queue aq 
       JOIN news_items n ON aq.article_id = n.id 
       WHERE aq.status = 'pending' AND aq.telegram_message_id IS NULL 
       LIMIT 3`
    ).all();

    if (pending.length === 0) return;

    console.log(`Found ${pending.length} pending approvals`);

    for (const entry of pending) {
      const text = [
        `📰 *${entry.title}*`,
        ``,
        `📝 _${entry.draft_tweet}_`,
        ``,
        `📌 ${entry.source}`,
      ].join('\n');

      const keyboard = {
        inline_keyboard: [[
          { text: '✅ Aprobar', callback_data: `approve:${entry.article_id}` },
          { text: '❌ Descartar', callback_data: `reject:${entry.article_id}` },
        ]]
      };

      const result = await sendToTelegram(text, keyboard);
      
      if (result && result.ok && result.result?.message_id) {
        db.prepare(
          'UPDATE approval_queue SET telegram_message_id = ? WHERE id = ?'
        ).run(result.result.message_id, entry.id);
        
        // Send confirmation to user
        await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            callback_query_id: '0',
            text: 'Noticia enviada para revisión',
            show_alert: false,
          }),
        });
        
        console.log(`Sent approval for ${entry.article_id.slice(0, 8)}`);
      } else {
        console.error('Failed to send:', JSON.stringify(result));
      }

      // Rate limit: 1 per second
      await new Promise(r => setTimeout(r, 1000));
    }
  } catch (e) {
    console.error('Check error:', e.message);
  }
}

// Process incoming callbacks from Telegram
async function checkCallbacks() {
  try {
    const resp = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getUpdates?offset=-1&timeout=5`);
    const data = await resp.json();
    
    if (!data.ok || !data.result) return;
    
    for (const update of data.result) {
      const cb = update.callback_query;
      if (!cb) continue;
      
      const [action, articleId] = cb.data.split(':');
      
      if (action === 'approve') {
        // Get article info
        const article = db.prepare('SELECT title, source FROM news_items WHERE id = ?').get(articleId);
        
        // Mark as approved
        db.prepare('UPDATE approval_queue SET status = ?, reviewed_at = datetime("now") WHERE article_id = ?')
          .run('approved', articleId);
        db.prepare('UPDATE news_items SET status = ? WHERE id = ?').run('published', articleId);
        
        // Publish to Bluesky
        const tweetText = `${article.title.slice(0, 250)} | ${article.source} #ArgentinaRadar`;
        try {
          const bskyResp = await fetch('http://127.0.0.1:3004/api/publish-text', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ article_id: articleId, text: tweetText }),
          });
          const bskyResult = await bskyResp.json();
          console.log('Bluesky:', bskyResult.success ? 'OK' : 'FAIL');
        } catch(e) {
          console.log('Bluesky publish failed:', e.message);
        }
        
        await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            callback_query_id: cb.id,
            text: '✅ Aprobado — se publicará en Bluesky',
          }),
        });
        
        console.log(`Approved: ${articleId}`);
      } else if (action === 'reject') {
        db.prepare('UPDATE approval_queue SET status = ?, reviewed_at = datetime("now") WHERE article_id = ?')
          .run('rejected', articleId);
        
        await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            callback_query_id: cb.id,
            text: '❌ Descartado',
          }),
        });
        
        console.log(`Rejected: ${articleId}`);
      }
    }
  } catch (e) {
    // Timeout is expected
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
