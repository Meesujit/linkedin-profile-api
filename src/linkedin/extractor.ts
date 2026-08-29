/**
 * LinkedIn extractor — maps raw LinkedIn JSON into the internal raw model.
 *
 * All LinkedIn-specific knowledge (field names, URN shapes, Voyager string
 * wrappers) is contained in THIS file so it can be updated independently when
 * LinkedIn changes. The parser and public schema never see it.
 *
 * NOTE: field mapping is defensive on purpose — LinkedIn's internal JSON shape
 * changes frequently and varies by profile. `scripts/linkedin-inspect.ts` is
 * used during development to observe the real payloads and refine the mappers
 * below. Nothing here is guessed-and-presented-as-authoritative: every mapped
 * value is read from data actually observed.
 */

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
