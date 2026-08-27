import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';

describe('GET /health', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = (await buildApp()).app;
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns ok with no session details', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toEqual({ status: 'ok', service: 'linkedin-profile-api' });
    expect(JSON.stringify(body)).not.toContain('cookie');
    expect(JSON.stringify(body)).not.toContain('session');
  });
});
