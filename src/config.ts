/**
 * Centralized application configuration.
 *
 * Values are read from the environment (with optional `.env` file support via
 * Node's built-in loader). Every knob has a conservative default so the service
 * runs correctly with no configuration, while remaining tunable in production.
 */

// Best-effort `.env` loading. If the file is absent (e.g. in a container where
// config is injected as real env vars) this is a no-op.
try {
  process.loadEnvFile();
} catch {
  // no `.env` present — rely on the process environment.
}

function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function boolFromEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
}

export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production';
  host: string;
  port: number;
  logLevel: string;

  linkedinStatePath: string;
  headless: boolean;

  browserLaunchTimeoutMs: number;
  pageNavigationTimeoutMs: number;
  extractionTimeoutMs: number;
  apiRequestTimeoutMs: number;

  maxConcurrentExtractions: number;

  cacheTtlSeconds: number;

  rateLimitMax: number;
  rateLimitTimeWindow: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    nodeEnv: (env.NODE_ENV as AppConfig['nodeEnv']) ?? 'development',
    host: env.HOST ?? '0.0.0.0',
    port: intFromEnv('PORT', 8000),
    logLevel: env.LOG_LEVEL ?? 'info',

    linkedinStatePath: env.LINKEDIN_STATE_PATH ?? 'storage/linkedin-state.json',
    headless: boolFromEnv('HEADLESS', true),

    browserLaunchTimeoutMs: intFromEnv('BROWSER_LAUNCH_TIMEOUT_MS', 60_000),
    pageNavigationTimeoutMs: intFromEnv('PAGE_NAVIGATION_TIMEOUT_MS', 45_000),
    extractionTimeoutMs: intFromEnv('EXTRACTION_TIMEOUT_MS', 60_000),
    apiRequestTimeoutMs: intFromEnv('API_REQUEST_TIMEOUT_MS', 90_000),

    maxConcurrentExtractions: intFromEnv('MAX_CONCURRENT_EXTRACTIONS', 2),

    cacheTtlSeconds: intFromEnv('CACHE_TTL_SECONDS', 3600),

    rateLimitMax: intFromEnv('RATE_LIMIT_MAX', 30),
    rateLimitTimeWindow: env.RATE_LIMIT_TIME_WINDOW ?? '1 minute',
  };
}

export const config = loadConfig();
