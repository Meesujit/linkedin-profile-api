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
import { makeConfig } from './helpers.js';

const SESSION = { liAt: 'test-li-at', jsession: '"ajax:test"', csrfToken: 'ajax:test' };

function http(cfg = makeConfig({ linkedinLiAt: SESSION.liAt, linkedinJsession: SESSION.jsession })): LinkedInHttp {
  return new LinkedInHttp(cfg, SESSION);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('LinkedInHttp', () => {
  it('returns text for a successful GET', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<title>x</title>', { status: 200 })));
    await expect(http().getText('/in/x/')).resolves.toContain('<title>x</title>');
  });

  it('maps a redirect to AUTHENTICATION (no following)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 302, headers: { location: '/login' } })));
    await expect(http().getText('/x')).rejects.toBeInstanceOf(AuthRequiredError);
  });

  it('maps HTTP 999 to RATE_LIMITED', async () => {
    // 999 can't be built with the WHATWG Response constructor (validates
    // 200-599), so mock a minimal object.
    vi.stubGlobal('fetch', vi.fn(async () => ({ status: 999, headers: new Headers({}), text: async () => '' })));
    await expect(http().getText('/x')).rejects.toBeInstanceOf(RateLimitedError);
  });

  it('maps 401 → auth, 403 → not accessible, 404 → not found, 429 → rate limited', async () => {
    for (const [status, Err] of [
      [401, AuthRequiredError],
      [403, ProfileNotAccessibleError],
      [404, ProfileNotFoundError],
      [429, RateLimitedError],
    ] as const) {
      vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status })));
      await expect(http().getText('/x')).rejects.toBeInstanceOf(Err);
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
    await expect(http(cfg).getText('/x')).rejects.toBeInstanceOf(ExtractionTimeoutError);
  });
});

describe('LinkedInClient', () => {
  it('extracts a profile via direct HTTP (HTML + RSC components)', async () => {
    const html = `<title>Alex Rivera | LinkedIn</title><p>Alex Rivera</p><p>Engineer</p><p>Bengaluru, Karnataka, India</p>`;
    const rsc = `["$","div",null,{"children":["Experience"]}]`;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/in/')) return new Response(html, { status: 200 });
        return new Response(rsc, { status: 200 });
      }),
    );

    const client = new LinkedInClient(makeConfig({ linkedinLiAt: SESSION.liAt, linkedinJsession: SESSION.jsession }));
    const { raw, method } = await client.extractProfile('https://www.linkedin.com/in/alex-rivera/', 'alex-rivera');

    expect(method).toBe('network');
    expect(raw.identity.fullName).toBe('Alex Rivera');
    expect(raw.location.raw).toBe('Bengaluru, Karnataka, India');
  });

  it('reports whether a session is configured', () => {
    expect(new LinkedInClient(makeConfig()).hasSessionState()).toBe(false);
    expect(new LinkedInClient(makeConfig({ linkedinLiAt: 'a', linkedinJsession: '"ajax:b"' })).hasSessionState()).toBe(true);
  });
});
