import { describe, it, expect } from 'vitest';
import { parseProfileUrl, profileCacheKey } from '../src/utils/url.js';

describe('parseProfileUrl', () => {
  it('accepts valid HTTPS LinkedIn profile URLs', () => {
    const valid = [
      'https://www.linkedin.com/in/example/',
      'https://linkedin.com/in/example',
      'https://www.linkedin.com/in/example',
      'https://www.linkedin.com/in/john-doe-123/',
      'https://de.linkedin.com/in/someone',
    ];
    for (const url of valid) {
      const result = parseProfileUrl(url);
      expect(result.ok, url).toBe(true);
    }
  });

  it('rejects arbitrary / non-LinkedIn hosts', () => {
    for (const url of ['https://google.com/', 'https://example.com/in/foo', 'https://linkedin.com.evil.com/in/foo']) {
      expect(parseProfileUrl(url).ok, url).toBe(false);
    }
  });

  it('rejects non-HTTPS URLs', () => {
    expect(parseProfileUrl('http://linkedin.com/in/example/').ok).toBe(false);
  });

  it('rejects non-profile paths', () => {
    for (const url of [
      'https://linkedin.com/company/example/',
      'https://www.linkedin.com/feed/',
      'https://www.linkedin.com/jobs/',
      'https://www.linkedin.com/in/',
    ]) {
      expect(parseProfileUrl(url).ok, url).toBe(false);
    }
  });

  it('rejects javascript: and non-URLs', () => {
    for (const url of ['javascript:alert(1)', '', '   ', 'not a url', 42, null, undefined]) {
      expect(parseProfileUrl(url).ok).toBe(false);
    }
  });

  it('extracts the vanity name and canonical URL', () => {
    const result = parseProfileUrl('https://linkedin.com/in/example');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.vanityName).toBe('example');
      expect(result.value.canonicalUrl).toBe('https://www.linkedin.com/in/example/');
    }
  });

  it('produces a deterministic cache key', () => {
    expect(profileCacheKey('Example')).toBe(profileCacheKey('example'));
    expect(profileCacheKey('john-doe')).toBe('linkedin:profile:john-doe');
  });
});
