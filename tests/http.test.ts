import { describe, it, expect, vi, afterEach } from 'vitest';
import { LinkedInHttp } from '../src/linkedin/http.js';
import { LinkedInClient } from '../src/linkedin/client.js';
import {
  AuthRequiredError,
  ProfileNotFoundError,
  ProfileNotAccessibleError,
  RateLimitedError,
  ExtractionTimeoutError,
} from '../src/linkedin/errors.js';
import { makeConfig, loadLinkedInFixture } from './helpers.js';

const SESSION = { liAt: 'test-li-at', jsession: '"ajax:test"', csrfToken: 'ajax:test' };

function http(config = makeConfig({ linkedinLiAt: SESSION.liAt, linkedinJsession: SESSION.jsession })): LinkedInHttp {
  return new LinkedInHttp(config, SESSION);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('LinkedInHttp', () => {
  it('parses a successful JSON response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })));
    await expect(http().getJson('/voyager/api/me')).resolves.toEqual({ ok: true });
  });

  it('maps a redirect to AUTHENTICATION (no following)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 302, headers: { location: '/login' } })));
    await expect(http().getJson('/x')).rejects.toBeInstanceOf(AuthRequiredError);
  });

  it('maps HTTP 999 to RATE_LIMITED', async () => {
    // Status 999 can't be created with the WHATWG Response constructor (it
    // validates 200-599), so mock a minimal response object.
    vi.stubGlobal('fetch', vi.fn(async () => ({
      status: 999,
      headers: new Headers({}),
      text: async () => '',
    })));
    await expect(http().getJson('/x')).rejects.toBeInstanceOf(RateLimitedError);
  });

  it('maps 401 → auth, 403 → not accessible, 404 → not found, 429 → rate limited', async () => {
    for (const [status, Err] of [
      [401, AuthRequiredError],
      [403, ProfileNotAccessibleError],
      [404, ProfileNotFoundError],
      [429, RateLimitedError],
    ] as const) {
      vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status })));
      await expect(http().getJson('/x')).rejects.toBeInstanceOf(Err);
    }
  });

  it('times out via AbortController', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, opts: { signal?: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            opts.signal?.addEventListener('abort', () => reject(new Error('aborted')));
          }),
      ),
    );
    const cfg = makeConfig({ linkedinLiAt: 'a', linkedinJsession: '"ajax:b"', linkedinHttpTimeoutMs: 20 });
    await expect(http(cfg).getJson('/x')).rejects.toBeInstanceOf(ExtractionTimeoutError);
  });
});

describe('LinkedInClient', () => {
  it('extracts a profile via direct HTTP and tolerates a missing contact-info endpoint', async () => {
    const profileBlob = loadLinkedInFixture('embedded-profile.json');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/profileView')) {
          return new Response(JSON.stringify(profileBlob), { status: 200, headers: { 'content-type': 'application/json' } });
        }
        return new Response('', { status: 404 });
      }),
    );

    const client = new LinkedInClient(
      makeConfig({ linkedinLiAt: SESSION.liAt, linkedinJsession: SESSION.jsession }),
    );
    const { raw, method, warnings } = await client.extractProfile(
      'https://www.linkedin.com/in/alex-rivera/',
      'alex-rivera',
    );

    expect(method).toBe('network');
    expect(raw.identity.firstName).toBe('Alex');
    expect(raw.identity.lastName).toBe('Rivera');
    expect(raw.experience).toHaveLength(2);
    // missing contact info is non-fatal
    expect(warnings).not.toContain('Contact info unavailable.');
    expect(raw.contactInfo.websites).toEqual([]);
  });

  it('reports whether a session is configured', () => {
    const noSession = new LinkedInClient(makeConfig());
    expect(noSession.hasSessionState()).toBe(false);
    const withSession = new LinkedInClient(
      makeConfig({ linkedinLiAt: 'a', linkedinJsession: '"ajax:b"' }),
    );
    expect(withSession.hasSessionState()).toBe(true);
  });

  it('throws ProfileNotAccessible when the payload has no profile entity', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ foo: 'bar' }), { status: 200 })));
    const client = new LinkedInClient(
      makeConfig({ linkedinLiAt: SESSION.liAt, linkedinJsession: SESSION.jsession }),
    );
    await expect(client.extractProfile('https://www.linkedin.com/in/nope/', 'nope')).rejects.toBeInstanceOf(
      ProfileNotAccessibleError,
    );
  });
});
