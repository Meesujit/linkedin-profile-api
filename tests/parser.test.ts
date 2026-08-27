import { describe, it, expect } from 'vitest';
import { parseLinkedInProfile } from '../src/linkedin/parser.js';
import type { RawLinkedInProfile } from '../src/linkedin/types.js';
import { loadLinkedInFixture } from './helpers.js';

describe('parseLinkedInProfile (full fixture)', () => {
  const raw = loadLinkedInFixture<RawLinkedInProfile>('raw-profile.json');
  const { profile, sectionsAvailable, warnings } = parseLinkedInProfile(raw);

  it('maps identity', () => {
    expect(profile.identity.first_name).toBe('Alex');
    expect(profile.identity.last_name).toBe('Rivera');
    expect(profile.identity.middle_name).toBe('James');
    expect(profile.identity.maiden_name).toBeNull();
    expect(profile.identity.full_name).toBe('Alex James Rivera');
    expect(profile.identity.headline).toBe('Senior Software Engineer');
    expect(profile.identity.pronouns).toBe('he/him');
    expect(profile.identity.vanity_name).toBe('alex-rivera');
    expect(profile.identity.profile_url).toBe('https://www.linkedin.com/in/alex-rivera/');
  });

  it('maps location', () => {
    expect(profile.location.raw).toBe('Bengaluru, Karnataka, India');
    expect(profile.location.city).toBe('Bengaluru');
    expect(profile.location.state).toBe('Karnataka');
    expect(profile.location.country).toBe('India');
    expect(profile.location.country_code).toBe('IN');
    expect(profile.location.postal_code).toBeNull();
  });

  it('cleans about whitespace', () => {
    expect(profile.about).toContain('Software engineer focused on distributed systems');
    expect(profile.about).not.toContain('\n');
    expect(profile.about).not.toMatch(/\s{2,}/);
  });

  it('maps images', () => {
    expect(profile.profile_images.profile.url).toContain('profile-displayphoto');
    expect(profile.profile_images.profile.width).toBe(200);
    expect(profile.profile_images.profile.height).toBe(200);
    expect(profile.profile_images.background.url).toContain('background');
    expect(profile.profile_images.gallery).toEqual([]);
  });

  it('maps multiple experience positions with current flag + duration', () => {
    expect(profile.experience).toHaveLength(2);
    const [current, past] = profile.experience as [unknown, unknown];
    const cur = current as (typeof profile.experience)[number];
    const prev = past as (typeof profile.experience)[number];

    expect(cur.title).toBe('Senior Software Engineer');
    expect(cur.company).toBe('Acme Corp');
    expect(cur.company_id).toBe('12345');
    expect(cur.is_current).toBe(true);
    expect(cur.end_date).toBeNull();
    expect(cur.start_date).toBe('2022-03');
    expect(cur.employment_type).toBe('Full-time');

    expect(prev.title).toBe('Software Engineer');
    expect(prev.is_current).toBe(false);
    expect(prev.end_date).toBe('2022-02');
    expect(prev.duration).toBe('2 yrs 8 mos');
  });

  it('maps education', () => {
    expect(profile.education).toHaveLength(1);
    const edu = profile.education[0];
    expect(edu?.school).toBe('Indian Institute of Technology');
    expect(edu?.school_id).toBe('1122');
    expect(edu?.degree).toBe('Bachelor of Technology');
    expect(edu?.field_of_study).toBe('Computer Science');
    expect(edu?.activities).toBe('Coding Club, Robotics Society');
    expect(edu?.start_date).toBe('2015-07');
    expect(edu?.end_date).toBe('2019-05');
  });

  it('maps skills with endorsement counts (null when unknown)', () => {
    expect(profile.skills).toHaveLength(3);
    expect(profile.skills[0]?.name).toBe('TypeScript');
    expect(profile.skills[0]?.endorsement_count).toBe(45);
    expect(profile.skills[2]?.name).toBe('Distributed Systems');
    expect(profile.skills[2]?.endorsement_count).toBeNull();
  });

  it('maps certifications', () => {
    expect(profile.certifications).toHaveLength(1);
    const cert = profile.certifications[0];
    expect(cert?.name).toBe('AWS Certified Solutions Architect');
    expect(cert?.issuer).toBe('Amazon Web Services');
    expect(cert?.issuer_id).toBe('9999');
    expect(cert?.issue_date).toBe('2021-04');
    expect(cert?.expiration_date).toBe('2024-04');
    expect(cert?.credential_id).toBe('AWS-123456');
  });

  it('maps languages', () => {
    expect(profile.languages).toHaveLength(2);
    expect(profile.languages[0]?.name).toBe('English');
    expect(profile.languages[0]?.proficiency).toBe('Professional working proficiency');
  });

  it('maps projects', () => {
    expect(profile.projects).toHaveLength(1);
    expect(profile.projects[0]?.name).toBe('OpenSearch Migration');
    expect(profile.projects[0]?.associated_with).toBe('Acme Corp');
  });

  it('maps contact info', () => {
    expect(profile.contact_info.websites).toHaveLength(1);
    expect(profile.contact_info.websites[0]?.url).toBe('https://alexrivera.dev');
    expect(profile.contact_info.github).toBe('https://github.com/alexrivera');
    expect(profile.contact_info.twitter).toBeNull();
  });

  it('maps counts and flags', () => {
    expect(profile.connections_count).toBe(512);
    expect(profile.followers_count).toBe(1204);
    expect(profile.open_to_work).toBe(false);
    expect(profile.hiring).toBe(true);
  });

  it('reports available sections and no warnings', () => {
    expect(sectionsAvailable).toContain('experience');
    expect(sectionsAvailable).toContain('education');
    expect(sectionsAvailable).toContain('skills');
    expect(sectionsAvailable).toContain('certifications');
    expect(sectionsAvailable).toContain('languages');
    expect(sectionsAvailable).not.toContain('patents');
    expect(sectionsAvailable).not.toContain('awards');
    expect(warnings).toEqual([]);
  });
});

