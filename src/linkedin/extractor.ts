/// <reference lib="dom" />
/**
 * LinkedIn extractor — layered extraction of profile data.
 *
 * Priority (per the challenge spec):
 *   1. Structured network / API payloads observed during navigation.
 *   2. Embedded structured JSON in the page HTML.
 *   3. DOM extraction (visible-page fallback).
 *
 * All LinkedIn-specific knowledge (field names, URN shapes, Voyager string
 * wrappers) is contained in THIS file so it can be updated independently when
 * LinkedIn changes. The parser and public schema never see it.
 *
 * NOTE: field mapping is defensive on purpose — LinkedIn's internal JSON shape
 * changes frequently and varies by profile. `scripts/linkedin-inspect.ts` is
 * used during development to observe the real payloads and refine the mappers
 * below. Nothing here is guessed-and-presented-as-authoritative: every mapped
 * value is read from data actually observed in the page/network.
 */

import type { Page } from 'playwright';
import type {
  RawLinkedInProfile,
  RawIdentity,
  RawLocation,
  RawImage,
  RawDate,
  RawTimePeriod,
  RawExperience,
  RawEducation,
  RawSkill,
  RawCertification,
  RawLanguage,
  RawCourse,
  RawProject,
  RawVolunteer,
  RawAward,
  RawPublication,
  RawPatent,
  RawOrganization,
  RawInterest,
  RawRecommendation,
} from './types.js';

// ---------------------------------------------------------------------------
// Generic coercion helpers (Voyager wraps many primitives)
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === 'string') {
    const t = value.trim();
    return t.length > 0 ? t : null;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (isRecord(value)) {
    // com.linkedin.voyager.common.Text -> { "text": "..." }
    const t = value['text'];
    if (typeof t === 'string' && t.trim()) return t.trim();
    // Localized strings -> { "localized": { "en_US": "..." } }
    const localized = value['localized'];
    if (isRecord(localized)) {
      for (const v of Object.values(localized)) {
        if (typeof v === 'string' && v.trim()) return v.trim();
      }
    }
  }
  return null;
}

function num(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function bool(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  return null;
}

function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (isRecord(value)) {
    // Voyager paging wrappers
    if (Array.isArray(value['*elements'])) return value['*elements'] as unknown[];
    if (Array.isArray(value['elements'])) return value['elements'] as unknown[];
    if (Array.isArray(value['*paging'])) return value['*paging'] as unknown[];
  }
  return [];
}

/**
 * Read a field from an entity, trying the key directly and then nested under
 * common profile wrappers (`profile`, `*profile`).
 */
function field(entity: Record<string, unknown>, ...names: string[]): unknown {
  for (const name of names) {
    if (name in entity) return entity[name];
    for (const wrapper of ['profile', '*profile', 'profileData']) {
      const sub = entity[wrapper];
      if (isRecord(sub) && name in sub) return sub[name];
    }
  }
  return undefined;
}

function arrayField(entity: Record<string, unknown>, ...names: string[]): unknown[] {
  for (const name of names) {
    const raw = field(entity, name);
    const arr = asArray(raw);
    if (arr.length > 0) return arr;
  }
  return [];
}

function mapDate(value: unknown): RawDate | null {
  if (!isRecord(value)) return null;
  const year = num(value['year']);
  if (year == null) return null;
  return {
    year,
    month: num(value['month']),
    day: num(value['day']),
  };
}

function mapTimePeriod(value: unknown): RawTimePeriod | null {
  if (!isRecord(value)) return null;
  const start = mapDate(value['startDate']);
  const end = mapDate(value['endDate']);
  if (start == null && end == null) return null;
  return { startDate: start, endDate: end };
}

function urnOf(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (isRecord(value)) {
    const urn = value['entityUrn'];
    if (typeof urn === 'string') return urn;
  }
  return null;
}

function urlOf(value: unknown): string | null {
  const t = text(value);
  if (t == null) return null;
  return /^https?:\/\//i.test(t) ? t : null;
}

// ---------------------------------------------------------------------------
// Embedded JSON discovery
// ---------------------------------------------------------------------------

/**
 * Extract every embedded JSON document from the page. LinkedIn embeds profile
 * payloads in `<code>` blocks (often wrapped in HTML comments) and
 * `<script type="application/json">` tags.
 */
