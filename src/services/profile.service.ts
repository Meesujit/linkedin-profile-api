/**
 * ProfileService — orchestrates a single profile request end-to-end.
 *
 *   cache lookup → session check → extract → parse → normalize → schema check
 *
 * The browser and LinkedIn client are injected (created once at startup) so the
 * authenticated session is loaded a single time and reused, never per request.
 * The service depends only on two small interfaces, which keeps it unit-testable
 * without any Playwright or Fastify imports.
 */

import { config as defaultConfig, type AppConfig } from '../config.js';
import { TtlCache } from '../utils/cache.js';
import { profileCacheKey } from '../utils/url.js';
import { parseLinkedInProfile } from '../linkedin/parser.js';
import { AuthRequiredError, LinkedInError } from '../linkedin/errors.js';
import type { ExtractionMethod } from '../types/index.js';
import type { RawLinkedInProfile } from '../linkedin/types.js';
import { profileResponseSchema, type ProfileResponse } from '../schemas/profile.schema.js';

export interface ProfileExtractor {
  extractProfile(canonicalUrl: string, vanityName: string): Promise<{
    raw: RawLinkedInProfile;
    method: ExtractionMethod;
    warnings: string[];
  }>;
}

export interface SessionGate {
  hasSessionState(): boolean;
  close(): Promise<void>;
}

export interface ProfileServiceOptions {
  config?: AppConfig;
  extractor: ProfileExtractor;
  session: SessionGate;
  cache?: TtlCache<ProfileResponse>;
}

export class ProfileService {
  private readonly config: AppConfig;
  private readonly extractor: ProfileExtractor;
  private readonly session: SessionGate;
  private readonly cache: TtlCache<ProfileResponse>;

  constructor(options: ProfileServiceOptions) {
    this.config = options.config ?? defaultConfig;
    this.extractor = options.extractor;
    this.session = options.session;
    this.cache = options.cache ?? new TtlCache<ProfileResponse>(this.config.cacheTtlSeconds);
  }

  /** Retrieve a normalized profile, honoring the cache and session gate. */
  async getProfile(vanityName: string, canonicalUrl: string): Promise<ProfileResponse> {
    const cacheKey = profileCacheKey(vanityName);
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    if (!this.session.hasSessionState()) {
      throw new AuthRequiredError('No LinkedIn session found. Run `pnpm linkedin:login` first.');
    }

    const { raw, method, warnings } = await this.extractor.extractProfile(canonicalUrl, vanityName);
    const parsed = parseLinkedInProfile(raw);
    const allWarnings = [...warnings, ...parsed.warnings];

    const response: ProfileResponse = {
      success: true,
      profile: parsed.profile,
      metadata: {
        scraped_at: new Date().toISOString(),
        source: 'linkedin',
        extraction_method: method,
        authenticated: true,
        partial: method === 'dom',
        sections_available: parsed.sectionsAvailable,
        warnings: allWarnings,
      },
    };

    // Safety net: every response must satisfy the public schema before leaving
    // the service. A failure here is a bug, not a client error.
    const validated = profileResponseSchema.safeParse(response);
    if (!validated.success) {
      throw new LinkedInError('INTERNAL_ERROR', 'Response failed schema validation.', {
        issues: validated.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }

    this.cache.set(cacheKey, validated.data);
    return validated.data;
  }

  async close(): Promise<void> {
    await this.session.close();
  }
}
