/**
 * Minimal direct-HTTP client for LinkedIn's internal endpoints.
 *
 * Uses Node's native `fetch` (undici) with a per-request AbortController
 * timeout. Redirects are NOT followed automatically: LinkedIn signals an
 * invalid/bot-flagged session with a 302 (often to itself, or with
 * `li_at=delete me`), and following it would loop. Instead the status is mapped
 * to a typed LinkedInError. No browser process is involved.
 */
import type { AppConfig } from '../config.js';
import type { LinkedInSession } from './auth.js';
import {
  AuthRequiredError,
  ProfileNotFoundError,
  ProfileNotAccessibleError,
  RateLimitedError,
  ExtractionTimeoutError,
  ExtractionFailedError,
} from './errors.js';

const LINKEDIN_ORIGIN = 'https://www.linkedin.com';
// LinkedIn's client application version — sent as x-li-application-version.
// Observed from the live web app (August 2026). May need updating when LinkedIn
// bumps it.
export const LINKEDIN_APP_VERSION = '0.2.7003';

export class LinkedInHttp {
  constructor(
    private readonly config: AppConfig,
    private readonly session: LinkedInSession,
  ) {}

  private authHeaders(): Record<string, string> {
    return {
      cookie: `li_at=${this.session.liAt}; JSESSIONID=${this.session.jsession}`,
      'csrf-token': this.session.csrfToken,
      'user-agent': this.config.linkedinUserAgent,
    };
  }

  /** GET a page and return its raw text (e.g. the profile HTML). */
  async getText(path: string): Promise<string> {
    return this.request('GET', path, undefined, {
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'accept-language': 'en-US,en;q=0.9',
    });
  }

  /** POST a JSON body to an RSC endpoint and return the raw (octet-stream) text. */
  async postRsc(path: string, body: unknown, referer: string): Promise<string> {
    return this.request('POST', path, JSON.stringify(body), {
      'content-type': 'application/json',
      'x-li-rsc-stream': 'true',
      'x-li-application-version': LINKEDIN_APP_VERSION,
      origin: LINKEDIN_ORIGIN,
      referer,
    });
  }

  private async request(
    method: 'GET' | 'POST',
    path: string,
    body: string | undefined,
    extra: Record<string, string>,
  ): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.linkedinHttpTimeoutMs);

    let response: Response;
    try {
      response = await fetch(`${LINKEDIN_ORIGIN}${path}`, {
        method,
        redirect: 'manual',
        signal: controller.signal,
        headers: { ...this.authHeaders(), ...extra },
        body,
      });
    } catch (err) {
      clearTimeout(timer);
      if (controller.signal.aborted) throw new ExtractionTimeoutError();
      throw new ExtractionFailedError(`LinkedIn request failed: ${(err as Error).message}`);
    }
    clearTimeout(timer);

    this.assertOk(response, path);
    return response.text();
  }

  private assertOk(response: Response, path: string): void {
    const status = response.status;

    // Any redirect from LinkedIn means the session was rejected (auth wall or
    // `li_at=delete me`). Do not follow it.
    if (status === 301 || status === 302 || status === 303 || status === 307) {
      throw new AuthRequiredError();
    }
    // 999 is LinkedIn's "blocked / bot" status.
    if (status === 999) {
      throw new RateLimitedError('LinkedIn blocked the request (HTTP 999).');
    }
    if (status === 401) throw new AuthRequiredError();
    if (status === 403) throw new ProfileNotAccessibleError();
    if (status === 404) throw new ProfileNotFoundError();
    if (status === 429) throw new RateLimitedError();
    if (status >= 400) {
      throw new ExtractionFailedError(`LinkedIn returned HTTP ${status} for ${path}.`);
    }
  }
}
