/**
 * Reusable input validators for ArgentinaRadar — CommonJS version.
 *
 * Mirrors the API in validators.ts for use by CommonJS modules
 * (e.g. telegram-notifier.js).
 *
 * @module validators
 */

// ─── Argentine Provinces ──────────────────────────────────────────

/** @type {string[]} */
const PROVINCES = [
  'Buenos Aires', 'CABA', 'Catamarca', 'Chaco', 'Chubut',
  'Córdoba', 'Corrientes', 'Entre Ríos', 'Formosa', 'Jujuy',
  'La Pampa', 'La Rioja', 'Mendoza', 'Misiones', 'Neuquén',
  'Río Negro', 'Salta', 'San Juan', 'San Luis', 'Santa Cruz',
  'Santa Fe', 'Santiago del Estero', 'Tierra del Fuego', 'Tucumán',
];

// ─── Validators ───────────────────────────────────────────────────

/**
 * Validate an article ID format.
 * Accepts 16-char or 24-char hex strings.
 *
 * @param {string} id - The article ID to validate
 * @returns {boolean} true if the ID matches a valid hex format
 */
function validateArticleId(id) {
  if (!id || typeof id !== 'string') return false;
  return /^[0-9a-fA-F]{16}$/.test(id) || /^[0-9a-fA-F]{24}$/.test(id);
}

/**
 * Validate a time string in HH:MM 24-hour format (00:00-23:59).
 *
 * @param {string} time - The time string to validate
 * @returns {boolean} true if the time is valid HH:MM
 */
function validateTime(time) {
  if (!time || typeof time !== 'string') return false;
  const match = time.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return false;
  const hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59;
}

/**
 * Validate a province name against the 24 Argentine provinces.
 * Case-insensitive comparison.
 *
 * @param {string} name - The province name to validate
 * @returns {boolean} true if the name matches a known province
 */
function validateProvince(name) {
  if (!name || typeof name !== 'string') return false;
  return PROVINCES.some(p => p.toLowerCase() === name.toLowerCase().trim());
}

/**
 * Validate a search query.
 * - Minimum 2 characters
 * - No SQL injection patterns
 *
 * @param {string} q - The search query
 * @returns {{ valid: boolean, error: string }} Validation result
 */
function validateSearchQuery(q) {
  if (!q || typeof q !== 'string') {
    return { valid: false, error: 'La búsqueda debe tener al menos 2 caracteres' };
  }

  const trimmed = q.trim();
  if (trimmed.length < 2) {
    return { valid: false, error: 'La búsqueda debe tener al menos 2 caracteres' };
  }

  // Check for SQL injection patterns
  const dangerousPattern = /['";\\]|--|\b(?:UNION|SELECT|DROP|DELETE|INSERT|UPDATE|ALTER|CREATE|EXEC|OR\s+\d+\s*=\s*\d)\b/i;
  if (dangerousPattern.test(trimmed)) {
    return { valid: false, error: 'La búsqueda contiene caracteres no permitidos' };
  }

  return { valid: true, error: '' };
}

/**
 * Parse and validate a /breaking command string.
 * Format: Título | Fuente
 *
 * @param {string} input - The raw input after /breaking
 * @returns {{ title: string, source: string, error?: string }} Parsed result
 */
function validateBreakingCommand(input) {
  if (!input || input.trim().length === 0) {
    return {
      title: '',
      source: '',
      error: 'Comando inválido. Usá /help para ver los comandos disponibles.',
    };
  }

  const pipeIdx = input.lastIndexOf('|');
  let title, source;

  if (pipeIdx > 0) {
    title = input.substring(0, pipeIdx).trim();
    source = input.substring(pipeIdx + 1).trim();
  } else {
    title = input.trim();
    source = 'Breaking';
  }

  if (!title || title.length < 5) {
    return { title, source, error: 'El titular debe tener al menos 5 caracteres' };
  }

  if (!source || source.length === 0) {
    return { title, source, error: 'Especificá la fuente con | (ej: /breaking Título | Clarín)' };
  }

  return { title, source };
}

/**
 * Validate and parse a schedule time into a Date object.
 * Returns today's date at the given time, or tomorrow if time has passed.
 *
 * @param {string} time - Time string in HH:MM format
 * @returns {{ valid: boolean, date: Date, error: string }} Validation result
 */
function validateScheduleTime(time) {
  if (!validateTime(time)) {
    return {
      valid: false,
      date: new Date(0),
      error: 'Formato de hora inválido. Usá HH:MM (ej: 14:30)',
    };
  }

  const [hours, minutes] = time.split(':').map(Number);
  const scheduledFor = new Date();
  scheduledFor.setHours(hours, minutes, 0, 0);
  scheduledFor.setMilliseconds(0);

  if (scheduledFor <= new Date()) {
    scheduledFor.setDate(scheduledFor.getDate() + 1);
    return {
      valid: true,
      date: scheduledFor,
      error: 'La hora ya pasó. Se programó para mañana.',
    };
  }

  return { valid: true, date: scheduledFor, error: '' };
}

// ─── Exports ───────────────────────────────────────────────────────

module.exports = {
  PROVINCES,
  validateArticleId,
  validateTime,
  validateProvince,
  validateSearchQuery,
  validateBreakingCommand,
  validateScheduleTime,
};
