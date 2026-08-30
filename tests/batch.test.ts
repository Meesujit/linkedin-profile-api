import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { ProfileService } from '../src/services/profile.service.js';
import type { RawLinkedInProfile } from '../src/linkedin/types.js';
import { loadLinkedInFixture } from './helpers.js';

const rawFixture = loadLinkedInFixture<RawLinkedInProfile>('raw-profile.json');

function makeService(hasSession = true): ProfileService {
  return new ProfileService({
    extractor: { extractProfile: async () => ({ raw: rawFixture, method: 'network', warnings: [] }) },
    session: { hasSessionState: () => hasSession, close: async () => {} },
  });
}

describe('POST /v1/profile/batch', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = (await buildApp({ service: makeService() })).app;
  });

  afterAll(async () => {
    await app.close();
  });

  it('extracts multiple valid profiles', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/profile/batch',
      payload: {
        urls: ['https://www.linkedin.com/in/alex-rivera/', 'https://www.linkedin.com/in/sam-jones/'],
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.results).toHaveLength(2);
    expect(body.results[0].success).toBe(true);
    expect(body.results[0].profile.identity.first_name).toBe('Alex');
  });

  it('returns a per-item error for an invalid URL', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/profile/batch',
      payload: { urls: ['https://google.com/', 'https://www.linkedin.com/in/alex-rivera/'] },
    });
    const body = res.json();
    expect(body.results[0].success).toBe(false);
    expect(body.results[0].error.code).toBe('INVALID_URL');
    expect(body.results[1].success).toBe(true);
  });

  it('returns CSV when format=csv', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/profile/batch?format=csv',
      payload: { urls: ['https://www.linkedin.com/in/alex-rivera/'] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.body).toContain('full_name');
    expect(res.body).toContain('Alex');
  });

  it('rejects an empty urls array', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/profile/batch', payload: { urls: [] } });
    expect(res.statusCode).toBe(400);
  });
});

describe('API key protection (X-API-Key)', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.API_KEY = 'test-secret';
  });

  afterEach(() => {
    delete process.env.API_KEY;
  });

  it('rejects /v1 without the key, allows with it, keeps /health open', async () => {
    const { buildApp: build } = await import('../src/app.js');
    const { ProfileService: PS } = await import('../src/services/profile.service.js');
    const { loadLinkedInFixture: load } = await import('./helpers.js');
    const raw = load<RawLinkedInProfile>('raw-profile.json');
    const service = new PS({
      extractor: { extractProfile: async () => ({ raw, method: 'network', warnings: [] }) },
      session: { hasSessionState: () => true, close: async () => {} },
    });
    const instance = (await build({ service })).app;

    const denied = await instance.inject({
      method: 'POST',
      url: '/v1/profile',
      payload: { url: 'https://www.linkedin.com/in/x/' },
    });
    expect(denied.statusCode).toBe(401);
    expect(denied.json().error.code).toBe('UNAUTHORIZED');

    const allowed = await instance.inject({
      method: 'POST',
      url: '/v1/profile',
      headers: { 'x-api-key': 'test-secret' },
      payload: { url: 'https://www.linkedin.com/in/alex-rivera/' },
    });
    expect(allowed.statusCode).toBe(200);

    const health = await instance.inject({ method: 'GET', url: '/health' });
    expect(health.statusCode).toBe(200);

    await instance.close();
  });
});
