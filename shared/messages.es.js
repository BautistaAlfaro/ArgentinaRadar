/**
 * Centralized Spanish Messages — ArgentinaRadar (CommonJS)
 *
 * SINGLE SOURCE OF TRUTH for all user-facing Spanish text.
 * Every service MUST import from here. No hardcoded Spanish strings
 * outside this file.
 *
 * Conventions:
 *   ✅ = success / approved
 *   ❌ = error / rejected
 *   ⏳ = in progress / loading
 *   ⚠️ = warning / confirmation needed
 *   🟢 = online / active
 *   🟡 = degraded / warning
 *   🔴 = offline / error
 *   📡 = ingestion
 *   🧠 = AI
 *   🚀 = publishing
 *   📊 = stats
 *   ⚙️ = settings
 *   🤖 = panel header
 *
 * @module messages
 */

/** @type {{ [key: string]: string | Function }} */
const MSG = {
  // ─── Actions ───────────────────────────────────────────────────────
  APPROVED: '✅ Aprobado',
  REJECTED: '❌ Descartado',
  PROCESSING: '⏳ Procesando...',
  PUBLISHING: '🚀 Publicando en Bluesky...',
  CONFIRM_TITLE: '⚠️ ¿Estás seguro?',
  SUCCESS: (action) => `✅ ${action} completado`,
  FAILED: (action) => `❌ Error: ${action}`,

  // ─── Pipeline ──────────────────────────────────────────────────────
  FORCE_REFRESH_START: '⏳ Forzando refresh de fuentes...',
  FORCE_REFRESH_PROGRESS: (n, total, source) =>
    `⏳ Descargando fuentes... [${n}/${total}] ${source}`,
  FORCE_REFRESH_DONE: (n) =>
    `✅ Refresh completado: ${n} artículos nuevos`,
  REPROCESS_START: '⏳ Reprocesando lote...',
  REPROCESS_PROGRESS: (n, total) =>
    `⏳ Reprocesando... [${n}/${total}]`,
  REPROCESS_DONE: (published, discarded) =>
    `✅ ${published} aprobados, ${discarded} descartados`,

  // ─── Services ──────────────────────────────────────────────────────
  SERVICE_RESTARTING: (name) => `🔄 Reiniciando ${name}...`,
  SERVICE_RESTARTED: (name) => `✅ ${name} reiniciado`,
  SERVICE_DOWN: (name) => `🔴 ${name} no responde`,
  SERVICE_OK: (name) => `🟢 ${name} OK`,
  SERVICE_RESTART_OK: (port) =>
    `🔄 Servicio reiniciado. Puerto ${port} OK`,

  // ─── Backup ────────────────────────────────────────────────────────
  BACKUP_DONE: (name, size) =>
    `💾 Backup: ${name} (${size})`,

  // ─── Cleanup ────────────────────────────────────────────────────────
  CLEANUP_DONE: (articles, logs) =>
    `🧹 ${articles} artículos, ${logs} logs eliminados`,

  // ─── Automations ───────────────────────────────────────────────────
  AUTO_APPROVE_CONFIRM: (n) =>
    `⚠️ ¿Estás seguro? Esto publicará ${n} noticias automáticamente`,
  AUTO_APPROVE_DONE: (n) =>
    `✅ ${n} noticias auto-aprobadas y publicadas`,
  AUTO_BACKUP_ON: '✅ Auto-backup activado',
  AUTO_BACKUP_OFF: '⏸️ Auto-backup pausado',

  // ─── Stats ─────────────────────────────────────────────────────────
  NO_PENDING: '✅ No hay noticias pendientes de revisión',
  STATS_HEADER: '📊 *Estadísticas de ArgentinaRadar*',
  STATS_FORMAT: (total, pending, approved, published) =>
    `📰 Artículos totales: *${total}*\n` +
    `⏳ Pendientes: *${pending}*\n` +
    `✅ Aprobados: *${approved}*\n` +
    `🚀 Publicados: *${published}*`,
  PENDING_LIST_HEADER: (total, start, end) =>
    `📋 *${total} noticias pendientes* (${start}–${end} de ${total})`,

  // ─── Articles ──────────────────────────────────────────────────────
  ARTICLE_INFO: (title, source, category) =>
    `📰 *${title}*\n\n` +
    `📌 *Fuente:* ${source}\n` +
    `🏷️ *Categoría:* ${category}`,
  ARTICLE_LINK: 'Ver artículo',
  ARTICLE_APPROVED: (title, source) =>
    `✅ *Aprobado*\n\n📰 ${title}\n📌 ${source}`,
  ARTICLE_REJECTED: (title, source) =>
    `❌ *Descartado*\n\n📰 ${title}\n📌 ${source}`,
  ARTICLE_PUBLISHED: (title, source) =>
    `✅ *Publicado en Bluesky!*\n\n📰 ${title}\n📌 ${source}`,
  ARTICLE_PUBLISH_FAILED: (error) =>
    `❌ *Error al publicar:* ${error}`,

  // ─── Breaking News ─────────────────────────────────────────────────
  BREAKING_PUBLISHED: (title, source) =>
    `🚨 *Breaking publicado en Bluesky!*\n\n📰 ${title}\n📌 ${source}`,
  BREAKING_REGISTERED: (title, source) =>
    `⚠️ *Breaking registrado* (error al publicar en Bluesky)\n\n📰 ${title}\n📌 ${source}`,
  BREAKING_ERROR: (error) =>
    `❌ Error al publicar breaking: ${error}`,
  BREAKING_TITLE_SHORT: '❌ El título debe tener al menos 5 caracteres.',
  BREAKING_SOURCE_REQUIRED: '❌ Debes especificar una fuente válida después de |',

  // ─── Errors ────────────────────────────────────────────────────────
  ERR_TIMEOUT: '⏱️ La operación tardó demasiado. Reintentá.',
  ERR_NETWORK: '🌐 Error de conexión. Verificá que los servicios estén corriendo.',
  ERR_DB: '💾 Error de base de datos.',
  ERR_UNKNOWN: '❌ Error inesperado. Revisá los logs.',

  // ─── Menu ──────────────────────────────────────────────────────────
  MENU_MAIN: '🤖 *ArgentinaRadar Bot*\n\nSeleccioná una opción:',
  MENU_BREAKING_EMPTY:
    '🚨 *Breaking News*\n\nNo hay noticias urgentes en las últimas 24hs.',
  MENU_BREAKING_HEADER: '🚨 *Breaking News — Últimas 24hs*',
  MENU_SEARCH_HELP:
    '🔍 *Buscar Noticia*\n\nUsá el comando:\n`/search <término>`\n\nEjemplo: `/search inflación`',
  MENU_SEARCH_RESULTS: (term) =>
    `🔍 *Resultados para:* "${term}"\n\nSeleccioná un artículo:`,
  MENU_TODAY_HEADER:
    '📋 *Últimas 24hs — Mejor puntuadas*\n\nSeleccioná un artículo:',
  MENU_TODAY_EMPTY:
    '📋 *Últimas 24hs*\n\nNo hay artículos en las últimas 24 horas.',
  MENU_SERVICES:
    '⚙️ *Servicios*\n\n' +
    '🔵 Bluesky Publisher: puerto 3004\n' +
    '🟢 Telegram Notifier: activo\n' +
    '🟡 Hermes Bridge: puerto 3005\n\n' +
    '_Los servicios se gestionan desde el Dashboard_',
  MENU_HELP:
    '❓ *Ayuda*\n\n' +
    '• Las noticias llegan automáticamente para revisión\n' +
    '• ✅ Aprobar → publica en Bluesky con imagen\n' +
    '• ❌ Descartar → archiva sin publicar\n' +
    '• 🚨 `/breaking Título | fuente` → publica al instante en Bluesky\n' +
    '• ☀️ `/briefing` → morning briefing de hoy\n' +
    '• 🔔 `/alert` → gestionar alertas de palabras clave/provincias\n' +
    '• Usá /menu para ver este menú\n' +
    '• /search <término> → buscar noticias\n' +
    '• /similar <término> → búsqueda semántica con IA\n' +
    '• /today → últimas 24hs\n' +
    '• /fuentes → fuentes RSS activas',
  MENU_TRENDING_HEADER: '📈 *Trending Topics — Últimas 24hs*',
  MENU_TRENDING_EMPTY:
    '📈 *Trending Topics*\n\nNo hay suficientes datos para calcular tendencias en las últimas 24hs.',
  MENU_ALERTS_EMPTY:
    '🔔 *Alertas*\n\nNo tenés alertas configuradas.\n\n' +
    '• `/alert add <palabra>` — alerta por palabra clave\n' +
    '• `/alert add provincia <nombre>` — alerta por provincia\n' +
    '• `/alert remove <palabra>` — eliminar alerta\n' +
    '• `/alert list` — ver alertas activas',
  MENU_ALERTS_LIST: (count) => `🔔 *Alertas activas (${count})*`,
  MENU_ALERTS_HELP:
    '• `/alert add <palabra>` — agregar alerta\n' +
    '• `/alert remove <palabra>` — eliminar alerta',
  MENU_FUENTES_HEADER: '📡 *Fuentes RSS — Artículos indexados*',
  MENU_FUENTES_EMPTY: '📡 *Fuentes RSS*\n\nNo hay fuentes registradas.',

  // ─── Scheduler ─────────────────────────────────────────────────────
  SCHEDULER_HELP:
    '⏰ *Programar Publicaciones*\n\n' +
    '• `/schedule HH:MM <article_id>` — programar un artículo para hoy\n' +
    '  Ej: `/schedule 14:30 abc123def`\n' +
    '• `/schedule list` — ver publicaciones programadas\n' +
    '• `/schedule cancel <id>` — cancelar una publicación\n' +
    '• `/schedule now <article_id>` — publicar inmediatamente\n' +
    '• También podés usar el botón "⏰ Programar" en cualquier aprobación.',
  SCHEDULER_EMPTY: '📭 *No hay publicaciones programadas.*',
  SCHEDULER_LIST: (count) =>
    `⏰ *Publicaciones Programadas (${count})*`,
  SCHEDULER_CANCELLED: (id) =>
    `✅ *Publicación #${id} cancelada.*`,
  SCHEDULER_CANCEL_NOT_FOUND: (id) =>
    `❌ No se encontró la publicación #${id} o ya fue procesada.`,
  SCHEDULER_SCHEDULED_SIMPLE: (time, id) =>
    `⏰ *Programado* para las ${time} (ID: #${id})`,
  SCHEDULER_SCHEDULED_WITH_ARTICLE: (time, title, source, id) =>
    `⏰ *Programado* para las ${time}\n\n📰 ${title}\n📌 ${source}\n🆔 Programación: #${id}`,
  SCHEDULER_PUBLISHING: (title) =>
    `⏰ Publicando ${title} en Bluesky...`,

  // ─── Commands ──────────────────────────────────────────────────────
  CMD_SEARCH_USAGE: '🔍 *Buscar Noticia*\n\nUsá: `/search <término>`\nEj: `/search inflación`',
  CMD_SIMILAR_USAGE:
    '🔍 *Búsqueda Semántica*\n\nUsá: `/similar <término>`\nEj: `/similar dólar blue`\n\n_Busca artículos semánticamente similares usando embeddings._',
  CMD_SIMILAR_ERROR: (error) =>
    `⚠️ Error en búsqueda semántica: ${error}`,
  CMD_SIMILAR_NO_RESULTS: (term) =>
    `🔍 *Sin resultados semánticos*\n\nNo se encontraron artículos similares para "${term}".`,
  CMD_SIMILAR_RESULTS: (term) =>
    `🔍 *Búsqueda semántica:* "${term}"`,
  CMD_BRIEFING: '☀️ Generando morning briefing...',
  CMD_SCHEDULE_UNRECOGNIZED: '❌ Comando no reconocido. Usá `/schedule` para ver las opciones.',
  CMD_ALERT_UNRECOGNIZED: '❌ Comando no reconocido. Usá `/alert` para ver las opciones.',
  CMD_ALERT_KEYWORD_SHORT: '❌ La palabra clave debe tener al menos 2 caracteres.',
  CMD_ALERT_ADDED_KEYWORD: (keyword) =>
    `✅ *Alerta agregada:* 🔤 "${keyword}"`,
  CMD_ALERT_ADDED_PROVINCE: (province) =>
    `✅ *Alerta agregada:* 📍 ${province} (provincia)`,
  CMD_ALERT_REMOVED: (keyword) =>
    `✅ *Alerta eliminada:* "${keyword}"`,
  CMD_ALERT_EXISTS: (keyword) =>
    `ℹ️ Ya existe una alerta para "${keyword}".`,
  CMD_ALERT_NOT_FOUND: (keyword) =>
    `❌ Alerta no encontrada para "${keyword}".`,
  CMD_ALERT_LIST_EMPTY: '🔔 No tenés alertas configuradas.',
  CMD_ALERT_INVALID_PROVINCE: (provinces) =>
    `❌ Provincia no válida.\n\nProvincias disponibles:\n${provinces}`,

  // ─── Buttons (labels for inline keyboards) ─────────────────────────
  BTN_APPROVE: '✅ Aprobar',
  BTN_REJECT: '❌ Descartar',
  BTN_SCHEDULE: '⏰ Programar',
  BTN_SOURCE: '🔍 Ver fuente',
  BTN_BACK: '🔙 Volver',
  BTN_MORE: '▶️ Más',
  BTN_REFRESH: '🔄 Actualizar',

  // ─── Section Separators ────────────────────────────────────────────
  SEPARATOR: '\n─────────────────\n',
  SEPARATOR_SHORT: ' ─────────────────',

  // ─── Article Caption Builder ───────────────────────────────────────
  captionForApproval: (catEmoji, catLabel, title, source) =>
    `${catEmoji} *${catLabel}* | *${title}*\n\n📌 ${source} | #ArgentinaRadar`,
};

module.exports = { MSG };
