/**
 * Minimal direct-HTTP client for LinkedIn's internal API.
 *
 * Uses Node's native `fetch` (undici) with a per-request AbortController
 * timeout. Redirects are NOT followed automatically: LinkedIn answers a stale or
 * bot-flagged session with a 302 (often to itself, or with `li_at=delete me`),
 * which we translate into a controlled `LINKEDIN_AUTH_REQUIRED` error instead of
 * looping. No browser process is involved.
 */
import type { AppConfig } from '../config.js';
import type { LinkedInSession } from './auth.js';
import {
  AuthRequiredError,
  ExtractionFailedError,
  ExtractionTimeoutError,
  ProfileNotFoundError,
  ProfileNotAccessibleError,
  RateLimitedError,
} from './errors.js';

export class LinkedInHttp {
  constructor(
    private readonly config: AppConfig,
    private readonly session: LinkedInSession,
  ) {}

  /** GET an endpoint and parse its JSON body. Throws typed LinkedInErrors. */
  async getJson<T = unknown>(path: string): Promise<T> {
    const url = `https://www.linkedin.com${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.linkedinHttpTimeoutMs);

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'csrf-token': this.session.csrfToken,
          'x-restli-protocol-version': '2.0.0',
          'x-li-lang': 'en_US',
          accept: 'application/json',
          'user-agent': this.config.linkedinUserAgent,
          cookie: `li_at=${this.session.liAt}; JSESSIONID=${this.session.jsession}`,
        },
      });
    } catch (err) {
      clearTimeout(timer);
      if (controller.signal.aborted) {
        throw new ExtractionTimeoutError(`LinkedIn request timed out after ${this.config.linkedinHttpTimeoutMs}ms.`);
      }
      throw new ExtractionFailedError(`LinkedIn request failed: ${(err as Error).message}`);
    }
    clearTimeout(timer);

    this.assertOk(response, path);

    const body = await response.text();
    try {
      return JSON.parse(body) as T;
    } catch {
      throw new ExtractionFailedError('LinkedIn returned a non-JSON response.');
    }
  }

  private assertOk(response: Response, path: string): void {
    const status = response.status;

    // Any redirect from the Voyager API means the session was rejected (auth
    // wall or `li_at=delete me`). Do not follow it.
    if (status === 301 || status === 302 || status === 303 || status === 307 || status === 308) {
      throw new AuthRequiredError();
    }
    // 999 is LinkedIn's "request blocked" status (anti-bot).
    if (status === 999) {
      throw new RateLimitedError('LinkedIn blocked the request (HTTP 999).');
    }
    if (status === 401) throw new AuthRequiredError();
    if (status === 403) throw new ProfileNotAccessibleError();
    if (status === 404) throw new ProfileNotFoundError();
    if (status === 429) throw new RateLimitedError();
    if (status >= 400) throw new ExtractionFailedError(`LinkedIn returned HTTP ${status} for ${path}.`);
  }
}
