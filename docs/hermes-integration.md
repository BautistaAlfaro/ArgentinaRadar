# Hermes Integration

## Architecture

```
┌─────────────────┐         ┌──────────────────────┐         ┌─────────────────────┐
│  Hermes Bot     │◄───────►│  Hermes Bridge       │◄───────►│  ArgentinaRadar DB  │
│  (Telegram)     │  HTTP   │  (FastAPI :3005)     │  SQLite │  (shared read-only) │
└─────────────────┘         └──────────────────────┘         └─────────────────────┘
```

The **hermes-bridge** service is a Python FastAPI application that:
1. Reads from the shared SQLite database (`data/argentina-radar.db`) in read-only mode
2. Exposes REST endpoints for Hermes bot commands (`/radar status`, `/radar news`, `/radar stats`)
3. Sends Telegram notifications when new tweets are published
4. Monitors for critical errors and sends alerts via Telegram

## Setup

### Prerequisites
- Hermes bot running at `C:\Users\bauti\Desktop\PROYECTOS\Hermes`
- ArgentinaRadar services running (news-ingestion, geolocation, ai-filter, twitter-publisher)

### Installation
```bash
cd services/hermes-bridge
pip install -r requirements.txt
```

### Configuration
Add to `config/.env`:
```
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_chat_id
```

### Startup Order
1. Start Hermes bot first: `pm2 start ~/.hermes/pm2.config.js`
2. Start ArgentinaRadar: `pm2 start config/pm2.config.cjs`

Both must be running for full functionality.

## Commands

### `/radar status`
Returns service health, Twitter quota, AI filter cost, article counts.

Example response:
```
🟢 ArgentinaRadar Status
━━━━━━━━━━━━━━━━━━━━━━
Services: 5/5 online
Twitter: 42/1500 tweets (2.8%)
AI Cost: $0.12 / $0.50 today
Articles: 234 total | 89 published | 12 pending
```

### `/radar news [n]`
Returns latest n articles (default 5).

Example response:
```
📰 Latest News (5)
━━━━━━━━━━━━━━━━━━━━━━
1. [Política] Milei anuncia nuevos medidas...
   📍 Buenos Aires | 📰 Clarín | ✅ Published
2. [Economía] Dólar blue cierra en alza...
   📍 CABA | 📰 Ámbito | ✅ Published
...
```

### `/radar stats`
Returns daily/weekly statistics.

Example response:
```
📊 ArgentinaRadar Stats
━━━━━━━━━━━━━━━━━━━━━━
Today:
  Ingested: 156 articles
  Filtered: 89 publish / 67 discard
  Published: 42 tweets
  AI Cost: $0.12

This Week:
  Ingested: 1,024 articles
  Published: 287 tweets
  Errors: 3
```

## Telegram Notifications

### Tweet Published
When a new tweet is posted, the bridge sends:
```
🐦 Publicado: [Headline]
📍 [Location] | 📰 [Source]
🔗 [Tweet URL]
```

### Critical Alerts
When a critical error occurs:
```
⚠️ CRITICAL: [Error message]
Service: [service_name]
Time: [timestamp]
```

Critical errors monitored:
- All news sources down
- Twitter authentication expired
- AI cost cap exceeded
- Database locked

## Manual Overrides

### Force Publish
```bash
curl -X POST http://localhost:3005/api/override/publish/123
```
Bypasses AI filter and queues article for immediate publishing.

### Skip Article
```bash
curl -X POST http://localhost:3005/api/override/skip/123
```
Marks article as skipped (won't be published).

## Troubleshooting

### Database Locked
If you see "database is locked" errors:
- Ensure only one process is writing to the DB
- Check that `data/argentina-radar.db` is not opened in another tool
- Restart services: `pm2 restart all`

### Service Offline
Check service status:
```bash
pm2 list
pm2 logs hermes-bridge
```

### Telegram Not Sending
- Verify `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` in `.env`
- Test bot manually: send a message to your bot in Telegram
- Check logs: `pm2 logs hermes-bridge --lines 50`

### Hermes Bot Not Responding to `/radar` Commands
The Hermes bot at `C:\Users\bauti\Desktop\PROYECTOS\Hermes` needs to be updated to add `/radar` command handlers that call this bridge service. See Hermes documentation for adding custom commands.

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Service health check |
| `/api/radar/status` | GET | Service status + counts |
| `/api/radar/news?limit=5` | GET | Latest articles |
| `/api/radar/stats` | GET | Daily/weekly statistics |
| `/api/radar/articles` | GET | Tweet history |
| `/api/radar/dashboard` | GET | Full dashboard data |
| `/api/override/publish/:id` | POST | Force-publish article |
| `/api/override/skip/:id` | POST | Skip article |

## Future Enhancements

- [ ] Add `/radar search <query>` command
- [ ] Add `/radar config` interactive configuration
- [ ] Add webhook support for real-time notifications (instead of polling)
- [ ] Add multi-user support (allow multiple Telegram chat IDs)
