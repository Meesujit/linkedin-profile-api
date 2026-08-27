/**
 * LinkedIn parser — the single translation point between LinkedIn's raw data
 * model (`types.ts`) and the stable public API schema (`schemas/profile.schema.ts`).
 *
 * Rules:
 *   - Never fabricate. Missing values become `null` or `[]`.
 *   - Whitespace is collapsed and trimmed.
 *   - Dates are normalized to ISO-ish strings (`YYYY`, `YYYY-MM`, `YYYY-MM-DD`).
 *   - `is_current` is derived from an absent end date (LinkedIn's convention).
 *
 * LinkedIn-side changes are absorbed here so the public API never breaks.
 */

import type {
  RawLinkedInProfile,
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
import type {
  NormalizedProfile,
  NormalizedImage,
  NormalizedExperience,
  NormalizedEducation,
} from '../schemas/profile.schema.js';

export interface ParsedProfile {
  profile: NormalizedProfile;
  sectionsAvailable: string[];
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function cleanString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/\s+/g, ' ').trim();
  return cleaned.length > 0 ? cleaned : null;
}

function toInt(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.round(value);
}

function toBool(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function formatRawDate(date: RawDate | null | undefined): string | null {
  if (!date || date.year == null) return null;
  const year = String(date.year).padStart(4, '0');
  if (date.month == null) return year;
  const month = String(date.month).padStart(2, '0');
  if (date.day == null) return `${year}-${month}`;
  return `${year}-${month}-${String(date.day).padStart(2, '0')}`;
}

/** Extract the numeric/id suffix from an entity URN like `urn:li:fsd_company:123`. */
function urnId(urn: string | null | undefined): string | null {
  if (typeof urn !== 'string' || urn.length === 0) return null;
  const parts = urn.split(':');
  const last = parts[parts.length - 1];
  return last && last.length > 0 ? last : null;
}

function computeDuration(timePeriod: RawTimePeriod | null | undefined): string | null {
  if (!timePeriod) return null;
  const start = timePeriod.startDate;
  const end = timePeriod.endDate;
  if (!start || start.year == null || !end || end.year == null) return null;

  const startMonths = start.year * 12 + (start.month ?? 0);
  const endMonths = end.year * 12 + (end.month ?? 0);
  const total = endMonths - startMonths;
  if (total < 0) return null;

  const years = Math.floor(total / 12);
  const months = total % 12;
  const parts: string[] = [];
  if (years > 0) parts.push(`${years} yr${years > 1 ? 's' : ''}`);
  if (months > 0) parts.push(`${months} mo${months > 1 ? 's' : ''}`);
  return parts.length > 0 ? parts.join(' ') : null;
}

function normalizeImage(image: RawImage | null | undefined): NormalizedImage {
  return {
    url: cleanString(image?.url),
    width: toInt(image?.width),
    height: toInt(image?.height),
    alt: cleanString(image?.alt),
  };
}

function isCurrent(timePeriod: RawTimePeriod | null | undefined): boolean {
  return (
    timePeriod != null &&
    timePeriod.startDate != null &&
    timePeriod.startDate.year != null &&
    timePeriod.endDate == null
  );
}

function startDateOf(timePeriod: RawTimePeriod | null | undefined): string | null {
  return formatRawDate(timePeriod?.startDate);
}

function endDateOf(timePeriod: RawTimePeriod | null | undefined): string | null {
  return formatRawDate(timePeriod?.endDate);
}

function joinName(parts: (string | null)[]): string | null {
  const joined = parts.filter((p): p is string => p != null).join(' ');
  return joined.length > 0 ? joined : null;
}

// ---------------------------------------------------------------------------
// Section mappers
// ---------------------------------------------------------------------------

function mapExperience(items: RawExperience[]): NormalizedExperience[] {
  return items.map((item) => ({
    id: null,
    title: cleanString(item.title),
    company: cleanString(item.company),
    company_id: urnId(item.companyUrn),
    company_url: cleanString(item.companyUrl),
    company_logo: cleanString(item.companyLogo),
    employment_type: cleanString(item.employmentType),
    location: cleanString(item.location),
    description: cleanString(item.description),
    start_date: startDateOf(item.timePeriod),
    end_date: endDateOf(item.timePeriod),
    is_current: isCurrent(item.timePeriod),
    duration: computeDuration(item.timePeriod),
  }));
}

function mapEducation(items: RawEducation[]): NormalizedEducation[] {
  return items.map((item) => ({
    id: null,
    school: cleanString(item.school),
    school_id: urnId(item.schoolUrn),
    school_url: cleanString(item.schoolUrl),
    school_logo: cleanString(item.schoolLogo),
    degree: cleanString(item.degree),
    field_of_study: cleanString(item.fieldOfStudy),
    description: cleanString(item.description),
    start_date: startDateOf(item.timePeriod),
    end_date: endDateOf(item.timePeriod),
    grade: cleanString(item.grade),
    activities: cleanString(item.activities),
  }));
}

function mapSkills(items: RawSkill[]) {
  return items.map((item) => ({
    name: cleanString(item.name),
    endorsement_count: toInt(item.endorsementCount),
    category: cleanString(item.category),
    url: cleanString(item.url),
  }));
}

function mapCertifications(items: RawCertification[]) {
  return items.map((item) => ({
    id: null,
    name: cleanString(item.name),
    issuer: cleanString(item.issuer),
    issuer_id: urnId(item.issuerUrn),
    issuer_url: cleanString(item.issuerUrl),
    issuer_logo: cleanString(item.issuerLogo),
    issue_date: formatRawDate(item.issueDate),
    expiration_date: formatRawDate(item.expirationDate),
    credential_id: cleanString(item.credentialId),
    credential_url: cleanString(item.credentialUrl),
    description: cleanString(item.description),
  }));
}

function mapLanguages(items: RawLanguage[]) {
  return items.map((item) => ({
    name: cleanString(item.name),
    proficiency: cleanString(item.proficiency),
  }));
}

function mapCourses(items: RawCourse[]) {
  return items.map((item) => ({
    name: cleanString(item.name),
    number: cleanString(item.number),
    description: cleanString(item.description),
    associated_with: cleanString(item.associatedWith),
  }));
}

function mapProjects(items: RawProject[]) {
  return items.map((item) => ({
    name: cleanString(item.name),
    description: cleanString(item.description),
    url: cleanString(item.url),
    start_date: startDateOf(item.timePeriod),
    end_date: endDateOf(item.timePeriod),
    associated_with: cleanString(item.associatedWith),
  }));
}

function mapVolunteer(items: RawVolunteer[]) {
  return items.map((item) => ({
    role: cleanString(item.role),
    organization: cleanString(item.organization),
    organization_id: urnId(item.organizationUrn),
    organization_url: cleanString(item.organizationUrl),
    organization_logo: cleanString(item.organizationLogo),
    cause: cleanString(item.cause),
    location: cleanString(item.location),
    description: cleanString(item.description),
    start_date: startDateOf(item.timePeriod),
    end_date: endDateOf(item.timePeriod),
    is_current: isCurrent(item.timePeriod),
  }));
}

function mapAwards(items: RawAward[]) {
  return items.map((item) => ({
    title: cleanString(item.title),
    issuer: cleanString(item.issuer),
    issue_date: formatRawDate(item.issueDate),
    description: cleanString(item.description),
  }));
}

function mapPublications(items: RawPublication[]) {
  return items.map((item) => ({
    title: cleanString(item.title),
    publisher: cleanString(item.publisher),
    publication_date: formatRawDate(item.publicationDate),
    description: cleanString(item.description),
    url: cleanString(item.url),
  }));
}

function mapPatents(items: RawPatent[]) {
  return items.map((item) => ({
    title: cleanString(item.title),
    patent_number: cleanString(item.patentNumber),
    status: cleanString(item.status),
    issue_date: formatRawDate(item.issueDate),
    inventors: item.inventors.map(cleanString).filter((i): i is string => i != null),
    description: cleanString(item.description),
    url: cleanString(item.url),
  }));
}

function mapOrganizations(items: RawOrganization[]) {
  return items.map((item) => ({
    name: cleanString(item.name),
    role: cleanString(item.role),
    description: cleanString(item.description),
    start_date: startDateOf(item.timePeriod),
    end_date: endDateOf(item.timePeriod),
    url: cleanString(item.url),
  }));
}

function mapInterests(items: RawInterest[]) {
  return items.map((item) => ({
    name: cleanString(item.name),
    url: cleanString(item.url),
    image: cleanString(item.image),
  }));
}

function mapRecommendations(items: RawRecommendation[]) {
  return items.map((item) => ({
    text: cleanString(item.text),
    recommender_name: cleanString(item.recommenderName),
    recommender_headline: cleanString(item.recommenderHeadline),
    recommender_url: cleanString(item.recommenderUrl),
    recommender_image: cleanString(item.recommenderImage),
    relationship: cleanString(item.relationship),
    date: cleanString(item.date),
  }));
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function parseLinkedInProfile(raw: RawLinkedInProfile): ParsedProfile {
  const identity = raw.identity;
  const fullName =
    cleanString(identity.fullName) ??
    joinName([cleanString(identity.firstName), cleanString(identity.middleName), cleanString(identity.lastName)]);

  const vanityName = cleanString(identity.vanityName) ?? cleanString(identity.publicIdentifier);
  const profileUrl = cleanString(identity.profileUrl) ?? (vanityName ? `https://www.linkedin.com/in/${vanityName}/` : null);

  const profile: NormalizedProfile = {
    identity: {
      first_name: cleanString(identity.firstName),
      last_name: cleanString(identity.lastName),
      middle_name: cleanString(identity.middleName),
      maiden_name: cleanString(identity.maidenName),
      full_name: fullName,
      headline: cleanString(identity.headline),
      pronouns: cleanString(identity.pronouns),
      public_identifier: cleanString(identity.publicIdentifier) ?? vanityName,
      profile_url: profileUrl,
      vanity_name: vanityName,
    },
    location: {
      raw: cleanString(raw.location.raw),
      city: cleanString(raw.location.city),
      state: cleanString(raw.location.state),
      country: cleanString(raw.location.country),
      country_code: cleanString(raw.location.countryCode),
      postal_code: cleanString(raw.location.postalCode),
    },
    about: cleanString(raw.about),
    profile_images: {
      profile: normalizeImage(raw.profilePicture),
      background: normalizeImage(raw.backgroundPicture),
      gallery: raw.gallery.map(normalizeImage),
    },
    experience: mapExperience(raw.experience),
    education: mapEducation(raw.education),
    skills: mapSkills(raw.skills),
    certifications: mapCertifications(raw.certifications),
    languages: mapLanguages(raw.languages),
    courses: mapCourses(raw.courses),
    projects: mapProjects(raw.projects),
    volunteer_experience: mapVolunteer(raw.volunteerExperience),
    awards: mapAwards(raw.awards),
    publications: mapPublications(raw.publications),
    patents: mapPatents(raw.patents),
    organizations: mapOrganizations(raw.organizations),
    interests: mapInterests(raw.interests),
    recommendations: mapRecommendations(raw.recommendations),
    contact_info: {
      websites: raw.contactInfo.websites.map((w) => ({ url: w.url, label: cleanString(w.label) })),
      twitter: cleanString(raw.contactInfo.twitter),
      github: cleanString(raw.contactInfo.github),
      other_social_profiles: raw.contactInfo.otherSocialProfiles.map((s) => ({
        platform: s.platform,
        url: s.url,
      })),
    },
    connections_count: toInt(raw.connectionsCount),
    followers_count: toInt(raw.followersCount),
    open_to_work: toBool(raw.openToWork),
    hiring: toBool(raw.hiring),
  };

  const sectionsAvailable: string[] = [];
  const push = (name: string, present: boolean) => {
    if (present) sectionsAvailable.push(name);
  };

  push('identity', Object.values(profile.identity).some((v) => v != null));
  push('location', Object.values(profile.location).some((v) => v != null));
  push('about', profile.about != null);
  push(
    'profile_images',
    profile.profile_images.profile.url != null ||
      profile.profile_images.background.url != null ||
      profile.profile_images.gallery.length > 0,
  );
  push('experience', profile.experience.length > 0);
  push('education', profile.education.length > 0);
  push('skills', profile.skills.length > 0);
  push('certifications', profile.certifications.length > 0);
  push('languages', profile.languages.length > 0);
  push('courses', profile.courses.length > 0);
  push('projects', profile.projects.length > 0);
  push('volunteer_experience', profile.volunteer_experience.length > 0);
  push('awards', profile.awards.length > 0);
  push('publications', profile.publications.length > 0);
  push('patents', profile.patents.length > 0);
  push('organizations', profile.organizations.length > 0);
  push('interests', profile.interests.length > 0);
  push('recommendations', profile.recommendations.length > 0);
  push('contact_info', profile.contact_info.websites.length > 0 || profile.contact_info.twitter != null || profile.contact_info.github != null);

  const warnings: string[] = [];
  if (fullName == null) warnings.push('No name was extracted for this profile.');

  return { profile, sectionsAvailable, warnings };
}
