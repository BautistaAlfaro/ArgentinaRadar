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
): Promise<BlueskyPostResult> {
  const agent = new BskyAgent({ service: 'https://bsky.social' });

  await agent.login({
    identifier: config.bluesky.identifier,
    password: config.bluesky.password,
  });

  // Bluesky has a 300 character limit
  const truncated = text.length > 300 ? text.slice(0, 297) + '...' : text;

  const result = await agent.post({ text: truncated });

  return { uri: result.uri, cid: result.cid };
}
