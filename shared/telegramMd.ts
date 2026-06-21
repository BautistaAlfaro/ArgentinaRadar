/**
 * Telegram Markdown Escaper — ArgentinaRadar
 *
 * Utilities for safely building Telegram Markdown text.
 * Escapes special characters that would otherwise be interpreted
 * as formatting markers (_ * [ ] ( ) ~ ` > # + - = | { } . !).
 *
 * Usage:
 *   import { escapeMarkdown, safeBold, safeItalic } from '../../shared/telegramMd';
 *
 *   const msg = safeBold(title) + '\n' + safeItalic(subtitle);
 *
 * All user-provided text MUST be run through escapeMarkdown (or the safe* helpers)
 * BEFORE being embedded in Markdown-formatted Telegram messages.
 */

/**
 * Escape all MarkdownV1 special characters in a text string.
 *
 * Escaped characters:
 *   _ * [ ] ( ) ~ ` > # + - = | { } . !
 *
 * @param text - The user-provided text to escape
 * @returns Text safe to embed in Markdown-formatted Telegram messages
 */
export function escapeMarkdown(text: string): string {
  return text.replace(/([_*[\]()~`>#+\-=|{}.!])/g, '\\$1');
}

/**
 * Wrap text in bold Markdown, escaping the inner text first.
 *
 * @param text - The text to render in bold
 * @returns Markdown-safe bold string, e.g. *safe text*
 */
export function safeBold(text: string): string {
  return `*${escapeMarkdown(text)}*`;
}

/**
 * Wrap text in italic Markdown, escaping the inner text first.
 *
 * @param text - The text to render in italic
 * @returns Markdown-safe italic string, e.g. _safe text_
 */
export function safeItalic(text: string): string {
  return `_${escapeMarkdown(text)}_`;
}

/**
 * Build a Markdown link with escaped display text.
 *
 * @param displayText - The visible link text (will be escaped)
 * @param url - The URL target (not escaped — URLs are schema-validated upstream)
 * @returns Markdown-safe link string, e.g. [safe text](https://example.com)
 */
export function safeLink(displayText: string, url: string): string {
  return `[${escapeMarkdown(displayText)}](${url})`;
}

/**
 * Build a Markdown inline code span, escaping backticks inside.
 *
 * @param text - The text to render in code
 * @returns Markdown-safe code span
 */
export function safeCode(text: string): string {
  return `\`${text.replace(/`/g, '\\`')}\``;
}
