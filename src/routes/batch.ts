import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { parseProfileUrl } from '../utils/url.js';
import { toCsv } from '../utils/csv.js';
import { LinkedInError } from '../linkedin/errors.js';
import type { ProfileService } from '../services/profile.service.js';
import type { NormalizedProfile, ProfileResponse } from '../schemas/profile.schema.js';

const MAX_BATCH = 50;

const batchRequestSchema = z.object({
  urls: z.array(z.string()).min(1).max(MAX_BATCH),
});

interface ErrorInfo {
  code: string;
  message: string;
}

type BatchItem =
  | { url: string; success: true; profile: NormalizedProfile; metadata: ProfileResponse['metadata'] }
  | { url: string; success: false; error: ErrorInfo };

function toErrorInfo(err: unknown): ErrorInfo {
  if (err instanceof LinkedInError) {
    return { code: err.code, message: err.message };
  }
  return { code: 'INTERNAL_ERROR', message: 'Unexpected internal error.' };
}

export function batchRoutes(app: FastifyInstance, service: ProfileService): void {
  app.post(
    '/v1/profile/batch',
    {
      schema: {
        tags: ['profile'],
        summary: 'Extract multiple LinkedIn profiles (JSON or CSV)',
        querystring: {
          type: 'object',
          properties: { format: { type: 'string', enum: ['json', 'csv'] } },
        },
        body: {
          type: 'object',
          required: ['urls'],
          additionalProperties: false,
          properties: {
            urls: {
              type: 'array',
              maxItems: MAX_BATCH,
              items: { type: 'string' },
              description: 'LinkedIn profile URLs (max 50).',
            },
          },
        },
        response: {
          200: { type: 'object', additionalProperties: true },
          400: { type: 'object', additionalProperties: true },
        },
      },
    },
    async (request, reply) => {
      const parsed = batchRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          success: false,
          error: {
            code: 'INVALID_REQUEST',
            message: `urls must be a non-empty array of 1–${MAX_BATCH} strings.`,
            details: {},
          },
        });
      }

      const results: BatchItem[] = await Promise.all(
        parsed.data.urls.map(async (url): Promise<BatchItem> => {
          const urlResult = parseProfileUrl(url);
          if (!urlResult.ok) {
            return { url, success: false, error: { code: urlResult.code, message: urlResult.message } };
          }
          try {
            const response = await service.getProfile(urlResult.value.vanityName, urlResult.value.canonicalUrl);
            return { url, success: true, profile: response.profile, metadata: response.metadata };
          } catch (err) {
            return { url, success: false, error: toErrorInfo(err) };
          }
        }),
      );

      const format = (request.query as { format?: string }).format;
      if (format === 'csv') {
        return sendCsv(reply, results);
      }
      return reply.send({ success: true, count: results.length, results });
    },
  );
}

function sendCsv(reply: FastifyReply, results: BatchItem[]): FastifyReply {
  const rows = results
    .filter((r): r is Extract<BatchItem, { success: true }> => r.success)
    .map((r) => ({ url: r.url, profile: r.profile }));
  const csv = toCsv(rows);
  return reply
    .header('Content-Type', 'text/csv; charset=utf-8')
    .header('Content-Disposition', 'attachment; filename="linkedin-profiles.csv"')
    .send(csv);
}
