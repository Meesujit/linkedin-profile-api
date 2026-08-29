/**
 * LinkedIn session credential resolution.
 *
 * The direct-HTTP client authenticates against LinkedIn's internal API using the
 * two cookies a logged-in browser holds:
 *
 *   - `li_at`       — the long-lived auth token (the "member session" cookie).
 *   - `JSESSIONID`  — a session-scoped CSRF token, stored as `"ajax:..."`.
 *
 * The `csrf-token` request header is the `JSESSIONID` value with its quotes
 * stripped (i.e. `ajax:...`).
 *
 * Credentials are supplied exclusively via environment variables
 * (`LINKEDIN_LI_AT` + `LINKEDIN_JSESSIONID`) and are never logged, returned by
 * the API, or committed. There is no browser anywhere in this project: the
 * cookies are copied from your own logged-in browser session (DevTools →
 * Application → Cookies) and pasted into your deployment's secret store or a
 * git-ignored `.env`.
 */
import type { AppConfig } from '../config.js';
import { AuthRequiredError } from './errors.js';

export interface LinkedInSession {
  liAt: string;
  jsession: string;
  csrfToken: string;
}

export function resolveSession(config: AppConfig): LinkedInSession {
  const liAt = config.linkedinLiAt.trim();
  const jsession = config.linkedinJsession.trim();

  if (!liAt || !jsession) {
    throw new AuthRequiredError();
  }

  return {
    liAt,
    jsession,
    csrfToken: jsession.replace(/"/g, ''),
  };
}
