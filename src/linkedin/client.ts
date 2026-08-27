/// <reference lib="dom" />
/**
 * LinkedInClient — high-level, LinkedIn-aware client on top of BrowserManager.
 *
 * Owns the end-to-end "open a profile and turn it into raw data" flow:
 *
 *   navigate → observe network + embedded JSON → layered extraction → raw profile
 *
 * It knows how to detect authentication failure, missing profiles, and rate
 * limiting, and it translates those into typed LinkedInError instances. It does
 * NOT know about Fastify, HTTP requests, or the public API schema.
 */

import type { Page, Response } from 'playwright';
import type { AppConfig } from '../config.js';
import type { ExtractionMethod } from '../types/index.js';
import {
  AuthRequiredError,
  ProfileNotFoundError,
  ProfileNotAccessibleError,
  RateLimitedError,
  ExtractionTimeoutError,
} from './errors.js';
import type { RawLinkedInProfile } from './types.js';
import { extractEmbeddedJson, rawFromJson, rawFromDom } from './extractor.js';
import { BrowserManager } from './browser.js';

export interface ClientExtraction {
  raw: RawLinkedInProfile;
  method: ExtractionMethod;
  warnings: string[];
}

const MAX_PAYLOAD_BYTES = 5_000_000;

function looksLikeProfilePayload(url: string, contentType: string): boolean {
  return (
    contentType.includes('json') ||
    url.includes('/voyager/api/') ||
    url.includes('identity/profiles') ||
    url.includes('/graphql')
  );
}

