import { describe, it, expect } from 'vitest';
import { rawFromJson, parseProfileText } from '../src/linkedin/extractor.js';
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

describe('parseProfileText (current SDUI innerText)', () => {
  const text = [
    'sujit gouda',
    'Software Developer at Eduplor. Building tools that automate boring processes.',
    'Message',
    'Follow',
    'sujit gouda',
    'He/Him',
    'Software Developer at Eduplor. Building tools that automate boring processes.',
    'Brahmapur, Odisha, India',
    '·',
    'Contact info',
    '563 followers',
    '·',
    '500+',
    'connections',
    'Follow',
    'Message',
    'About',
    'Automating the boring parts of life.',
    'Experimenting with self-hosted systems and personal cloud.',
    'Experience',
    'Senior Software Engineer',
    'Acme Corp · Full-time',
    'Mar 2022 - Present · 2 yrs 8 mos',
    'Bengaluru, Karnataka, India',
    'Software Engineer',
    'Globex Inc · Full-time',
    'Jun 2019 - Feb 2022 · 2 yrs 8 mos',
    'Pune, Maharashtra, India',
    'Education',
    'Indian Institute of Technology',
    'Bachelor of Technology',
    'Skills',
    'TypeScript',
    'Node.js',
    'Distributed Systems',
    'Languages',
    'English - Professional working proficiency',
    'Hindi - Native or bilingual proficiency',
  ].join('\n');

  const parsed = parseProfileText(text, 'sujit gouda | LinkedIn');

  it('extracts identity + top-card fields', () => {
    expect(parsed.identity?.firstName).toBe('sujit');
    expect(parsed.identity?.lastName).toBe('gouda');
    expect(parsed.identity?.fullName).toBe('sujit gouda');
    expect(parsed.identity?.headline).toBe('Software Developer at Eduplor. Building tools that automate boring processes.');
    expect(parsed.identity?.pronouns).toBe('He/Him');
    expect(parsed.location?.raw).toBe('Brahmapur, Odisha, India');
    expect(parsed.about).toContain('Automating the boring parts');
  });

  it('extracts followers/connections counts', () => {
    expect(parsed.followersCount).toBe(563);
    expect(parsed.connectionsCount).toBe(500);
  });

  it('extracts skills and languages', () => {
    expect(parsed.skills?.map((s) => s.name)).toEqual(['TypeScript', 'Node.js', 'Distributed Systems']);
    expect(parsed.languages).toEqual([
      { name: 'English', proficiency: 'Professional working proficiency' },
      { name: 'Hindi', proficiency: 'Native or bilingual proficiency' },
    ]);
  });

  it('stops about at the Featured/Activity boundary', () => {
    const t = [
      'sujit gouda',
      'About',
      'Just the about text.',
      'Featured',
      'Link',
      'A project',
      'Activity',
      'A post here',
      'More profiles for you',
      'Some random person',
    ].join('\n');
    const p = parseProfileText(t, 'sujit gouda | LinkedIn');
    expect(p.about).toBe('Just the about text.');
  });

  it('extracts experience items conservatively', () => {
    expect(parsed.experience).toHaveLength(2);
    expect(parsed.experience?.[0]?.title).toBe('Senior Software Engineer');
    expect(parsed.experience?.[0]?.company).toBe('Acme Corp · Full-time');
    expect(parsed.experience?.[1]?.title).toBe('Software Engineer');
    expect(parsed.experience?.[1]?.company).toBe('Globex Inc · Full-time');
  });

  it('filters skill "associated role" lines', () => {
    const t = [
      'sujit gouda',
      'Skills (47)',
      'Software Observability',
      'Senior Site Reliability Engineer (Via One2N) at Fravity AI',
      'Platform Engineering',
      'Senior Site Reliability Engineer (Via One2N) at Fravity AI',
      'Show all',
    ].join('\n');
    const p = parseProfileText(t, 'sujit gouda | LinkedIn');
    expect(p.skills?.map((s) => s.name)).toEqual(['Software Observability', 'Platform Engineering']);
  });

  it('extracts education and projects', () => {
    const t = [
      'sujit gouda',
      'Education',
      'SASTRA, Thanjavur',
      'Master of Computer Applications - MCA',
      '2021 – 2023',
      'Grade: 9.33',
      'Berhampur University',
      'Bachelor of Science - BS',
      'May 2017 – May 2020',
      'Grade: 9.40',
      'Projects (3)',
      'Kiln',
      'Kiln - Workload Isolation as a Service',
      'Platform Zero',
      'Platform Zero - From Blank Machine to Full Platform',
    ].join('\n');
    const p = parseProfileText(t, 'sujit gouda | LinkedIn');
    expect(p.education).toHaveLength(2);
    expect(p.education?.[0]?.school).toBe('SASTRA, Thanjavur');
    expect(p.education?.[0]?.degree).toBe('Master of Computer Applications - MCA');
    expect(p.education?.[0]?.grade).toBe('9.33');
    expect(p.education?.[0]?.timePeriod?.startDate?.year).toBe(2021);
    expect(p.education?.[1]?.timePeriod?.startDate?.month).toBe(5);
    expect(p.projects).toHaveLength(2);
    expect(p.projects?.[0]).toMatchObject({ name: 'Kiln', description: 'Workload Isolation as a Service' });
    expect(p.projects?.[1]).toMatchObject({ name: 'Platform Zero', description: 'From Blank Machine to Full Platform' });
  });
});
