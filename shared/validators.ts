/**
 * Reusable input validators for ArgentinaRadar.
 *
 * These validators are shared across all services (TypeScript ESM and CommonJS).
 * The CJS counterpart lives in validators.js.
 *
 * @module validators
 */

// ─── Argentine Provinces ──────────────────────────────────────────

export const PROVINCES = [
  'Buenos Aires', 'CABA', 'Catamarca', 'Chaco', 'Chubut',
  'Córdoba', 'Corrientes', 'Entre Ríos', 'Formosa', 'Jujuy',
  'La Pampa', 'La Rioja', 'Mendoza', 'Misiones', 'Neuquén',
  'Río Negro', 'Salta', 'San Juan', 'San Luis', 'Santa Cruz',
  'Santa Fe', 'Santiago del Estero', 'Tierra del Fuego', 'Tucumán',
] as const;

export type Province = typeof PROVINCES[number];

// ─── Validators ───────────────────────────────────────────────────

/**
 * Validate an article ID format.
 * Accepts 16-char or 24-char hex strings (MongoDB ObjectId / short ObjectId).
 *
 * @param id - The article ID to validate
 * @returns true if the ID matches a valid hex format
 */
export function validateArticleId(id: string): boolean {
  if (!id || typeof id !== 'string') return false;
  return /^[0-9a-fA-F]{16}$/.test(id) || /^[0-9a-fA-F]{24}$/.test(id);
}

/**
 * Validate a time string in HH:MM 24-hour format (00:00-23:59).
 *
 * @param time - The time string to validate
 * @returns true if the time is valid HH:MM
 */
export function validateTime(time: string): boolean {
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
 * @param name - The province name to validate
 * @returns true if the name matches a known province
 */
export function validateProvince(name: string): boolean {
  if (!name || typeof name !== 'string') return false;
  return PROVINCES.some(p => p.toLowerCase() === name.toLowerCase().trim());
}

/**
 * Validate a search query.
 * Rules:
 * - Minimum 2 characters
 * - No SQL injection patterns (quotes, comments, keywords)
 *
 * @param q - The search query
 * @returns Validation result with error message if invalid
 */
export function validateSearchQuery(q: string): { valid: boolean; error: string } {
  if (!q || typeof q !== 'string') {
    return { valid: false, error: 'La búsqueda debe tener al menos 2 caracteres' };
  }

  const trimmed = q.trim();
  if (trimmed.length < 2) {
    return { valid: false, error: 'La búsqueda debe tener al menos 2 caracteres' };
  }

  // Check for SQL injection patterns and special chars
  const dangerousPattern = /['";\\]|--|\b(?:UNION|SELECT|DROP|DELETE|INSERT|UPDATE|ALTER|CREATE|EXEC|OR\s+\d+\s*=\s*\d)\b/i;
  if (dangerousPattern.test(trimmed)) {
    return { valid: false, error: 'La búsqueda contiene caracteres no permitidos' };
  }

  return { valid: true, error: '' };
}

/**
 * Parse and validate a /breaking command string.
 *
 * Expected format: `Título de la noticia | Fuente`
 * - Title must be at least 5 characters
 * - Source is required (separated by `|`)
 * - If no `|` is present, the entire input is treated as the title with source='Breaking'
 *
 * @param input - The raw input after /breaking
 * @returns Parsed title, source, and error if validation fails
 */
export function validateBreakingCommand(input: string): { title: string; source: string; error?: string } {
  if (!input || input.trim().length === 0) {
    return {
      title: '',
      source: '',
      error: 'Comando inválido. Usá /help para ver los comandos disponibles.',
    };
  }

  const pipeIdx = input.lastIndexOf('|');
  let title: string;
  let source: string;

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
 * Validate and parse a schedule time string into a Date object.
 *
 * - Validates HH:MM format
 * - Returns a Date for **today** at the given time
 * - If the time has already passed today, returns a Date for **tomorrow**
 *   and sets the error field as a warning
 *
 * @param time - Time string in HH:MM format
 * @returns Validation result with parsed Date and optional warning
 */
export function validateScheduleTime(time: string): { valid: boolean; date: Date; error: string } {
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
