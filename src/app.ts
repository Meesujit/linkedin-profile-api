/**
 * Fastify application factory.
 *
 * Builds the HTTP app, registers plugins (rate limit, OpenAPI/Swagger), and
 * wires the singleton LinkedIn layer (HTTP client + service). The LinkedIn
 * client performs direct HTTP requests — no browser is launched.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import { config } from './config.js';
import { buildLoggerOptions } from './utils/logger.js';
import { healthRoutes } from './routes/health.js';
import { profileRoutes } from './routes/profile.js';
import { batchRoutes } from './routes/batch.js';
import { ProfileService } from './services/profile.service.js';
import { LinkedInClient } from './linkedin/client.js';

export interface BuiltApp {
  app: FastifyInstance;
  service: ProfileService;
}

function createDefaultService(): ProfileService {
  const client = new LinkedInClient(config);
  // The client doubles as the session gate (it can report whether credentials
  // are configured) and the extractor.
  return new ProfileService({ config, extractor: client, session: client });
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

  // Optional API-key protection for the extraction endpoints. When API_KEY is
  // set, every /v1/* route requires a matching `X-API-Key` header. /health and
  // /docs stay open.
  if (config.apiKey) {
    app.addHook('preHandler', async (request, reply) => {
      if (request.url.startsWith('/v1/')) {
        const provided = request.headers['x-api-key'];
        if (provided !== config.apiKey) {
          return reply.code(401).send({
            success: false,
            error: { code: 'UNAUTHORIZED', message: 'Missing or invalid API key.', details: {} },
          });
        }
      }
    });
  }

  app.register(healthRoutes);
  profileRoutes(app, service);
  batchRoutes(app, service);

  // Static frontend — registered last so the API routes always take precedence.
  await app.register(fastifyStatic, {
    root: path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public'),
    prefix: '/',
    index: 'index.html',
  });

  return { app, service };
}
