/**
 * Twitter API v2 client using OAuth 1.0a User Context authentication.
 *
 * Uses the `oauth-1.0a` package to sign requests and `axios` for transport.
 * Only the POST /2/tweets endpoint is exposed — additional endpoints
 * can be added as needed.
 */

import crypto from 'crypto';
import OAuth from 'oauth-1.0a';
import axios, { AxiosError } from 'axios';
import { config } from './config.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TWITTER_API_BASE = 'https://api.twitter.com/2';

// ---------------------------------------------------------------------------
// OAuth 1.0a helper
// ---------------------------------------------------------------------------

const oauth = new OAuth({
  consumer: { key: config.twitter.apiKey, secret: config.twitter.apiSecret },
  signature_method: 'HMAC-SHA1',
  hash_function(base_string: string, key: string): string {
    return crypto.createHmac('sha1', key).update(base_string).digest('base64');
  },
});

const token: OAuth.Token = {
  key: config.twitter.accessToken,
  secret: config.twitter.accessSecret,
};

// ---------------------------------------------------------------------------
// Custom error
// ---------------------------------------------------------------------------

export class TwitterApiError extends Error {
  public readonly isRateLimited: boolean;
  public readonly isServerError: boolean;

  constructor(
    message: string,
    public readonly code: number,
  ) {
    super(message);
    this.name = 'TwitterApiError';
    this.isRateLimited = code === 429;
    this.isServerError = code >= 500 && code < 600;
  }

  /** Whether the error is recoverable by retrying after a delay. */
  get isRetryable(): boolean {
    return this.isRateLimited || this.isServerError;
  }
}

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

interface TweetResponse {
  data?: { id: string; text: string };
  errors?: Array<{ message: string; code: number }>;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Post a tweet to Twitter API v2 using OAuth 1.0a User Context.
 *
 * Supports optional media attachment via media_ids.
 *
 * @param text The tweet text (max 280 chars enforced by Twitter).
 * @param mediaIds Optional array of media IDs to attach.
 * @returns The created tweet ID.
 * @throws {TwitterApiError} On API errors (rate limits, auth failures, etc.).
 */
export async function postTweet(
  text: string,
  mediaIds?: string[],
): Promise<{ tweetId: string }> {
  const url = `${TWITTER_API_BASE}/tweets`;
  const body: Record<string, unknown> = { text };

  if (mediaIds && mediaIds.length > 0) {
    body.media = { media_ids: mediaIds };
  }

  // Build the OAuth Authorization header
  const requestData: OAuth.RequestOptions = { url, method: 'POST', data: body };
  const authHeader = oauth.toHeader(oauth.authorize(requestData, token));

  const headers: Record<string, string> = {
    ...authHeader,
    'Content-Type': 'application/json',
  };

  try {
    const resp = await axios.post<TweetResponse>(url, body, { headers });
    const data = resp.data;

    // Check for API-level errors
    if (data.errors && data.errors.length > 0) {
      const err = data.errors[0];
      throw new TwitterApiError(err.message, err.code);
    }

    if (!data.data?.id) {
      throw new TwitterApiError('No tweet ID in response', 0);
    }

    return { tweetId: data.data.id };
  } catch (err) {
    // Re-throw our own errors
    if (err instanceof TwitterApiError) throw err;

    // Wrap Axios errors
    if (err instanceof AxiosError) {
      const status = err.response?.status ?? 0;
      const msg: string =
        (err.response?.data as { detail?: string })?.detail ??
        err.response?.data as string ??
        err.message;
      throw new TwitterApiError(typeof msg === 'string' ? msg : JSON.stringify(msg), status);
    }

    // Wrap anything else
    throw new TwitterApiError(String(err), 0);
  }
}


/**
 * Upload media to Twitter via the v1.1 media/upload endpoint.
 *
 * Downloads the image from `imageUrl`, uploads it to Twitter, and
 * returns the media ID string for use in tweet posts.
 *
 * @param imageUrl Public URL of the image to upload.
 * @returns The media_id_string from Twitter.
 * @throws {TwitterApiError} On upload errors.
 */
export async function uploadMedia(imageUrl: string): Promise<string> {
  // ── 1. Download the image ──────────────────────────────────────
  let imageBuffer: Buffer;
  let mediaType: string;
  try {
    const resp = await axios.get(imageUrl, {
      responseType: 'arraybuffer',
      timeout: 30_000,
    });
    imageBuffer = Buffer.from(resp.data);
    mediaType = resp.headers['content-type'] ?? 'image/png';
  } catch (err) {
    throw new TwitterApiError(
      `Failed to download image from ${imageUrl.slice(0, 80)}…: ${String(err)}`,
      0,
    );
  }

  // ── 2. Upload to Twitter media endpoint (v1.1) ────────────────
  const uploadUrl = 'https://upload.twitter.com/1.1/media/upload.json';

  // Build multipart form data
  const formData = new FormData();
  formData.append('media', new Blob([imageBuffer], { type: mediaType }));

  // OAuth 1.0a signature — no body data for multipart uploads
  const requestData: OAuth.RequestOptions = {
    url: uploadUrl,
    method: 'POST',
  };
  const authHeader = oauth.toHeader(oauth.authorize(requestData, token));

  const headers: Record<string, string> = {
    ...authHeader,
    // Do NOT set Content-Type — axios will infer multipart boundary
  };

  try {
    const resp = await axios.post(uploadUrl, formData, { headers });
    const mediaId: string = resp.data?.media_id_string;
    if (!mediaId) {
      throw new TwitterApiError(
        'No media_id_string in upload response',
        0,
      );
    }
    return mediaId;
  } catch (err) {
    if (err instanceof TwitterApiError) throw err;

    if (err instanceof AxiosError) {
      const status = err.response?.status ?? 0;
      const msg: string =
        (err.response?.data as { error?: string })?.error ??
        err.message;
      throw new TwitterApiError(
        typeof msg === 'string' ? msg : JSON.stringify(msg),
        status,
      );
    }

    throw new TwitterApiError(String(err), 0);
  }
}