describe('parseLinkedInProfile (missing / null data)', () => {
  it('derives full name from first + last when fullName is absent', () => {
    const raw = loadLinkedInFixture<RawLinkedInProfile>('raw-profile.json');
    raw.identity.fullName = null;
    const { profile } = parseLinkedInProfile(raw);
    expect(profile.identity.full_name).toBe('Alex James Rivera');
  });

  it('returns null about when absent', () => {
    const raw = loadLinkedInFixture<RawLinkedInProfile>('raw-profile.json');
    raw.about = null;
    expect(parseLinkedInProfile(raw).profile.about).toBeNull();
  });

  it('returns empty arrays for absent sections', () => {
    const raw = loadLinkedInFixture<RawLinkedInProfile>('raw-profile.json');
    raw.patents = [];
    raw.awards = [];
    raw.publications = [];
    const { profile } = parseLinkedInProfile(raw);
    expect(profile.patents).toEqual([]);
    expect(profile.awards).toEqual([]);
    expect(profile.publications).toEqual([]);
  });

  it('handles experience with a null timePeriod', () => {
    const raw = loadLinkedInFixture<RawLinkedInProfile>('raw-profile.json');
    raw.experience = [
      {
        title: 'Consultant',
        company: 'Self',
        companyUrn: null,
        companyUrl: null,
        companyLogo: null,
        employmentType: null,
        location: null,
        description: null,
        timePeriod: null,
      },
    ];
    const { profile } = parseLinkedInProfile(raw);
    expect(profile.experience[0]?.title).toBe('Consultant');
    expect(profile.experience[0]?.start_date).toBeNull();
    expect(profile.experience[0]?.end_date).toBeNull();
    expect(profile.experience[0]?.is_current).toBe(false);
    expect(profile.experience[0]?.duration).toBeNull();
  });
});