export async function extractEmbeddedJson(page: Page): Promise<unknown[]> {
  return page.evaluate(() => {
    const results: unknown[] = [];
    const push = (raw: string | null | undefined) => {
      if (!raw) return;
      let candidate = raw.trim();
      // Strip leading/trailing HTML comment markers.
      candidate = candidate.replace(/^<!--/, '').replace(/-->$/, '').trim();
      if (!candidate) return;
      try {
        results.push(JSON.parse(candidate));
      } catch {
        /* not JSON */
      }
    };

    document.querySelectorAll('code').forEach((el) => push(el.textContent));
    document
      .querySelectorAll('script[type="application/json"], script[type="application/ld+json"]')
      .forEach((el) => push(el.textContent));
    return results;
  });
}

const PROFILE_KEYS = [
  'firstName',
  'lastName',
  'headline',
  'summary',
  'occupation',
  'experience',
  'education',
  'skills',
  'certifications',
  'languages',
  'geoLocationName',
  'profilePicture',
  'publicIdentifier',
  'entityUrn',
] as const;

function collectObjects(node: unknown, out: Record<string, unknown>[], depth = 0): void {
  if (depth > 14 || node == null) return;
  if (Array.isArray(node)) {
    for (const v of node) collectObjects(v, out, depth + 1);
    return;
  }
  if (isRecord(node)) {
    out.push(node);
    for (const v of Object.values(node)) collectObjects(v, out, depth + 1);
  }
}

function scoreProfileObject(obj: Record<string, unknown>): number {
  const keys = new Set(Object.keys(obj));
  return PROFILE_KEYS.filter((k) => keys.has(k)).length;
}

function isProfileUrn(urn: string | null): boolean {
  return urn != null && /(fsd_profile|:profile:)/.test(urn);
}

/**
 * Locate the object inside a JSON blob that represents the target profile.
 * Uses a scoring heuristic over known profile keys plus URN/vanity matching, so
 * it is resilient to LinkedIn wrapping the profile at arbitrary depth.
 */
function findProfileEntity(blob: unknown, vanityName: string): Record<string, unknown> | null {
  const objects: Record<string, unknown>[] = [];
  collectObjects(blob, objects);

  const vanity = vanityName.toLowerCase();
  let best: Record<string, unknown> | null = null;
  let bestScore = 0;

  for (const obj of objects) {
    const urn = urnOf(obj['entityUrn']);
    if (isProfileUrn(urn)) {
      return obj; // explicit profile urn — strongest signal
    }
    const pid = text(obj['publicIdentifier']);
    if (pid && pid.toLowerCase() === vanity) {
      return obj;
    }
    const score = scoreProfileObject(obj);
    if (score > bestScore) {
      bestScore = score;
      best = obj;
    }
  }

  return bestScore >= 2 ? best : null;
}

// ---------------------------------------------------------------------------
// JSON -> raw profile mapping
// ---------------------------------------------------------------------------

function mapImageFromEntity(value: unknown): RawImage | null {
  if (!isRecord(value)) return null;
  // Direct URL fields first (some payloads carry a ready URL).
  const url =
    urlOf(value['url']) ??
    urlOf(value['pictureUrl']) ??
    urlOf(value['profilePictureUrl']) ??
    urlOf(value['displayImageReference']) ??
    null;
  const dims = value['width'] ?? value['height'] ?? null;
  if (url == null && dims == null) return null;
  return {
    url,
    width: num(value['width']),
    height: num(value['height']),
    alt: text(value['alt']),
  };
}

function mapExperience(items: unknown[]): RawExperience[] {
  return items
    .map((item): RawExperience | null => {
      if (!isRecord(item)) return null;
      const companyRaw = field(item, 'company', 'companyName');
      const company =
        text(companyRaw) ?? (isRecord(companyRaw) ? text(companyRaw['name']) : null);
      if (company == null && text(field(item, 'title')) == null) return null;
      return {
        title: text(field(item, 'title', 'position')),
        company,
        companyUrn: urnOf(field(item, 'companyUrn', 'company') ?? (isRecord(companyRaw) ? companyRaw['entityUrn'] : null)),
        companyUrl: urlOf(field(item, 'companyUrl')),
        companyLogo: urlOf(field(item, 'logoUrl', 'companyLogo')),
        employmentType: text(field(item, 'employmentType')),
        location: text(field(item, 'locationName', 'location')),
        description: text(field(item, 'description')),
        timePeriod: mapTimePeriod(field(item, 'timePeriod')),
      };
    })
    .filter((e): e is RawExperience => e != null);
}

