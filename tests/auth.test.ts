import { describe, it, expect } from 'vitest';
import { resolveSession } from '../src/linkedin/auth.js';
import { AuthRequiredError } from '../src/linkedin/errors.js';
import { makeConfig } from './helpers.js';

describe('resolveSession', () => {
  it('uses env-provided credentials and derives the csrf-token', () => {
    const s = resolveSession(
      makeConfig({ linkedinLiAt: 'abc', linkedinJsession: '"ajax:12345"' }),
    );
    expect(s.liAt).toBe('abc');
    expect(s.jsession).toBe('"ajax:12345"');
    // csrf-token = JSESSIONID value with quotes stripped
    expect(s.csrfToken).toBe('ajax:12345');
  });

  it('handles an unquoted JSESSIONID value', () => {
    const s = resolveSession(
      makeConfig({ linkedinLiAt: 'abc', linkedinJsession: 'ajax:999' }),
    );
    expect(s.csrfToken).toBe('ajax:999');
  });

  it('throws AuthRequiredError when no credentials are configured', () => {
    expect(() => resolveSession(makeConfig())).toThrow(AuthRequiredError);
    expect(() => resolveSession(makeConfig({ linkedinLiAt: 'only-li' }))).toThrow(AuthRequiredError);
    expect(() => resolveSession(makeConfig({ linkedinJsession: 'only-js' }))).toThrow(AuthRequiredError);
  });
});
