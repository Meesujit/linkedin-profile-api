import { describe, it, expect } from 'vitest';
import {
  profileRequestSchema,
  profileResponseSchema,
  profileSchema,
  type ProfileResponse,
} from '../src/schemas/profile.schema.js';
import { loadLinkedInFixture } from './helpers.js';
import type { RawLinkedInProfile } from '../src/linkedin/types.js';
import { parseLinkedInProfile } from '../src/linkedin/parser.js';

describe('profileRequestSchema', () => {
  it('accepts a valid LinkedIn profile URL', () => {
    const result = profileRequestSchema.safeParse({ url: 'https://www.linkedin.com/in/example/' });
    expect(result.success).toBe(true);
  });

  it('rejects invalid URLs', () => {
    for (const url of [
      'https://google.com/',
      'http://linkedin.com/in/example/',
      'https://linkedin.com/company/example/',
      'javascript:alert(1)',
      '',
    ]) {
      expect(profileRequestSchema.safeParse({ url }).success, url).toBe(false);
    }
  });

  it('rejects a missing url field', () => {
    expect(profileRequestSchema.safeParse({}).success).toBe(false);
  });
});

describe('profileSchema (empty data rule)', () => {
  it('accepts a fully empty profile', () => {
    const raw: RawLinkedInProfile = {
      entityUrn: null,
      identity: {
        firstName: null,
        lastName: null,
        middleName: null,
        maidenName: null,
        fullName: null,
        headline: null,
        pronouns: null,
        publicIdentifier: 'example',
        profileUrl: 'https://www.linkedin.com/in/example/',
        vanityName: 'example',
      },
      location: { raw: null, city: null, state: null, country: null, countryCode: null, postalCode: null },
      about: null,
      profilePicture: null,
      backgroundPicture: null,
      gallery: [],
      experience: [],
      education: [],
      skills: [],
      certifications: [],
      languages: [],
      courses: [],
      projects: [],
      volunteerExperience: [],
      awards: [],
      publications: [],
      patents: [],
      organizations: [],
      interests: [],
      recommendations: [],
      contactInfo: { websites: [], twitter: null, github: null, otherSocialProfiles: [] },
      connectionsCount: null,
      followersCount: null,
      openToWork: null,
      hiring: null,
    };
    const parsed = parseLinkedInProfile(raw).profile;
    const result = profileSchema.safeParse(parsed);
    expect(result.success).toBe(true);
    expect(parsed.experience).toEqual([]);
    expect(parsed.about).toBeNull();
    expect(parsed.connections_count).toBeNull();
  });
});

describe('profileResponseSchema', () => {
  it('validates a fully populated response', () => {
    const raw = loadLinkedInFixture<RawLinkedInProfile>('raw-profile.json');
    const parsed = parseLinkedInProfile(raw);
    const response: ProfileResponse = {
      success: true,
      profile: parsed.profile,
      metadata: {
        scraped_at: '2026-08-27T00:00:00.000Z',
        source: 'linkedin',
        extraction_method: 'network',
        authenticated: true,
        partial: false,
        sections_available: parsed.sectionsAvailable,
        warnings: [],
      },
    };
    expect(profileResponseSchema.safeParse(response).success).toBe(true);
  });

  it('rejects a response missing the profile object', () => {
    const bad = { success: true, metadata: {} };
    expect(profileResponseSchema.safeParse(bad).success).toBe(false);
  });
});
