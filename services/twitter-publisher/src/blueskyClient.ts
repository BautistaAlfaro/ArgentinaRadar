/**
 * Bluesky (AT Protocol) client for ArgentinaRadar.
 *
 * Uses `@atproto/api` to authenticate and post via the AT Protocol.
 * Bluesky is free — no payment needed.
 *
 * @see https://docs.bsky.app/docs/get-started
 */

import { BskyAgent } from '@atproto/api';
import type { Config } from './config.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BlueskyPostResult {
  uri: string;
  cid: string;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Post text to Bluesky via the AT Protocol.
 *
 * Automatically truncates to Bluesky's 300-character limit with "…".
 *
 * @param text   The post text (max 300 chars).
 * @param config Application config with Bluesky credentials.
 * @returns The AT Protocol URI and CID of the created post.
 */
export async function postToBluesky(
  text: string,
  config: Config,
  imageUrl?: string,
): Promise<BlueskyPostResult> {
  const agent = new BskyAgent({ service: 'https://bsky.social' });

  await agent.login({
    identifier: config.bluesky.identifier,
    password: config.bluesky.password,
  });

  // Bluesky has a 300 character limit
  const truncated = text.length > 300 ? text.slice(0, 297) + '...' : text;

  // Upload image if provided
  let embed: { $type: string; images: Array<{ image: any; alt: string }> } | undefined;
  if (imageUrl) {
    try {
      const resp = await fetch(imageUrl);
      const buffer = await resp.arrayBuffer();
      const blob = await agent.uploadBlob(new Uint8Array(buffer), {
        encoding: 'image/jpeg',
      });
      embed = {
        $type: 'app.bsky.embed.images',
        images: [{ image: blob.data.blob, alt: truncated.slice(0, 100) }],
      };
    } catch (e) {
      console.warn(`[bluesky] ⚠️ Image upload failed, posting text-only: ${e.message}`);
    }
  }

  if (embed) {
    const result = await agent.post({ text: truncated, embed });
    return { uri: result.uri, cid: result.cid };
  }

  const result = await agent.post({ text: truncated });
  return { uri: result.uri, cid: result.cid };
}