function mapEducation(items: unknown[]): RawEducation[] {
  return items
    .map((item): RawEducation | null => {
      if (!isRecord(item)) return null;
      const schoolRaw = field(item, 'school', 'schoolName');
      const school =
        text(schoolRaw) ?? (isRecord(schoolRaw) ? text(schoolRaw['name']) : null);
      if (school == null) return null;
      return {
        school,
        schoolUrn: urnOf(field(item, 'schoolUrn') ?? (isRecord(schoolRaw) ? schoolRaw['entityUrn'] : null)),
        schoolUrl: urlOf(field(item, 'schoolUrl')),
        schoolLogo: urlOf(field(item, 'logoUrl', 'schoolLogo')),
        degree: text(field(item, 'degreeName', 'degree')),
        fieldOfStudy: text(field(item, 'fieldOfStudy')),
        description: text(field(item, 'description')),
        timePeriod: mapTimePeriod(field(item, 'timePeriod')),
        grade: text(field(item, 'grade')),
        activities: text(field(item, 'activities')),
      };
    })
    .filter((e): e is RawEducation => e != null);
}

function mapSkills(items: unknown[]): RawSkill[] {
  return items
    .map((item): RawSkill | null => {
      if (!isRecord(item)) return null;
      const name = text(field(item, 'name', 'title'));
      if (name == null) return null;
      const endorsements = field(item, 'endorsementCount', 'endorsements');
      const count =
        num(endorsements) ?? (isRecord(endorsements) ? num(endorsements['total']) : null);
      return {
        name,
        endorsementCount: count,
        category: text(field(item, 'category')),
        url: urlOf(field(item, 'url', 'targetUrl')),
      };
    })
    .filter((s): s is RawSkill => s != null);
}

function mapCertifications(items: unknown[]): RawCertification[] {
  return items
    .map((item): RawCertification | null => {
      if (!isRecord(item)) return null;
      const name = text(field(item, 'name', 'title'));
      if (name == null) return null;
      const authority = field(item, 'authority', 'issuer', 'companyName');
      return {
        name,
        issuer: text(authority) ?? (isRecord(authority) ? text(authority['name']) : null),
        issuerUrn: urnOf(isRecord(authority) ? authority['entityUrn'] : authority),
        issuerUrl: urlOf(field(item, 'authorityUrl', 'issuerUrl')),
        issuerLogo: urlOf(field(item, 'logoUrl', 'issuerLogo')),
        issueDate: mapDate(field(item, 'timePeriod') ? (field(item, 'timePeriod') as Record<string, unknown>)['startDate'] : field(item, 'issueDate')),
        expirationDate: mapDate(field(item, 'timePeriod') ? (field(item, 'timePeriod') as Record<string, unknown>)['endDate'] : field(item, 'expirationDate')),
        credentialId: text(field(item, 'credentialId', 'number')),
        credentialUrl: urlOf(field(item, 'credentialUrl', 'url')),
        description: text(field(item, 'description')),
      };
    })
    .filter((c): c is RawCertification => c != null);
}

function mapLanguages(items: unknown[]): RawLanguage[] {
  return items
    .map((item): RawLanguage | null => {
      if (!isRecord(item)) return null;
      const name = text(field(item, 'name', 'language'));
      if (name == null) return null;
      return { name, proficiency: text(field(item, 'proficiency')) };
    })
    .filter((l): l is RawLanguage => l != null);
}

function mapCourses(items: unknown[]): RawCourse[] {
  return items
    .map((item): RawCourse | null => {
      if (!isRecord(item)) return null;
      const name = text(field(item, 'name', 'title'));
      if (name == null) return null;
      return {
        name,
        number: text(field(item, 'number')),
        description: text(field(item, 'description')),
        associatedWith: text(field(item, 'associatedWith', 'occupation')),
      };
    })
    .filter((c): c is RawCourse => c != null);
}

function mapProjects(items: unknown[]): RawProject[] {
  return items
    .map((item): RawProject | null => {
      if (!isRecord(item)) return null;
      const name = text(field(item, 'title', 'name'));
      if (name == null) return null;
      return {
        name,
        description: text(field(item, 'description')),
        url: urlOf(field(item, 'url', 'targetUrl')),
        timePeriod: mapTimePeriod(field(item, 'timePeriod')),
        associatedWith: text(field(item, 'associatedWith', 'occupation')),
      };
    })
    .filter((p): p is RawProject => p != null);
}

