import type { FastifyInstance } from 'fastify';

/**
 * Liveness endpoint. Deliberately returns no LinkedIn session details.
 */
export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/health',
    {
      schema: {
        response: {
          200: {
            type: 'object',
            properties: {
              status: { type: 'string' },
              service: { type: 'string' },
            },
          },
        },
      },
    },
    async () => ({
      status: 'ok',
      service: 'linkedin-profile-api',
    }),
  );
}
