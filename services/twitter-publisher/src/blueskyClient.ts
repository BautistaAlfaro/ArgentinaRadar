/**
 * Bluesky (AT Protocol) client for ArgentinaRadar.
 *
 * Uses `@atproto/api` to authenticate and post via the AT Protocol.
 * Supports single posts and threads with automatic link facets,
 * image embeds with Spanish alt text, and reply chaining.
 *
 * @see https://docs.bsky.app/docs/get-started
 */

import { BskyAgent, RichText } from '@atproto/api';
import { createRequire } from 'module';
import type { Config } from './config.js';

const cRequire = createRequire(import.meta.url);
const { createLogger } = cRequire('../../../shared/logger.js');
const logger = createLogger('bluesky-client');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BlueskyPostResult {
  uri: string;
  cid: string;
}

export interface PostToBlueskyOptions {
  /** Image URL to attach to the first post of the thread. */
  imageUrl?: string;
  /** Article URL appended to the last post and auto-linked via facets. */
  articleUrl?: string;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Post one or more texts to Bluesky as a thread.
 *
 * - **Single string**: posts a single message.
 * - **Array of strings**: posts a thread (first item is root, rest are replies).
 * - Uses `RichText.detectFacets()` for automatic link detection.
 * - Adds Spanish alt text to images.
 * - Appends `articleUrl` to the **last** post in the thread.
 *
 * @param textOrTexts - Single text or array of texts for a thread.
 * @param config      - App config with Bluesky credentials.
 * @param options     - Optional image and article URL.
 * @returns Single result or array of results (one per thread post).
 */
export async function postToBluesky(
  textOrTexts: string,
  config: Config,
  options?: PostToBlueskyOptions,
): Promise<BlueskyPostResult>;
export async function postToBluesky(
  textOrTexts: string[],
  config: Config,
  options?: PostToBlueskyOptions,
): Promise<BlueskyPostResult[]>;
export async function postToBluesky(
  textOrTexts: string | string[],
  config: Config,
  options?: PostToBlueskyOptions,
): Promise<BlueskyPostResult | BlueskyPostResult[]> {
  const agent = new BskyAgent({ service: 'https://bsky.social' });

  await agent.login({
    identifier: config.bluesky.identifier,
    password: config.bluesky.password,
  });

  const texts = Array.isArray(textOrTexts) ? textOrTexts : [textOrTexts];
  const results: BlueskyPostResult[] = [];

  for (let i = 0; i < texts.length; i++) {
    let text = texts[i];

    // Append article URL to the last post in the thread
    if (options?.articleUrl && i === texts.length - 1) {
      text = text + '\n\n' + options.articleUrl;
    }

    // Enforce Bluesky's 300-character limit
    const truncated = text.length > 300 ? text.slice(0, 297) + '...' : text;

    // Use RichText for automatic facet detection (URLs → clickable links)
    const rt = new RichText({ text: truncated });
    await rt.detectFacets(agent);

    // Build image embed for the first post only
    let embed: { $type: string; images: Array<{ image: any; alt: string }> } | undefined;
    if (options?.imageUrl && i === 0) {
      embed = await createImageEmbed(agent, options.imageUrl, truncated);
    }

    // Build reply ref for thread chaining
    let reply: { root: { uri: string; cid: string }; parent: { uri: string; cid: string } } | undefined;
    if (i > 0 && results.length > 0) {
      reply = {
        root: { uri: results[0].uri, cid: results[0].cid },
        parent: { uri: results[i - 1].uri, cid: results[i - 1].cid },
      };
    }

    const result = await agent.post({
      text: rt.text,
      facets: rt.facets,
      ...(embed ? { embed } : {}),
      ...(reply ? { reply } : {}),
    });

    results.push({ uri: result.uri, cid: result.cid });
    logger.info('Published to Bluesky', { uri: result.uri, postIndex: i });
  }

  return Array.isArray(textOrTexts) ? results : results[0];
}

/**
 * Split a formatted Bluesky post text into a thread when it exceeds 300 chars.
 *
 * Splitting strategy:
 * - Post 1 (root): first logical segment (headline + source).
 * - Post 2 (reply): remainder + article URL.
 *
 * @param text       - The full formatted post text.
 * @param title      - Article title (used to find the split point).
 * @param articleUrl - Optional URL appended to the last post.
 * @returns Array of post texts suitable for `postToBluesky`.
 */
export function prepareBlueskyPosts(
  text: string,
  title: string,
  articleUrl?: string,
): string[] {
  const MAX_LENGTH = 300;

  if (text.length <= MAX_LENGTH) {
    return [text];
  }

  // Split at the first logical sentence or line break after the headline
  const lines = text.split('\n');
  let post1 = '';
  let post2 = '';

  for (let i = 0; i < lines.length; i++) {
    const candidate = lines.slice(0, i + 1).join('\n');
    if (candidate.length <= MAX_LENGTH - 20) {
      post1 = candidate;
    } else {
      post2 = lines.slice(i).join('\n').trim();
      break;
    }
  }

  // Fallback: if we can't split nicely, truncate the whole text
  if (!post2) {
    return [text.slice(0, MAX_LENGTH - 3) + '...'];
  }

  return [post1, post2];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Upload an image and create an image embed with Spanish alt text.
 *
 * Generates alt text like:
 *   "Miniatura de noticia argentina sobre {topic}. Estilo noticiero azul y dorado."
 */
async function createImageEmbed(
  agent: BskyAgent,
  imageUrl: string,
  text: string,
): Promise<{ $type: string; images: Array<{ image: any; alt: string }> }> {
  // Extract a topic from the post text for descriptive alt text
  const topicMatch = text.match(/🇦🇷\s+(.+?)(?:\s*[—|]|$)/);
  const topic = topicMatch
    ? topicMatch[1].trim().slice(0, 80)
    : 'Argentina';

  const altText = `Miniatura de noticia argentina sobre ${topic}. Estilo noticiero azul y dorado.`;

  const resp = await fetch(imageUrl);
  const buffer = await resp.arrayBuffer();
  const blob = await agent.uploadBlob(new Uint8Array(buffer), {
    encoding: 'image/jpeg',
  });

  return {
    $type: 'app.bsky.embed.images',
    images: [{ image: blob.data.blob, alt: altText }],
  };
}