async function tryParseJson(text: string): Promise<unknown | null> {
  if (!text || text.length > MAX_PAYLOAD_BYTES) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

export class LinkedInClient {
  constructor(
    private readonly browser: BrowserManager,
    private readonly config: AppConfig,
  ) {}

  /**
   * Open a profile URL and extract raw data. Throws typed errors on auth
   * failure, missing profile, rate limiting, or timeout.
   */
  async extractProfile(canonicalUrl: string, vanityName: string): Promise<ClientExtraction> {
    const page = await this.browser.acquire();
    try {
      return await this.extractWithPage(page, canonicalUrl, vanityName);
    } finally {
      await this.browser.release(page);
    }
  }

  private async extractWithPage(
    page: Page,
    canonicalUrl: string,
    vanityName: string,
  ): Promise<ClientExtraction> {
    const warnings: string[] = [];
    const networkPayloads: unknown[] = [];

    // Observe responses — bodies only, never headers/cookies. Payloads are
    // kept in memory for extraction and are never written to disk or logged.
    const onResponse = (response: Response): void => {
      const url = response.url();
      const contentType = response.headers()['content-type'] ?? '';
      if (!looksLikeProfilePayload(url, contentType)) return;
      void response
        .text()
        .then(async (body) => {
          const parsed = await tryParseJson(body);
          if (parsed != null) networkPayloads.push(parsed);
        })
        .catch(() => undefined);
    };
    page.on('response', onResponse);

    let response: Response | null;
    try {
      // LinkedIn's profile pages never truly finish "load" (continuous network
      // activity), so we settle on domcontentloaded and give the SDUI/RSC
      // renderer a moment to populate before extracting.
      response = await page.goto(canonicalUrl, {
        waitUntil: 'domcontentloaded',
        timeout: this.config.pageNavigationTimeoutMs,
      });
    } catch (err) {
      throw new ExtractionTimeoutError(`Navigation to profile timed out: ${(err as Error).message}`);
    }

    // Wait for the profile's main content to hydrate. The SDUI/RSC tree renders
    // after domcontentloaded; "Activity"/"Featured" signal the profile body is
    // present (unlike the footer's own "About" link, which is in the shell).
    await page
      .waitForFunction(
        () => /^(featured|activity|experience|education|skills|languages)$/im.test(document.body?.innerText ?? ''),
        { timeout: this.config.extractionTimeoutMs },
      )
      .catch(() => undefined);
    await page.waitForTimeout(400).catch(() => undefined);

    // Scroll through the page to trigger LinkedIn's lazy-loaded sections
    // (Experience, Education, Skills, Projects, etc.), which render only once
    // scrolled into view. LinkedIn scrolls inside a nested <main>, not the body,
    // so we scroll that element directly. Bounded so the activity feed's
    // auto-loading can't loop forever.
    await page
      .evaluate(async () => {
        const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
        const scroller = (() => {
          for (const el of Array.from(document.querySelectorAll('main, [role="main"]'))) {
            if (el.scrollHeight > el.clientHeight + 50) return el;
          }
          return (document.scrollingElement || document.body) as Element;
        })();
        const step = Math.floor(scroller.clientHeight * 0.8);
        let lastBottom = -1;
        for (let i = 0; i < 40; i++) {
          scroller.scrollTop += step;
          await sleep(250);
          const bottom = scroller.scrollTop + scroller.clientHeight;
          if (bottom >= scroller.scrollHeight - 2 && bottom === lastBottom) break;
          lastBottom = bottom;
        }
      })
      .catch(() => undefined);
    await page.waitForTimeout(400).catch(() => undefined);

    // ---- Outcome detection -----------------------------------------------
    const finalUrl = page.url();
    const status = response?.status() ?? 0;

    if (/linkedin\.com\/(login|signup|checkpoint|challenge|authwall)/i.test(finalUrl)) {
      throw new AuthRequiredError();
    }
    if (status === 429 || status === 999) {
      throw new RateLimitedError();
    }
    if (status === 404) {
      throw new ProfileNotFoundError(vanityName);
    }

    const bodyHint = await page.evaluate(() => document.body?.innerText?.slice(0, 4000) ?? '');
    if (/page (does not|doesn't) exist|profile (is )?unavailable|couldn't find/i.test(bodyHint)) {
      throw new ProfileNotFoundError(vanityName);
    }

    // ---- Layered extraction ----------------------------------------------
    const embedded = await extractEmbeddedJson(page);
    const domFallback = await rawFromDom(page, vanityName);

    let raw: RawLinkedInProfile | null = null;
    let method: ExtractionMethod = 'dom';

    for (const blob of networkPayloads) {
      const candidate = rawFromJson(blob, vanityName);
      if (candidate) {
        raw = candidate;
        method = 'network';
        break;
      }
    }
    if (!raw) {
      for (const blob of embedded) {
        const candidate = rawFromJson(blob, vanityName);
        if (candidate) {
          raw = candidate;
          method = 'embedded_data';
          break;
        }
      }
    }

    if (raw) {
      // Enrich with visible-page data the structured payloads often omit
      // (ready-to-use image URLs, headline/about when absent).
      if (!raw.profilePicture?.url && domFallback.profilePicture?.url) {
        raw.profilePicture = domFallback.profilePicture;
        method = method === 'dom' ? 'dom' : 'mixed';
      }
      if (!raw.backgroundPicture?.url && domFallback.backgroundPicture?.url) {
        raw.backgroundPicture = domFallback.backgroundPicture;
        method = method === 'dom' ? 'dom' : 'mixed';
      }
      if (!raw.identity.fullName && domFallback.identity.fullName) raw.identity.fullName = domFallback.identity.fullName;
      if (!raw.identity.headline && domFallback.identity.headline) raw.identity.headline = domFallback.identity.headline;
      if (!raw.about && domFallback.about) raw.about = domFallback.about;
      if (!raw.location.raw && domFallback.location.raw) raw.location.raw = domFallback.location.raw;
      if (method === 'network') warnings.push('Some fields were enriched from the rendered DOM.');
    } else {
      raw = domFallback;
      method = 'dom';
      warnings.push('No structured profile payload found; falling back to DOM extraction.');
    }

    if (!raw.identity.fullName) {
      throw new ProfileNotAccessibleError(vanityName);
    }

    return { raw, method, warnings };
  }
}
