import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import {
  ProfileService,
  type ProfileExtractor,
  type SessionGate,
} from '../src/services/profile.service.js';
import type { RawLinkedInProfile } from '../src/linkedin/types.js';
import { loadLinkedInFixture } from './helpers.js';

const rawFixture = loadLinkedInFixture<RawLinkedInProfile>('raw-profile.json');

function makeExtractor(): ProfileExtractor {
  return {
    extractProfile: async () => ({ raw: rawFixture, method: 'network', warnings: [] }),
  };
}

function authSession(hasState: boolean): SessionGate {
  return { hasSessionState: () => hasState, close: async () => {} };
}

describe('POST /v1/profile (happy path + validation)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const service = new ProfileService({ extractor: makeExtractor(), session: authSession(true) });
    app = (await buildApp({ service })).app;
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects an invalid URL with INVALID_URL', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/profile',
      payload: { url: 'https://google.com/' },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('INVALID_URL');
  });

  it('rejects a non-profile LinkedIn path', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/profile',
      payload: { url: 'https://www.linkedin.com/company/example/' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('INVALID_URL');
  });

  it('returns a normalized profile for a valid URL', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/profile',
      payload: { url: 'https://www.linkedin.com/in/alex-rivera/' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.profile.identity.first_name).toBe('Alex');
    expect(body.profile.experience).toHaveLength(2);
    expect(body.metadata.extraction_method).toBe('network');
    expect(body.metadata.authenticated).toBe(true);
    expect(body.metadata.partial).toBe(false);
  });
});

describe('POST /v1/profile (auth required)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const service = new ProfileService({ extractor: makeExtractor(), session: authSession(false) });
    app = (await buildApp({ service })).app;
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns LINKEDIN_AUTH_REQUIRED when no session exists', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/profile',
      payload: { url: 'https://www.linkedin.com/in/alex-rivera/' },
    });
    expect(res.statusCode).toBe(401);
    const body = res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('LINKEDIN_AUTH_REQUIRED');
  });
});
