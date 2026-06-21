"""
Hermes Bridge — Telegram integration for ArgentinaRadar.

Provides REST endpoints for Hermes bot to query service status, recent news,
and statistics. Also runs background notification, alert, and approval loops
that push messages to Telegram via the Bot API.

Background tasks:
  - notification_loop: Polls tweet_history for new publishes → Telegram notification
  - alert_loop:       Polls system health → Telegram alerts on critical conditions
  - approval_loop:    Polls event-detector + Telegram callbacks → human approval workflow

Approval workflow:
  Event detected (impact 50–69) → Draft generated → Telegram inline keyboard
  → Human clicks ✅ (publish) / ❌ (discard) / ✏️ (edit & publish)
"""
