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

export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production';
  host: string;
  port: number;
  logLevel: string;

  // LinkedIn session credentials (direct HTTP auth — see linkedin/auth.ts).
  // Supplied exclusively via environment variables; never committed.
  linkedinLiAt: string;
  linkedinJsession: string;

  // Direct HTTP client.
  linkedinHttpTimeoutMs: number;
  linkedinUserAgent: string;

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

    linkedinLiAt: env.LINKEDIN_LI_AT ?? '',
    linkedinJsession: env.LINKEDIN_JSESSIONID ?? '',

    linkedinHttpTimeoutMs: intFromEnv('LINKEDIN_HTTP_TIMEOUT_MS', 20_000),
    linkedinUserAgent:
      env.LINKEDIN_USER_AGENT ??
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',

    apiRequestTimeoutMs: intFromEnv('API_REQUEST_TIMEOUT_MS', 90_000),

    maxConcurrentExtractions: intFromEnv('MAX_CONCURRENT_EXTRACTIONS', 2),

    cacheTtlSeconds: intFromEnv('CACHE_TTL_SECONDS', 3600),

    rateLimitMax: intFromEnv('RATE_LIMIT_MAX', 30),
    rateLimitTimeWindow: env.RATE_LIMIT_TIME_WINDOW ?? '1 minute',
  };
}

export const config = loadConfig();
