import type { FastifyInstance } from 'fastify';
import { profileRequestSchema } from '../schemas/profile.schema.js';
import { parseProfileUrl } from '../utils/url.js';
import { LinkedInError } from '../linkedin/errors.js';
import type { ErrorCode } from '../types/index.js';
import type { ProfileService } from '../services/profile.service.js';

type ErrorStatusCode = 400 | 401 | 403 | 404 | 429 | 500 | 502 | 504;

const HTTP_STATUS: Record<ErrorCode, ErrorStatusCode> = {
  INVALID_URL: 400,
  LINKEDIN_AUTH_REQUIRED: 401,
  PROFILE_NOT_FOUND: 404,
  PROFILE_NOT_ACCESSIBLE: 403,
  EXTRACTION_FAILED: 502,
  RATE_LIMITED: 429,
  TIMEOUT: 504,
  INTERNAL_ERROR: 500,
};

interface ErrorBody {
  success: false;
  error: { code: string; message: string; details: Record<string, unknown> };
}

function toErrorResponse(err: unknown): { status: ErrorStatusCode; body: ErrorBody } {
  if (err instanceof LinkedInError) {
    return {
      status: HTTP_STATUS[err.code],
      body: { success: false, error: { code: err.code, message: err.message, details: err.details } },
    };
  }
  // Unknown errors are logged upstream; the client only ever sees a safe code.
  return {
    status: 500,
    body: {
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Unexpected internal error.', details: {} },
    },
  };
}

const errorSchema = () => ({
  type: 'object',
  properties: {
    success: { type: 'boolean', enum: [false] },
    error: {
      type: 'object',
      properties: {
        code: { type: 'string' },
        message: { type: 'string' },
        details: { type: 'object', additionalProperties: true },
      },
    },
  },
});

export function profileRoutes(app: FastifyInstance, service: ProfileService): void {
  app.post(
    '/v1/profile',
    {
      schema: {
        tags: ['profile'],
        summary: 'Extract a LinkedIn profile as structured JSON',
        body: {
          type: 'object',
          required: ['url'],
          additionalProperties: false,
          properties: {
            url: {
              type: 'string',
              description: 'HTTPS LinkedIn profile URL beginning with /in/',
            },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [true] },
              profile: { type: 'object', additionalProperties: true },
              metadata: { type: 'object', additionalProperties: true },
            },
          },
          400: errorSchema(),
          401: errorSchema(),
          403: errorSchema(),
          404: errorSchema(),
          429: errorSchema(),
          500: errorSchema(),
          502: errorSchema(),
          504: errorSchema(),
        },
      },
    },
    async (request, reply) => {
      const parsed = profileRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          success: false,
          error: {
            code: 'INVALID_URL',
            message: parsed.error.issues[0]?.message ?? 'Invalid URL.',
            details: {},
          },
        });
      }

      const urlResult = parseProfileUrl(parsed.data.url);
      if (!urlResult.ok) {
        return reply.code(400).send({
          success: false,
          error: { code: urlResult.code, message: urlResult.message, details: {} },
        });
      }

      try {
        const response = await service.getProfile(urlResult.value.vanityName, urlResult.value.canonicalUrl);
        return reply.send(response);
      } catch (err) {
        const { status, body } = toErrorResponse(err);
        request.log.error({ err, profileUrl: urlResult.value.canonicalUrl }, 'profile extraction failed');
        return reply.code(status).send(body);
      }
    },
  );
}
