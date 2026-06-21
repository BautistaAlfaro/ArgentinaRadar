const BOT = '8653838115:AAFBRBhHEq3VXbfgiZwV1dtNjesBYwvhUqg';
const Database = require('better-sqlite3');
const DB = new Database('data/argentina-radar.db');

let lastId = 0;
console.log('🔄 Polling for callbacks (45s)... Press Ctrl+C to stop');

(async () => {
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    try {
      const r = await fetch('https://api.telegram.org/bot' + BOT + '/getUpdates?offset=' + (lastId + 1) + '&timeout=10');
      const d = await r.json();
      if (!d.ok || !d.result || d.result.length === 0) continue;

      for (const u of d.result) {
        lastId = u.update_id;
        const cb = u.callback_query;
        if (!cb) continue;

        const [action, articleId] = cb.data.split(':');
        console.log(`📩 Callback: ${action} on ${articleId.substring(0, 12)}`);

        // ⚡ Answer IMMEDIATELY
        const ansBody = JSON.stringify({
          callback_query_id: cb.id,
          text: action === 'approve' ? '✅ Aprobado! Publicando...' : '❌ Descartado',
          show_alert: false
        });
        const ans = await fetch('https://api.telegram.org/bot' + BOT + '/answerCallbackQuery', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: ansBody
        });
        const ansData = await ans.json();
        console.log('   Answer:', ansData.ok ? 'OK' : 'FAIL: ' + JSON.stringify(ansData));

        // Update DB
        if (action === 'approve') {
          DB.prepare("UPDATE approval_queue SET status = 'approved', reviewed_at = datetime('now') WHERE article_id = ? AND status = 'pending'").run(articleId);
          DB.prepare("UPDATE news_items SET status = 'published' WHERE id = ?").run(articleId);
          console.log('   DB: approved');

          // Bluesky publish
          try {
            const aq = DB.prepare('SELECT image_url FROM approval_queue WHERE article_id = ? AND status = ? ORDER BY rowid DESC LIMIT 1').get(articleId);
            const art = DB.prepare('SELECT title, source FROM news_items WHERE id = ?').get(articleId);
            const text = (art ? art.title.substring(0, 250) + '\n\n' + art.source : 'Actualidad') + ' #ArgentinaRadar';
            const b = await fetch('http://127.0.0.1:3004/api/publish-text', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ article_id: articleId, text: text, image_url: aq?.image_url })
            });
            const bd = await b.json();
            console.log('   Bluesky:', bd.success ? '✅ Published' : '❌ ' + bd.error);
          } catch (e) {
            console.log('   Bluesky: ⚠️ not available (' + e.message + ')');
          }
        } else {
          DB.prepare("UPDATE approval_queue SET status = 'rejected', reviewed_at = datetime('now') WHERE article_id = ? AND status = 'pending'").run(articleId);
          console.log('   DB: rejected');
        }
      }
    } catch (e) {
      console.log('Poll error:', e.message);
    }
  }
  console.log('Done polling.');
})();