function mapVolunteer(items: unknown[]): RawVolunteer[] {
  return items
    .map((item): RawVolunteer | null => {
      if (!isRecord(item)) return null;
      const orgRaw = field(item, 'companyName', 'organization');
      return {
        role: text(field(item, 'role', 'title')),
        organization: text(orgRaw) ?? (isRecord(orgRaw) ? text(orgRaw['name']) : null),
        organizationUrn: urnOf(isRecord(orgRaw) ? orgRaw['entityUrn'] : orgRaw),
        organizationUrl: urlOf(field(item, 'organizationUrl')),
        organizationLogo: urlOf(field(item, 'logoUrl')),
        cause: text(field(item, 'cause')),
        location: text(field(item, 'locationName', 'location')),
        description: text(field(item, 'description')),
        timePeriod: mapTimePeriod(field(item, 'timePeriod')),
      };
    })
    .filter((v): v is RawVolunteer => v != null);
}

function mapAwards(items: unknown[]): RawAward[] {
  return items
    .map((item): RawAward | null => {
      if (!isRecord(item)) return null;
      const title = text(field(item, 'title', 'name'));
      if (title == null) return null;
      return {
        title,
        issuer: text(field(item, 'issuer', 'authority')),
        issueDate: mapDate(field(item, 'issueDate', 'date')),
        description: text(field(item, 'description')),
      };
    })
    .filter((a): a is RawAward => a != null);
}

function mapPublications(items: unknown[]): RawPublication[] {
  return items
    .map((item): RawPublication | null => {
      if (!isRecord(item)) return null;
      const title = text(field(item, 'name', 'title'));
      if (title == null) return null;
      return {
        title,
        publisher: text(field(item, 'publisher')),
        publicationDate: mapDate(field(item, 'date', 'publicationDate')),
        description: text(field(item, 'description')),
        url: urlOf(field(item, 'url', 'targetUrl')),
      };
    })
    .filter((p): p is RawPublication => p != null);
}

function mapPatents(items: unknown[]): RawPatent[] {
  return items
    .map((item): RawPatent | null => {
      if (!isRecord(item)) return null;
      const title = text(field(item, 'title', 'name'));
      if (title == null) return null;
      const inventors = asArray(field(item, 'inventors'))
        .map(text)
        .filter((i): i is string => i != null);
      return {
        title,
        patentNumber: text(field(item, 'number', 'patentNumber')),
        status: text(field(item, 'status')),
        issueDate: mapDate(field(item, 'issueDate', 'date')),
        inventors,
        description: text(field(item, 'description')),
        url: urlOf(field(item, 'url', 'targetUrl')),
      };
    })
    .filter((p): p is RawPatent => p != null);
}

function mapOrganizations(items: unknown[]): RawOrganization[] {
  return items
    .map((item): RawOrganization | null => {
      if (!isRecord(item)) return null;
      const name = text(field(item, 'name', 'title'));
      if (name == null) return null;
      return {
        name,
        role: text(field(item, 'role', 'position')),
        description: text(field(item, 'description')),
        timePeriod: mapTimePeriod(field(item, 'timePeriod')),
        url: urlOf(field(item, 'url', 'targetUrl')),
      };
    })
    .filter((o): o is RawOrganization => o != null);
}

function mapInterests(items: unknown[]): RawInterest[] {
  return items
    .map((item): RawInterest | null => {
      if (!isRecord(item)) return null;
      const name = text(field(item, 'name', 'title'));
      if (name == null) return null;
      return {
        name,
        url: urlOf(field(item, 'url', 'targetUrl')),
        image: urlOf(field(item, 'image', 'logoUrl')),
      };
    })
    .filter((i): i is RawInterest => i != null);
}

function mapRecommendations(items: unknown[]): RawRecommendation[] {
  return items
    .map((item): RawRecommendation | null => {
      if (!isRecord(item)) return null;
      const recommender = field(item, 'recommender', 'author');
      return {
        text: text(field(item, 'text', 'content', 'recommendationBody')),
        recommenderName:
          text(field(item, 'recommenderName')) ??
          (isRecord(recommender) ? text(recommender['firstName']) + ' ' + (text(recommender['lastName']) ?? '') : null),
        recommenderHeadline: text(field(item, 'recommenderHeadline')) ?? (isRecord(recommender) ? text(recommender['headline']) : null),
        recommenderUrl: urlOf(field(item, 'recommenderUrl')) ?? (isRecord(recommender) ? urlOf(recommender['publicIdentifier']) : null),
        recommenderImage: urlOf(field(item, 'recommenderImage')),
        relationship: text(field(item, 'relationship')),
        date: text(field(item, 'date', 'createdAt')),
      };
    })
    .filter((r): r is RawRecommendation => r != null);
}

