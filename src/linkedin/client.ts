/**
 * LinkedInClient — high-level client over LinkedIn's SDUI/RSC endpoints.
 *
 * Owns the end-to-end "profile URL → raw data" flow using plain HTTP requests
 * (no browser):
 *
 *   1. GET /in/{vanity}/  → server-rendered top card (name, headline, location).
 *   2. POST RSC component actions → React-Flight payloads for about,
 *      experience, education, skills, languages.
 *
 * It translates LinkedIn's HTTP failures into typed LinkedInError instances and
 * never knows about Fastify or the public API schema.
 */
import type { AppConfig } from '../config.js';
import type { ExtractionMethod } from '../types/index.js';
import { ProfileNotAccessibleError } from './errors.js';
import type { RawLinkedInProfile } from './types.js';
import { extractFromHtml, mergeRscSections } from './extractor.js';
import { resolveSession } from './auth.js';
import { LinkedInHttp } from './http.js';
import { profilePagePath, componentActionPath, PROFILE_COMPONENTS } from './endpoints.js';
import { Semaphore } from '../utils/concurrency.js';

export interface ClientExtraction {
  raw: RawLinkedInProfile;
  method: ExtractionMethod;
  warnings: string[];
}

function componentBody(vanityName: string): unknown {
  return {
    clientArguments: {
      payload: { isSelfView: false, vanityName },
      states: [],
      requestMetadata: { $type: 'proto.sdui.common.RequestMetadata' },
      screenId: 'com.linkedin.sdui.flagshipnav.home.Home',
      knownTemplateIds: [],
    },
  };
}

export class LinkedInClient {
  private readonly semaphore: Semaphore;

  constructor(private readonly config: AppConfig) {
    this.semaphore = new Semaphore(config.maxConcurrentExtractions);
  }

  hasSessionState(): boolean {
    try {
      resolveSession(this.config);
      return true;
    } catch {
      return false;
    }
  }

  async extractProfile(canonicalUrl: string, vanityName: string): Promise<ClientExtraction> {
    return this.semaphore.run(() => this.doExtract(canonicalUrl, vanityName));
  }

  private async doExtract(_canonicalUrl: string, vanityName: string): Promise<ClientExtraction> {
    const session = resolveSession(this.config);
    const http = new LinkedInHttp(this.config, session);
    const warnings: string[] = [];
    const referer = `https://www.linkedin.com/in/${vanityName}/`;

    // 1. Top card from the server-rendered HTML.
    const html = await http.getText(profilePagePath(vanityName));
    const raw = extractFromHtml(html, vanityName);

    // 2. Lazily-loaded sections from the RSC component actions. Each is
    // best-effort: a missing/rate-limited section is skipped, never fatal.
    const components = [
      PROFILE_COMPONENTS.aboveActivity,
      PROFILE_COMPONENTS.experience,
      ...PROFILE_COMPONENTS.belowActivity,
    ];
    for (const componentId of components) {
      try {
        const rscText = await http.postRsc(componentActionPath(componentId), componentBody(vanityName), referer);
        mergeRscSections(rscText, raw);
      } catch (err) {
        const code = (err as { code?: string }).code;
        if (code === 'RATE_LIMITED') {
          warnings.push('Some profile sections were unavailable (rate limited).');
          break;
        }
        // PROFILE_NOT_FOUND / EXTRACTION_FAILED for a section: skip and continue.
      }
    }

    // 3. Require at least one identity signal; otherwise the profile is not
    // accessible to this session.
    if (!raw.identity.fullName && !raw.identity.firstName && !raw.identity.lastName) {
      throw new ProfileNotAccessibleError(vanityName);
    }

    return { raw, method: 'network', warnings };
  }

  async close(): Promise<void> {
    // Nothing to close for the HTTP client.
  }
}
