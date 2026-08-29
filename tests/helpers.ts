import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AppConfig } from '../src/config.js';

const FIXTURES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'linkedin');

/** Load a sanitized fixture file from `fixtures/linkedin/` and cast it. */
export function loadLinkedInFixture<T = unknown>(name: string): T {
  return JSON.parse(readFileSync(path.join(FIXTURES_DIR, name), 'utf8')) as T;
}

/** Build a test AppConfig with overridable fields. */
export function makeConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    nodeEnv: 'test',
    host: '0.0.0.0',
    port: 8000,
    logLevel: 'info',
    linkedinLiAt: '',
    linkedinJsession: '',
    linkedinHttpTimeoutMs: 20_000,
    linkedinUserAgent: 'test-agent',
    apiRequestTimeoutMs: 90_000,
    maxConcurrentExtractions: 2,
    cacheTtlSeconds: 0,
    rateLimitMax: 30,
    rateLimitTimeWindow: '1 minute',
    ...overrides,
  };
}