function emptyRaw(vanityName: string): RawLinkedInProfile {
  const identity: RawIdentity = {
    firstName: null,
    lastName: null,
    middleName: null,
    maidenName: null,
    fullName: null,
    headline: null,
    pronouns: null,
    publicIdentifier: vanityName,
    profileUrl: `https://www.linkedin.com/in/${vanityName}/`,
    vanityName,
  };
  const emptyLocation: RawLocation = {
    raw: null,
    city: null,
    state: null,
    country: null,
    countryCode: null,
    postalCode: null,
  };
  return {
    entityUrn: null,
    identity,
    location: emptyLocation,
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
}

/**
 * Map an observed JSON blob (network or embedded) into a raw profile. Returns
 * `null` when the blob does not contain a recognizable profile.
 */
export function rawFromJson(blob: unknown, vanityName: string): RawLinkedInProfile | null {
  const entity = findProfileEntity(blob, vanityName);
  if (!entity) return null;

  const raw = emptyRaw(vanityName);
  raw.entityUrn = urnOf(entity['entityUrn']);

  raw.identity.firstName = text(field(entity, 'firstName'));
  raw.identity.lastName = text(field(entity, 'lastName'));
  raw.identity.middleName = text(field(entity, 'middleName'));
  raw.identity.maidenName = text(field(entity, 'maidenName'));
  raw.identity.fullName = text(field(entity, 'fullName', 'name'));
  raw.identity.headline = text(field(entity, 'headline', 'occupation'));
  raw.identity.pronouns = text(field(entity, 'pronouns'));
  raw.identity.publicIdentifier =
    text(field(entity, 'publicIdentifier', 'vanityName')) ?? vanityName;
  raw.identity.vanityName =
    text(field(entity, 'vanityName', 'publicIdentifier')) ?? vanityName;

  const geo = field(entity, 'geoLocationName', 'locationName', 'geo');
  raw.location.raw = text(geo);
  if (isRecord(geo)) {
    raw.location.country = text(geo['country']) ?? text(geo['countryName']);
    raw.location.countryCode = text(geo['countryCode']);
    raw.location.city = text(geo['city']);
    raw.location.state = text(geo['state']);
    raw.location.postalCode = text(geo['postalCode']);
  } else {
    raw.location.country = text(field(entity, 'geoCountryName', 'country'));
  }

  raw.about = text(field(entity, 'summary', 'about'));

  raw.profilePicture = mapImageFromEntity(field(entity, 'profilePicture', 'profileImage'));
  raw.backgroundPicture = mapImageFromEntity(field(entity, 'backgroundPicture', 'backgroundImage'));

  raw.experience = mapExperience(arrayField(entity, 'experience', 'positions'));
  raw.education = mapEducation(arrayField(entity, 'education', 'schools'));
  raw.skills = mapSkills(arrayField(entity, 'skills'));
  raw.certifications = mapCertifications(arrayField(entity, 'certifications'));
  raw.languages = mapLanguages(arrayField(entity, 'languages'));
  raw.courses = mapCourses(arrayField(entity, 'courses'));
  raw.projects = mapProjects(arrayField(entity, 'projects'));
  raw.volunteerExperience = mapVolunteer(arrayField(entity, 'volunteerExperience', 'volunteer'));
  raw.awards = mapAwards(arrayField(entity, 'honors', 'awards'));
  raw.publications = mapPublications(arrayField(entity, 'publications'));
  raw.patents = mapPatents(arrayField(entity, 'patents'));
  raw.organizations = mapOrganizations(arrayField(entity, 'organizations'));
  raw.interests = mapInterests(arrayField(entity, 'interests'));
  raw.recommendations = mapRecommendations(arrayField(entity, 'recommendations'));

  raw.connectionsCount = num(field(entity, 'connectionCount', 'connectionsCount'));
  raw.followersCount = num(field(entity, 'followerCount', 'followersCount'));
  raw.openToWork = bool(field(entity, 'openToWork'));
  raw.hiring = bool(field(entity, 'hiring'));

  return raw;
}

// ---------------------------------------------------------------------------
// DOM fallback
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// DOM extraction (primary strategy for the current SDUI/RSC LinkedIn frontend)
// ---------------------------------------------------------------------------

const SECTION_HEADER_RE = /^(experience|education|licenses?\s*(?:&|and)?\s*certifications?|certifications?|skills|languages|projects|volunteer\s*experience|volunteering|honors?\s*(?:&|and)?\s*awards?|publications|patents|organizations|interests|recommendations|courses|featured|activity|analytics|more\s*profiles\s*for\s*you|people\s*you\s*may\s*know|others\s*also\s*viewed|advertisements?)(?:\s*\(\d+\))?$/i;

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

function parseDate(s: string): RawDate | null {
  const ym = s.match(/\b(19|20)\d{2}\b/);
  if (!ym) return null;
  const mm = s.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/i);
  return {
    year: Number(ym[0]),
    month: mm ? (MONTHS[mm[1]?.toLowerCase().slice(0, 3) ?? ''] ?? null) : null,
    day: null,
  };
}

