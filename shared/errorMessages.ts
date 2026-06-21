/**
 * Standardized Spanish error messages for user-facing responses.
 *
 * All user-facing error messages MUST use these constants to ensure
 * consistent Spanish-language messaging across all services.
 */

export const ERRORS = {
  ARTICLE_NOT_FOUND: 'Artículo no encontrado',
  INVALID_COMMAND: 'Comando inválido. Usá /help para ver los comandos disponibles.',
  PUBLISH_FAILED: 'Error al publicar en Bluesky',
  DB_ERROR: 'Error interno de base de datos',
  RATE_LIMITED: 'Demasiadas solicitudes. Esperá unos segundos.',
  INVALID_TIME: 'Formato de hora inválido. Usá HH:MM (ej: 14:30)',
  INVALID_PROVINCE: 'Provincia no válida. Provincias disponibles: Buenos Aires, CABA, Córdoba...',
  SEARCH_TOO_SHORT: 'La búsqueda debe tener al menos 2 caracteres',
  BREAKING_TOO_SHORT: 'El titular debe tener al menos 5 caracteres',
  BREAKING_NO_SOURCE: 'Especificá la fuente con | (ej: /breaking Título | Clarín)',
  SCHEDULE_PAST: 'La hora ya pasó. Se programó para mañana.',
  ALERT_EXISTS: 'Esa alerta ya existe',
  ALERT_NOT_FOUND: 'Alerta no encontrada',
  NO_PENDING: 'No hay noticias pendientes',
  NO_RESULTS: 'No se encontraron resultados',
} as const;

export type ErrorCode = keyof typeof ERRORS;
export type ErrorMessage = typeof ERRORS[ErrorCode];
