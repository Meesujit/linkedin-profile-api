/**
 * Playwright BrowserManager — owns the Chromium instance and the authenticated
 * browser context.
 *
 * Responsibilities:
 *   - launch Chromium exactly once and reuse it across requests
 *   - load the persisted LinkedIn session (storage state) once
 *   - create per-request pages under a hard concurrency limit
 *   - clean pages up deterministically
 *
 * The manager never performs LinkedIn authentication itself; that is the job of
 * `scripts/linkedin-login.ts`. If the session is missing or expired, extraction
 * surfaces LINKEDIN_AUTH_REQUIRED and the user re-runs the login script.
 */

import { existsSync } from 'node:fs';
import path from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import type { AppConfig } from '../config.js';

/** Simple counting semaphore to bound concurrent extraction tasks. */
class Semaphore {
  private permits: number;
  private readonly queue: Array<() => void> = [];

  constructor(max: number) {
    this.permits = Math.max(1, max);
  }

  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits -= 1;
      return;
    }
    await new Promise<void>((resolve) => this.queue.push(resolve));
  }

  release(): void {
    const next = this.queue.shift();
    if (next) {
      next();
    } else {
      this.permits += 1;
    }
  }
}

export class BrowserManager {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private readonly semaphore: Semaphore;

  constructor(private readonly config: AppConfig) {
    this.semaphore = new Semaphore(config.maxConcurrentExtractions);
  }

  get statePath(): string {
    return path.resolve(process.cwd(), this.config.linkedinStatePath);
  }

  /** Whether a persisted LinkedIn session file exists on disk. */
  hasSessionState(): boolean {
    return existsSync(this.statePath);
  }

  get started(): boolean {
    return this.browser !== null && this.context !== null;
  }

  /** Launch Chromium and create the (optionally authenticated) context. */
  async start(): Promise<void> {
    if (this.started) return;

    this.browser = await chromium.launch({
      headless: this.config.headless,
      timeout: this.config.browserLaunchTimeoutMs,
      args: ['--disable-dev-shm-usage', '--no-sandbox'],
    });

    const storageState = this.hasSessionState() ? this.statePath : undefined;
    this.context = await this.browser.newContext({
      storageState,
      locale: 'en-US',
      viewport: { width: 1440, height: 900 },
      // Run as a normal desktop browser. We do NOT spoof fingerprints or use
      // stealth tooling — LinkedIn's own security (login, MFA, checkpoints) is
      // respected, not evaded.
      userAgent:
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    });
    this.context.setDefaultTimeout(this.config.pageNavigationTimeoutMs);
    this.context.setDefaultNavigationTimeout(this.config.pageNavigationTimeoutMs);

    // tsx/esbuild emits a `__name` helper (keepNames) that isn't defined in the
    // browser; shim it so `page.evaluate` callbacks work under both tsx and the
    // compiled (tsc) build. A raw string avoids esbuild re-wrapping it.
    await this.context.addInitScript('globalThis.__name = function (fn) { return fn; };');
  }

  /**
   * Acquire a fresh page for a single extraction. Blocks when the concurrency
   * limit is reached. Callers MUST pair this with `release()`.
   */
  async acquire(): Promise<Page> {
    await this.start();
    await this.semaphore.acquire();
    try {
      return await this.context!.newPage();
    } catch (err) {
      this.semaphore.release();
      throw err;
    }
  }

  /** Close a page and return its concurrency slot. */
  async release(page: Page): Promise<void> {
    try {
      await page.close();
    } finally {
      this.semaphore.release();
    }
  }

  /** Tear the browser down completely (used on process shutdown). */
  async close(): Promise<void> {
    if (this.context) {
      await this.context.close().catch(() => undefined);
      this.context = null;
    }
    if (this.browser) {
      await this.browser.close().catch(() => undefined);
      this.browser = null;
    }
  }
}