function parseDateRange(line: string): RawTimePeriod {
  const parts = line.split(/\s*[-–—]\s*/);
  const endRaw = parts[1] ?? '';
  return {
    startDate: parseDate(parts[0] ?? ''),
    endDate: /present|current/i.test(endRaw) ? null : parseDate(endRaw),
  };
}

function parseCount(line: string): number | null {
  const m = /([\d,.]+)\s*[KkMm]?\+?/.exec(line.replace(/[,.]/g, ''));
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

// The page footer also contains an "About" link; it's always followed by one of
// these footer links, unlike the profile's own "About" section header.
const FOOTER_ABOUT_NEXT = /^(accessibility|talent solutions|community guidelines|careers|marketing solutions|privacy & terms|ad choices|advertising sales solutions|mobile|small business|safety center|linkedin corporation|©|select language)$/i;

/** Index of the profile's "About" section header (skips the footer "About"). */
function findAboutIndex(lines: string[]): number {
  for (let i = 0; i < lines.length; i++) {
    if (!/^about$/i.test(lines[i] ?? '')) continue;
    if (FOOTER_ABOUT_NEXT.test(lines[i + 1] ?? '')) continue;
    return i;
  }
  return -1;
}

/**
 * Parse the rendered `innerText` of a profile into raw fields. Pure and
 * unit-testable. Works against LinkedIn's current hashed-class DOM by relying
 * on visible text + section headers rather than CSS selectors.
 */
export function parseProfileText(text: string, title: string): Partial<RawLinkedInProfile> {
  const cleanTitle = title.replace(/\s*\|\s*LinkedIn\s*$/i, '').trim();
  const nameParts = cleanTitle.split(/\s+/).filter(Boolean);
  const firstName = nameParts[0] ?? null;
  const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : null;

  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const pronounRe = /^(he\/him|she\/her|they\/them|he\/his|she\/hers|they\/theirs?)$/i;
  const pronouns = lines.find((l) => pronounRe.test(l)) ?? null;

  let followersCount: number | null = null;
  let connectionsCount: number | null = null;
  // Counts live in the top card only — stop at the first content section so we
  // don't pick up "X followers" mentions from the activity feed.
  const countEnd = lines.findIndex((l) => /^(about|featured|activity|experience|education)$/i.test(l));
  const countLimit = countEnd > 0 ? countEnd : Math.min(60, lines.length);
  for (let i = 0; i < countLimit; i++) {
    const l = lines[i] ?? '';
    if (/followers?/i.test(l)) followersCount = parseCount(l);
    // LinkedIn often renders "500+" and "connections" on separate lines.
    if (/^connections?$/i.test(l)) {
      connectionsCount = parseCount(lines[i - 1] ?? '') ?? parseCount(l);
    } else if (/connections?/i.test(l)) {
      connectionsCount = parseCount(l);
    }
  }

  // Location: a "City, Region, Country"-shaped line just above "Contact info".
  let location: string | null = null;
  const ci = lines.findIndex((l) => /^contact info$/i.test(l));
  if (ci > 0) {
    for (let i = ci - 1; i >= Math.max(0, ci - 5); i--) {
      const l = lines[i] ?? '';
      if (l && l !== '·' && /,/.test(l) && !/\d/.test(l) && !/follow|connect|message|profile/i.test(l)) {
        location = l;
        break;
      }
    }
  }

  // Headline: longest substantial line in the top card (before "About").
  let headline: string | null = null;
  const aboutIdx = findAboutIndex(lines);
  const topEnd = aboutIdx > 0 ? aboutIdx : Math.min(80, lines.length);
  const skipRe = /^(home|my network|jobs|messaging|me|for business|notifications|skip to|message|follow|·|contact info|featured|activity)$/i;
  let bestLen = 0;
  for (let i = 0; i < topEnd; i++) {
    const l = lines[i] ?? '';
    if (l === cleanTitle || l === location || l === pronouns || skipRe.test(l)) continue;
    if (l.length > bestLen && l.length > 15) {
      bestLen = l.length;
      headline = l;
    }
  }

  // About: text between the "About" header and the next section header.
  let about: string | null = null;
  if (aboutIdx >= 0) {
    const after = lines.slice(aboutIdx + 1);
    const next = after.findIndex((l) => SECTION_HEADER_RE.test(l));
    const aboutLines = next >= 0 ? after.slice(0, next) : after.slice(0, 30);
    about = aboutLines.join(' ').trim() || null;
  }

  // Profile content ends at the "More profiles for you" / "People you may know" /
  // footer region; section headers beyond it belong to other cards, not this profile.
  const contentEnd = lines.findIndex((l) =>
    /^(more\s*profiles\s*for\s*you|people\s*you\s*may\s*know|others\s*also\s*viewed|analytics|advertisements?)$/i.test(l),
  );
  const contentLimit = contentEnd >= 0 ? contentEnd : lines.length;

  // Locate section header line indices, normalized ("Projects (3)" → "projects").
  const headerIdx = new Map<string, number>();
  lines.forEach((l, i) => {
    if (i >= contentLimit) return;
    if (SECTION_HEADER_RE.test(l)) {
      const key = l.replace(/\s*\(\d+\)\s*$/, '').toLowerCase();
      if (!headerIdx.has(key)) headerIdx.set(key, i);
    }
  });

  function sectionLines(name: string): string[] {
    const i = headerIdx.get(name.toLowerCase());
    if (i === undefined) return [];
    const after = lines.slice(i + 1, contentLimit);
    const next = after.findIndex((l) => SECTION_HEADER_RE.test(l));
    return next >= 0 ? after.slice(0, next) : after;
  }

  const skills = sectionLines('Skills')
    .filter((l) => !/^(show all|show more|see all|show less)$/i.test(l))
    // Skill cards render the name followed by an "associated role" line
    // ("Senior SRE ... at Fravity AI"); drop those so only names remain.
    .filter((l) => !/\s+at\s+/i.test(l))
    .map((l) => ({ name: l, endorsementCount: null, category: null, url: null }));

  const languages = sectionLines('Languages').map((l) => {
    const [name, ...rest] = l.split(/\s+[-–—]\s+/);
    return { name: (name ?? '').trim() || l, proficiency: rest.join(' ').trim() || null };
  });

  // Experience: an item is recorded only when the unambiguous
  // "Title / Company · Type / Date range" triad appears in order.
  const experience: RawExperience[] = [];
  {
    const xs = sectionLines('Experience').filter((l) => !/^(show all|show more|see all)$/i.test(l));
    const emptyExperience = (): RawExperience => ({
      title: null,
      company: null,
      companyUrn: null,
      companyUrl: null,
      companyLogo: null,
      employmentType: null,
      location: null,
      description: null,
      timePeriod: null,
    });
    for (let i = 0; i < xs.length; i++) {
      const l = xs[i] ?? '';
      const isCompany = l.includes('·') && !/\b(19|20)\d{2}\b/.test(l);
      const next = xs[i + 1] ?? '';
      const nextIsDate = /\b(19|20)\d{2}\b/.test(next) && /(present|current|[-–])/i.test(next);
      if (isCompany && nextIsDate) {
        const title = xs[i - 1] ?? null;
        if (title) experience.push({ ...emptyExperience(), title, company: l, timePeriod: parseDateRange(next) });
      }
    }
  }

  // Education: school / degree / date range / grade quartets.
  const education: RawEducation[] = [];
  {
    const es = sectionLines('Education');
    for (let i = 0; i < es.length; i++) {
      const l = es[i] ?? '';
      const isDates = /\b(19|20)\d{2}\b/.test(l) && /[-–—]/.test(l);
      if (!isDates) continue;
      const degree = es[i - 1] ?? null;
      const school = es[i - 2] ?? null;
      const gradeLine = es[i + 1] ?? '';
      const grade = /^grade\s*:/i.test(gradeLine) ? (gradeLine.replace(/^grade\s*:\s*/i, '').trim() || null) : null;
      if (school) {
        education.push({
          school,
          schoolUrn: null,
          schoolUrl: null,
          schoolLogo: null,
          degree,
          fieldOfStudy: null,
          description: null,
          timePeriod: parseDateRange(l),
          grade,
          activities: null,
        });
      }
    }
  }

  // Projects: name line followed by an optional "Name - description" line.
  const projects: RawProject[] = [];
  {
    const ps = sectionLines('Projects');
    let pending: string | null = null;
    const flush = (name: string | null, description: string | null) => {
      if (name) projects.push({ name, description, url: null, timePeriod: null, associatedWith: null });
    };
    for (const l of ps) {
      if (/^(show all|show more|see all|show less)$/i.test(l)) continue;
      if (l.includes(' - ')) {
        const desc = pending && l.startsWith(`${pending} - `) ? l.slice(pending.length + 3) : l;
        flush(pending, desc || null);
        pending = null;
      } else {
        if (pending) flush(pending, null);
        pending = l;
      }
    }
    flush(pending, null);
  }

  return {
    identity: {
      firstName,
      lastName,
      middleName: null,
      maidenName: null,
      fullName: cleanTitle || null,
      headline,
      pronouns,
      publicIdentifier: null,
      profileUrl: null,
      vanityName: null,
    },
    location: { raw: location, city: null, state: null, country: null, countryCode: null, postalCode: null },
    about,
    skills,
    languages,
    experience,
    education,
    projects,
    connectionsCount,
    followersCount,
  };
}

/**
 * Comprehensive DOM extraction — the primary source for the current LinkedIn
 * frontend, which renders the profile server-side into a hashed-class DOM
 * (no reliable CSS selectors, no embedded JSON). Pulls the name from <title>,
 * images from <img>/<link preload>, and the rest from parsed innerText.
 */
export async function rawFromDom(page: Page, vanityName: string): Promise<RawLinkedInProfile> {
  const raw = emptyRaw(vanityName);

  const dom = await page.evaluate(() => {
    function pickImg(re: RegExp): { url: string | null; width: number | null; height: number | null; alt: string | null } | null {
      const images = Array.from(document.images);
      const matches = images.filter((i) => re.test(i.currentSrc || i.src) || re.test(i.src));
      if (matches.length === 0) return null;
      // Prefer the largest loaded render (the top-card photo) over nav thumbnails.
      matches.sort((a, b) => (b.naturalWidth || 0) - (a.naturalWidth || 0));
      const el = matches[0]!;
      return {
        url: el.currentSrc || el.src || null,
        width: el.naturalWidth || null,
        height: el.naturalHeight || null,
        alt: el.alt || null,
      };
    }

    let background = pickImg(/profile-displaybackgroundimage|profile-background/i);
    if (!background) {
      const preload = document.querySelector('link[rel="preload"][as="image"]');
      const srcset = preload && preload.getAttribute('imagesrcset');
      if (srcset && /background/i.test(srcset)) {
        const first = srcset.split(',')[0]?.trim().split(/\s+/)[0];
        if (first) background = { url: first, width: null, height: null, alt: null };
      }
    }

    return {
      title: document.title,
      profilePicture: pickImg(/profile-(displayphoto|framedphoto|photo)/i),
      backgroundPicture: background,
      text: document.body ? document.body.innerText : '',
    };
  });

  const parsed = parseProfileText(dom.text, dom.title);

  raw.identity = {
    ...raw.identity,
    ...parsed.identity,
    // URL-derived identity fields are known at the client, not from page text.
    publicIdentifier: vanityName,
    profileUrl: `https://www.linkedin.com/in/${vanityName}/`,
    vanityName,
  };
  raw.location = { ...raw.location, ...parsed.location };
  raw.about = parsed.about ?? null;
  raw.skills = parsed.skills ?? [];
  raw.languages = parsed.languages ?? [];
  raw.experience = parsed.experience ?? [];
  raw.education = parsed.education ?? [];
  raw.projects = parsed.projects ?? [];
  raw.connectionsCount = parsed.connectionsCount ?? null;
  raw.followersCount = parsed.followersCount ?? null;
  raw.profilePicture = dom.profilePicture;
  raw.backgroundPicture = dom.backgroundPicture;

  return raw;
}
