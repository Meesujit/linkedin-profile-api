/**
 * LinkedIn profile URL validation and normalization.
 *
 * The public API only accepts HTTPS LinkedIn profile URLs whose path starts
 * with `/in/`. Anything else — arbitrary hosts, non-HTTPS, company/feed/job
 * URLs, `javascript:` URIs, etc. — is rejected before any network work happens.
 */

export interface ParsedProfileUrl {
  /** Public profile identifier (the segment after `/in/`). */
  vanityName: string;
  /** Canonical form: `https://www.linkedin.com/in/<vanity>/` */
  canonicalUrl: string;
}

export type ParseProfileUrlResult =
  | { ok: true; value: ParsedProfileUrl }
  | { ok: false; code: 'INVALID_URL'; message: string };

const PROFILE_PATH_RE = /^\/in\/([^/?#]+)/;

function isLinkedInHostname(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return h === 'linkedin.com' || h.endsWith('.linkedin.com');
}

/**
 * Validate a raw string and produce a canonical LinkedIn profile URL, or a
 * precise rejection reason. Never throws.
 */
export function parseProfileUrl(input: unknown): ParseProfileUrlResult {
  if (typeof input !== 'string' || input.trim() === '') {
    return { ok: false, code: 'INVALID_URL', message: 'URL is required and must be a non-empty string.' };
  }

  const candidate = input.trim();

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return { ok: false, code: 'INVALID_URL', message: 'Value is not a parseable URL.' };
  }

  if (url.protocol !== 'https:') {
    return { ok: false, code: 'INVALID_URL', message: 'Only HTTPS URLs are accepted.' };
  }

  if (!isLinkedInHostname(url.hostname)) {
    return { ok: false, code: 'INVALID_URL', message: 'Hostname must be linkedin.com.' };
  }

  const match = PROFILE_PATH_RE.exec(url.pathname);
  if (!match || !match[1]) {
    return { ok: false, code: 'INVALID_URL', message: 'Path must be a profile URL beginning with /in/.' };
  }

  const vanityName = match[1];
  const canonicalUrl = `https://www.linkedin.com/in/${vanityName}/`;

  return { ok: true, value: { vanityName, canonicalUrl } };
}

/**
 * Deterministic cache key for a profile URL. The canonical URL is used so that
 * equivalent inputs (trailing slash, `www` vs apex, case of hostname) collapse
 * to the same entry.
 */
export function profileCacheKey(vanityName: string): string {
  return `linkedin:profile:${vanityName.toLowerCase()}`;
}
