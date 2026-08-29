/**
 * LinkedInClient — high-level client over the direct-HTTP LinkedIn API.
 *
 * Owns the end-to-end "profile URL → raw data" flow using plain HTTP requests
 * (no browser):
 *
 *   resolve session → GET Voyager endpoints → rawFromJson → raw profile
 *
 * It translates LinkedIn's HTTP failures (redirects, 999, 401/403/404/429) into
 * typed LinkedInError instances. It does NOT know about Fastify or the public
 * API schema.
 */
import type { AppConfig } from '../config.js';
import type { ExtractionMethod } from '../types/index.js';
import { LinkedInError, ProfileNotAccessibleError } from './errors.js';
import type { RawLinkedInProfile } from './types.js';
import { rawFromJson } from './extractor.js';
import { resolveSession } from './auth.js';
import { LinkedInHttp } from './http.js';
import { ENDPOINTS } from './endpoints.js';

export interface ClientExtraction {
  raw: RawLinkedInProfile;
  method: ExtractionMethod;
  warnings: string[];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

/** Best-effort merge of the profileContactInfo payload into the raw profile. */
function mergeContactInfo(raw: RawLinkedInProfile, blob: unknown): void {
  if (!isRecord(blob)) return;
  const websites = Array.isArray(blob['websites']) ? blob['websites'] : [];
  for (const w of websites) {
    if (!isRecord(w)) continue;
    const url = str(w['url']);
    if (!url) continue;
    const label = isRecord(w['label']) ? str(w['label']['text']) : null;
    raw.contactInfo.websites.push({ url, label });
  }
  const twitter = Array.isArray(blob['twitterHandles']) && isRecord(blob['twitterHandles'][0])
    ? str(blob['twitterHandles'][0]['name'])
    : null;
  if (twitter) raw.contactInfo.twitter = twitter;
  // GitHub has no dedicated field; it arrives as a website URL.
  const gh = raw.contactInfo.websites.find((w) => /github\.com/i.test(w.url));
  if (gh) raw.contactInfo.github = gh.url;
}

export class LinkedInClient {
  constructor(private readonly config: AppConfig) {}

  hasSessionState(): boolean {
    try {
      resolveSession(this.config);
      return true;
    } catch {
      return false;
    }
  }

  async extractProfile(_canonicalUrl: string, vanityName: string): Promise<ClientExtraction> {
    const session = resolveSession(this.config);
    const http = new LinkedInHttp(this.config, session);
    const warnings: string[] = [];

    const profileBlob = await http.getJson<unknown>(ENDPOINTS.profileView.path(vanityName));
    const raw = rawFromJson(profileBlob, vanityName);
    // A profile is "accessible" if we resolved any identity signal — Voyager
    // returns firstName/lastName (not always a combined fullName).
    if (!raw || (!raw.identity.firstName && !raw.identity.lastName && !raw.identity.fullName)) {
      throw new ProfileNotAccessibleError(vanityName);
    }

    // Contact info is a separate endpoint and entirely optional.
    try {
      const contactBlob = await http.getJson<unknown>(ENDPOINTS.profileContactInfo.path(vanityName));
      mergeContactInfo(raw, contactBlob);
    } catch (err) {
      if (err instanceof LinkedInError && err.code === 'PROFILE_NOT_FOUND') {
        // no contact section — leave empty, not an error
      } else {
        warnings.push('Contact info unavailable.');
      }
    }

    return { raw, method: 'network', warnings };
  }

  async close(): Promise<void> {
    // Nothing to close for the HTTP client.
  }
}
