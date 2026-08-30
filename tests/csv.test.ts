import { describe, it, expect } from 'vitest';
import { toCsv } from '../src/utils/csv.js';
import { parseLinkedInProfile } from '../src/linkedin/parser.js';
import { loadLinkedInFixture } from './helpers.js';
import type { RawLinkedInProfile } from '../src/linkedin/types.js';

const normalized = parseLinkedInProfile(loadLinkedInFixture<RawLinkedInProfile>('raw-profile.json')).profile;

describe('toCsv', () => {
  it('emits a header row and one data row per profile', () => {
    const csv = toCsv([{ url: 'https://www.linkedin.com/in/alex-rivera/', profile: normalized }]);
    const lines = csv.split('\n');
    expect(lines[0]).toContain('full_name');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('alex-rivera');
    expect(lines[1]).toContain('Alex');
  });

  it('escapes commas and quotes in values', () => {
    const overridden = {
      ...normalized,
      identity: { ...normalized.identity, headline: 'Engineer, "Senior"' },
    };
    const csv = toCsv([{ url: 'https://www.linkedin.com/in/x/', profile: overridden }]);
    expect(csv).toContain('"Engineer, ""Senior"""');
  });
});
