/**
 * Fastify application factory.
 *
 * Builds the HTTP app, registers plugins (rate limit, OpenAPI/Swagger), and
 * wires the singleton LinkedIn layer (browser + client + service). The browser
 * is created once here and reused for the lifetime of the process.
 */

import Fastify, { type FastifyInstance } from 'fastify';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import { config } from './config.js';
import { buildLoggerOptions } from './utils/logger.js';
import { healthRoutes } from './routes/health.js';
import { profileRoutes } from './routes/profile.js';
import { ProfileService } from './services/profile.service.js';
import { BrowserManager } from './linkedin/browser.js';
import { LinkedInClient } from './linkedin/client.js';

export interface BuiltApp {
  app: FastifyInstance;
  service: ProfileService;
}

function createDefaultService(): ProfileService {
  const browser = new BrowserManager(config);
  const client = new LinkedInClient(browser, config);
  return new ProfileService({ config, extractor: client, session: browser });
}

export async function buildApp(options: { service?: ProfileService } = {}): Promise<BuiltApp> {
  const service = options.service ?? createDefaultService();

  const app = Fastify({
    logger: buildLoggerOptions(),
    requestTimeout: config.apiRequestTimeoutMs,
  });

  // Protect the public API; note this limits the API, not LinkedIn requests.
  await app.register(fastifyRateLimit, {
    max: config.rateLimitMax,
    timeWindow: config.rateLimitTimeWindow,
  });

  await app.register(fastifySwagger, {
    openapi: {
      openapi: '3.0.3',
      info: {
        title: 'LinkedIn Profile API',
        description:
          'Hosted API that accepts a LinkedIn profile URL and returns structured JSON extracted from an authenticated LinkedIn session.',
        version: '1.0.0',
      },
      // Relative server URL so Swagger UI resolves against whatever host the
      // user opened /docs from (localhost, LAN IP, or the deployed domain).
      servers: [{ url: '/' }],
    },
  });

  await app.register(fastifySwaggerUi, {
    routePrefix: '/docs',
  });

  app.register(healthRoutes);
  profileRoutes(app, service);

  return { app, service };
}
