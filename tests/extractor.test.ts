import { describe, it, expect } from 'vitest';
import { rawFromJson } from '../src/linkedin/extractor.js';
import { loadLinkedInFixture } from './helpers.js';

describe('rawFromJson', () => {
  it('maps an embedded LinkedIn-shaped profile payload', () => {
    const blob = loadLinkedInFixture('embedded-profile.json');
    const raw = rawFromJson(blob, 'alex-rivera');
    expect(raw).not.toBeNull();
    if (!raw) return;

    expect(raw.identity.firstName).toBe('Alex');
    expect(raw.identity.lastName).toBe('Rivera');
    expect(raw.identity.headline).toBe('Senior Software Engineer');
    expect(raw.identity.publicIdentifier).toBe('alex-rivera');
    expect(raw.location.raw).toBe('Bengaluru, Karnataka, India');

    expect(raw.experience).toHaveLength(2);
    expect(raw.experience[0]?.title).toBe('Senior Software Engineer');
    expect(raw.experience[0]?.company).toBe('Acme Corp');
    expect(raw.experience[0]?.companyUrn).toBe('urn:li:fsd_company:12345');
    expect(raw.experience[0]?.timePeriod?.endDate).toBeNull();

    expect(raw.education).toHaveLength(1);
    expect(raw.education[0]?.school).toBe('Indian Institute of Technology');

    expect(raw.skills).toHaveLength(2);
    expect(raw.skills[0]?.name).toBe('TypeScript');
    expect(raw.skills[0]?.endorsementCount).toBe(45);
    expect(raw.skills[1]?.endorsementCount).toBeNull();

    expect(raw.languages).toHaveLength(2);
    expect(raw.certifications).toHaveLength(1);
    expect(raw.certifications[0]?.issuer).toBe('Amazon Web Services');

    expect(raw.connectionsCount).toBe(512);
    expect(raw.followersCount).toBe(1204);
  });

  it('returns null for a non-profile payload', () => {
    expect(rawFromJson({ foo: 'bar', baz: [1, 2, 3] }, 'x')).toBeNull();
    expect(rawFromJson(null, 'x')).toBeNull();
    expect(rawFromJson([1, 2, 3], 'x')).toBeNull();
  });

  it('does not fabricate missing fields', () => {
    const blob = loadLinkedInFixture('embedded-profile.json');
    const raw = rawFromJson(blob, 'alex-rivera');
    expect(raw).not.toBeNull();
    if (!raw) return;
    expect(raw.about).toBeDefined();
    expect(raw.patents).toEqual([]);
    expect(raw.awards).toEqual([]);
    expect(raw.openToWork).toBeNull();
  });
});
