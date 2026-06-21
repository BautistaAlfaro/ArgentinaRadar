/**
 * Centralized Spanish Messages — ArgentinaRadar
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

export const MSG = {
  // ─── Actions ───────────────────────────────────────────────────────
  APPROVED: '✅ Aprobado',
  REJECTED: '❌ Descartado',
  PROCESSING: '⏳ Procesando...',
  PUBLISHING: '🚀 Publicando en Bluesky...',
  CONFIRM_TITLE: '⚠️ ¿Estás seguro?',
  SUCCESS: (action: string) => `✅ ${action} completado`,
  FAILED: (action: string) => `❌ Error: ${action}`,

  // ─── Pipeline ──────────────────────────────────────────────────────
  FORCE_REFRESH_START: '⏳ Forzando refresh de fuentes...',
  FORCE_REFRESH_PROGRESS: (n: number, total: number, source: string) =>
    `⏳ Descargando fuentes... [${n}/${total}] ${source}`,
  FORCE_REFRESH_DONE: (n: number) =>
    `✅ Refresh completado: ${n} artículos nuevos`,
  REPROCESS_START: '⏳ Reprocesando lote...',
  REPROCESS_PROGRESS: (n: number, total: number) =>
    `⏳ Reprocesando... [${n}/${total}]`,
  REPROCESS_DONE: (published: number, discarded: number) =>
    `✅ ${published} aprobados, ${discarded} descartados`,

  // ─── Services ──────────────────────────────────────────────────────
  SERVICE_RESTARTING: (name: string) => `🔄 Reiniciando ${name}...`,
  SERVICE_RESTARTED: (name: string) => `✅ ${name} reiniciado`,
  SERVICE_DOWN: (name: string) => `🔴 ${name} no responde`,
  SERVICE_OK: (name: string) => `🟢 ${name} OK`,
  SERVICE_RESTART_OK: (port: number) =>
    `🔄 Servicio reiniciado. Puerto ${port} OK`,

  // ─── Backup ────────────────────────────────────────────────────────
  BACKUP_DONE: (name: string, size: string) =>
    `💾 Backup: ${name} (${size})`,

  // ─── Cleanup ────────────────────────────────────────────────────────
  CLEANUP_DONE: (articles: number, logs: number) =>
    `🧹 ${articles} artículos, ${logs} logs eliminados`,

  // ─── Automations ───────────────────────────────────────────────────
  AUTO_APPROVE_CONFIRM: (n: number) =>
    `⚠️ ¿Estás seguro? Esto publicará ${n} noticias automáticamente`,
  AUTO_APPROVE_DONE: (n: number) =>
    `✅ ${n} noticias auto-aprobadas y publicadas`,
  AUTO_BACKUP_ON: '✅ Auto-backup activado',
  AUTO_BACKUP_OFF: '⏸️ Auto-backup pausado',

  // ─── Stats ─────────────────────────────────────────────────────────
  NO_PENDING: '✅ No hay noticias pendientes de revisión',
  STATS_HEADER: '📊 *Estadísticas de ArgentinaRadar*',
  STATS_FORMAT: (total: number, pending: number, approved: number, published: number) =>
    `📰 Artículos totales: *${total}*\n` +
    `⏳ Pendientes: *${pending}*\n` +
    `✅ Aprobados: *${approved}*\n` +
    `🚀 Publicados: *${published}*`,
  PENDING_LIST_HEADER: (total: number, start: number, end: number) =>
    `📋 *${total} noticias pendientes* (${start}–${end} de ${total})`,

  // ─── Articles ──────────────────────────────────────────────────────
  ARTICLE_INFO: (title: string, source: string, category: string) =>
    `📰 *${title}*\n\n` +
    `📌 *Fuente:* ${source}\n` +
    `🏷️ *Categoría:* ${category}`,
  ARTICLE_LINK: 'Ver artículo',
  ARTICLE_APPROVED: (title: string, source: string) =>
    `✅ *Aprobado*\n\n📰 ${title}\n📌 ${source}`,
  ARTICLE_REJECTED: (title: string, source: string) =>
    `❌ *Descartado*\n\n📰 ${title}\n📌 ${source}`,
  ARTICLE_PUBLISHED: (title: string, source: string) =>
    `✅ *Publicado en Bluesky!*\n\n📰 ${title}\n📌 ${source}`,
  ARTICLE_PUBLISH_FAILED: (error: string) =>
    `❌ *Error al publicar:* ${error}`,

  // ─── Breaking News ─────────────────────────────────────────────────
  BREAKING_PUBLISHED: (title: string, source: string) =>
    `🚨 *Breaking publicado en Bluesky!*\n\n📰 ${title}\n📌 ${source}`,
  BREAKING_REGISTERED: (title: string, source: string) =>
    `⚠️ *Breaking registrado* (error al publicar en Bluesky)\n\n📰 ${title}\n📌 ${source}`,
  BREAKING_ERROR: (error: string) =>
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
  MENU_SEARCH_RESULTS: (term: string) =>
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
  MENU_SCHEDULER:
    '⏰ *Programación de Publicaciones*\n\n' +
    '📊 *Resumen*\n' +
    '⏳ Pendientes: {{pending}}\n' +
    '✅ Publicados: {{published}}\n' +
    '❌ Fallidos: {{failed}}\n' +
    '{{next}}\n' +
    '📌 *Comandos*\n' +
    '• `/schedule HH:MM <id>` — programar\n' +
    '• `/schedule list` — ver todas\n' +
    '• `/schedule cancel <id>` — cancelar\n' +
    '• `/schedule now <id>` — publicar ya',
  MENU_ALERTS_EMPTY:
    '🔔 *Alertas*\n\nNo tenés alertas configuradas.\n\n' +
    '• `/alert add <palabra>` — alerta por palabra clave\n' +
    '• `/alert add provincia <nombre>` — alerta por provincia\n' +
    '• `/alert remove <palabra>` — eliminar alerta\n' +
    '• `/alert list` — ver alertas activas',
  MENU_ALERTS_LIST: (count: number) => `🔔 *Alertas activas (${count})*`,
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
  SCHEDULER_LIST: (count: number) =>
    `⏰ *Publicaciones Programadas (${count})*`,
  SCHEDULER_CANCELLED: (id: number) =>
    `✅ *Publicación #${id} cancelada.*`,
  SCHEDULER_CANCEL_NOT_FOUND: (id: number) =>
    `❌ No se encontró la publicación #${id} o ya fue procesada.`,
  SCHEDULER_SCHEDULED_SIMPLE: (time: string, id: number) =>
    `⏰ *Programado* para las ${time} (ID: #${id})`,
  SCHEDULER_SCHEDULED_WITH_ARTICLE: (
    time: string, title: string, source: string, id: number
  ) =>
    `⏰ *Programado* para las ${time}\n\n📰 ${title}\n📌 ${source}\n🆔 Programación: #${id}`,
  SCHEDULER_PUBLISHING: (title: string) =>
    `⏰ Publicando ${title} en Bluesky...`,

  // ─── Commands ──────────────────────────────────────────────────────
  CMD_SEARCH_USAGE: '🔍 *Buscar Noticia*\n\nUsá: `/search <término>`\nEj: `/search inflación`',
  CMD_SEARCH_NO_TERM: '🔍 *Buscar Noticia*\n\nUsá: `/search <término>`\nEj: `/search inflación`',
  CMD_SIMILAR_USAGE:
    '🔍 *Búsqueda Semántica*\n\nUsá: `/similar <término>`\nEj: `/similar dólar blue`\n\n_Busca artículos semánticamente similares usando embeddings._',
  CMD_SIMILAR_NO_TERM:
    '🔍 *Búsqueda Semántica*\n\nUsá: `/similar <término>`\nEj: `/similar dólar blue`\n\n_Busca artículos semánticamente similares usando embeddings._',
  CMD_SIMILAR_ERROR: (error: string) =>
    `⚠️ Error en búsqueda semántica: ${error}`,
  CMD_SIMILAR_NO_RESULTS: (term: string) =>
    `🔍 *Sin resultados semánticos*\n\nNo se encontraron artículos similares para "${term}".`,
  CMD_SIMILAR_RESULTS: (term: string) =>
    `🔍 *Búsqueda semántica:* "${term}"`,
  CMD_BRIEFING: '☀️ Generando morning briefing...',
  CMD_SCHEDULE_UNRECOGNIZED: '❌ Comando no reconocido. Usá `/schedule` para ver las opciones.',
  CMD_ALERT_UNRECOGNIZED: '❌ Comando no reconocido. Usá `/alert` para ver las opciones.',
  CMD_ALERT_USAGE:
    '🔔 *Alertas*\n\n' +
    '• `/alert add <palabra>` — agregar alerta por palabra clave\n' +
    '• `/alert add provincia <nombre>` — alerta por provincia\n' +
    '• `/alert remove <palabra>` — eliminar alerta\n' +
    '• `/alert list` — ver alertas activas\n\n' +
    'Provincias disponibles: {{provinces}}',
  CMD_ALERT_KEYWORD_SHORT: '❌ La palabra clave debe tener al menos 2 caracteres.',
  CMD_ALERT_ADDED_KEYWORD: (keyword: string) =>
    `✅ *Alerta agregada:* 🔤 "${keyword}"`,
  CMD_ALERT_ADDED_PROVINCE: (province: string) =>
    `✅ *Alerta agregada:* 📍 ${province} (provincia)`,
  CMD_ALERT_REMOVED: (keyword: string) =>
    `✅ *Alerta eliminada:* "${keyword}"`,
  CMD_ALERT_EXISTS: (keyword: string) =>
    `ℹ️ Ya existe una alerta para "${keyword}".`,
  CMD_ALERT_NOT_FOUND: (keyword: string) =>
    `❌ Alerta no encontrada para "${keyword}".`,
  CMD_ALERT_LIST_EMPTY: '🔔 No tenés alertas configuradas.',
  CMD_ALERT_INVALID_PROVINCE: (provinces: string) =>
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
  captionForApproval: (
    catEmoji: string,
    catLabel: string,
    title: string,
    source: string,
  ) =>
    `${catEmoji} *${catLabel}* | *${title}*\n\n📌 ${source} | #ArgentinaRadar`,
} as const;

export type MessageKey = keyof typeof MSG;
