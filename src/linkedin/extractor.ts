/**
 * LinkedIn extractor — turns the raw SDUI/React-Server-Components payloads into
 * the internal `RawLinkedInProfile` model.
 *
 * LinkedIn retired the Voyager JSON API (HTTP 410 Gone). Profile data now comes
 * from the SDUI/RSC ("flagship-web") layer in two forms:
 *
 *   1. the profile HTML document — carries the server-rendered top card (name,
 *      headline, location) in `<title>` / rendered `<p>` text;
 *   2. RSC `component` responses — `application/octet-stream` React-Flight
 *      payloads whose leaf text lives in `"children":["..."]` records, grouped
 *      under section headers ("Experience", "Education", "Skills", …).
 *
 * The parsing below is deliberately conservative: it extracts what can be
 * reliably anchored and leaves everything else null/[] (never fabricates).
 * LinkedIn-specific knowledge is isolated here so it can be updated when
 * LinkedIn's SDUI markup changes.
 */
import type {
  RawLinkedInProfile,
  RawExperience,
  RawEducation,
  RawSkill,
  RawLanguage,
} from './types.js';

/** Build an empty raw profile (all fields null/empty). */
export function emptyRaw(vanityName: string): RawLinkedInProfile {
  return {
    entityUrn: null,
    identity: {
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
}

function decodeHtml(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function clean(s: string): string {
  return decodeHtml(s).replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// HTML (top card) extraction
// ---------------------------------------------------------------------------

/** Extract the server-rendered top card (name, headline, location, images). */
export function extractFromHtml(html: string, vanityName: string): RawLinkedInProfile {
  const raw = emptyRaw(vanityName);

  // Name from <title> ("sujit gouda | LinkedIn").
  const title = html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ?? '';
  const fullName = title.replace(/\s*\|\s*LinkedIn\s*$/i, '').trim();
  raw.identity.fullName = fullName || null;
  const parts = fullName.split(/\s+/).filter(Boolean);
  raw.identity.firstName = parts[0] ?? null;
  raw.identity.lastName = parts.slice(1).join(' ') || null;

  // Text of the rendered elements (h1/h2/p/span) in document order — LinkedIn's
  // top card spreads name/pronouns/headline/location across these.
  const texts: string[] = [];
  const elRe = /<(p|h1|h2|span)\b[^>]*>([^<]{2,400})<\/(p|h1|h2|span)>/gi;
  let m: RegExpExecArray | null;
  while ((m = elRe.exec(html))) texts.push(clean(m[2] ?? ''));

  const noise = /^(home|my network|jobs|messaging|notifications|try premium|more|message|follow|contact info|ad options|why am i seeing this ad|manage your ad preferences|hide or report this ad)$/i;

  // pronouns: "He/Him", "She/Her", "They/Them".
  const pronouns = texts.find((t) => /^(he|she|they)\/(him|her|them|they)$/i.test(t));
  if (pronouns) raw.identity.pronouns = pronouns;

  // location: exactly "City, State, Country".
  const loc = texts.find((t) => /^[^,]{1,40}, [^,]{1,40}, [^,]{1,40}$/.test(t) && !/^(www\.|https?:)/i.test(t));
  if (loc) raw.location.raw = loc;

  // headline: first "sentence" text that isn't name/location/pronouns/noise.
  const headline = texts.find(
    (t) =>
      t !== fullName &&
      t !== loc &&
      t !== pronouns &&
      !noise.test(t) &&
      !/^(he|she|they)\//i.test(t) &&
      !/\bfollowers?\b|\bconnections?\b/i.test(t) &&
      (t.length > 30 || /[.!?]/.test(t)),
  );
  if (headline) raw.identity.headline = headline;

  // followers: "563 followers".
  const followers = texts.find((t) => /^([\d,.]+)\s*followers?$/i.test(t));
  if (followers) raw.followersCount = parseInt(followers.replace(/[^\d]/g, ''), 10) || null;

  // connections: the bare number immediately before the word "connections".
  const connIdx = texts.findIndex((t) => /^connections?$/i.test(t));
  if (connIdx > 0) {
    const prev = texts[connIdx - 1]?.match(/^([\d,.]+)\+?$/);
    if (prev) raw.connectionsCount = parseInt(prev[1]?.replace(/[^\d]/g, '') ?? '', 10) || null;
  }

  // Profile + background images from media.licdn.com URLs (best effort).
  const imgs: string[] = [];
  const imgRe = /https:\/\/media\.licdn\.com\/dms\/image\/[A-Za-z0-9]+\/[^"'\\\s)]+/g;
  let im: RegExpExecArray | null;
  while ((im = imgRe.exec(html))) {
    if (!imgs.includes(im[0])) imgs.push(im[0]);
  }
  if (imgs[0]) raw.profilePicture = { url: imgs[0], width: null, height: null, alt: fullName || null };
  if (imgs[1]) raw.backgroundPicture = { url: imgs[1], width: null, height: null, alt: null };

  return raw;
}

// ---------------------------------------------------------------------------
// React-Flight (RSC component) section extraction
// ---------------------------------------------------------------------------

type SectionName = 'about' | 'experience' | 'education' | 'skills' | 'languages';

const SKIP_SECTIONS = [
  'connected apps',
  'featured',
  'activity',
  'projects',
  'certifications',
  'licenses & certifications',
  'courses',
  'volunteer experience',
  'honors & awards',
  'publications',
  'patents',
  'organizations',
  'interests',
  'recommendations',
  'analytics',
  'resources',
  'people also viewed',
  'more profiles',
] as const;

function matchSection(line: string): SectionName | 'skip' | null {
  const t = line.toLowerCase().replace(/[()]/g, ' ').trim();
  for (const s of ['about', 'experience', 'education', 'skills', 'languages'] as const) {
    if (t === s || t.startsWith(s)) return s;
  }
  for (const s of SKIP_SECTIONS) {
    if (t === s || t.startsWith(s)) return 'skip';
  }
  return null;
}

/** Extract ordered leaf text values from a React-Flight payload. */
function extractChildrenText(rscText: string): string[] {
  const found: Array<{ idx: number; text: string }> = [];
  const push = (idx: number, raw: string): void => {
    const v = clean(raw);
    if (v && v.length <= 400 && v !== '·' && !v.startsWith('$')) found.push({ idx, text: v });
  };

  // "children":["text"] (headers/labels) and "children":[null,"text"] (wrapped text).
  const simple = /"children":\[(?:null,"([^"\\]*)"|"([^"\\]*)")]/g;
  let m: RegExpExecArray | null;
  while ((m = simple.exec(rscText))) push(m.index, m[1] ?? m[2] ?? '');

  // "children":[["$",…],"text"] — text after a nested component array (e.g. the
  // wrapped paragraphs of the About body).
  const nested = /"children":\[\[[^\]]*\],"((?:[^"\\]|\\.)*)"\]/g;
  while ((m = nested.exec(rscText))) push(m.index, m[1] ?? '');

  return found.sort((a, b) => a.idx - b.idx).map((f) => f.text);
}

const RANGE_RE = /^([A-Z][a-z]{2} )?\d{4}\s*[-–—]\s*(Present|[A-Z][a-z]{2} \d{4})/i;

/**
 * Merge section data from one RSC component payload into the raw profile.
 * Conservative: sections are matched by header, and items are parsed with
 * simple heuristics (title/company/dates/location for experience, school/degree
 * for education, bare names for skills/languages).
 */
export function mergeRscSections(rscText: string, raw: RawLinkedInProfile): void {
  const lines = extractChildrenText(rscText);
  const buffers: Record<SectionName, string[]> = { about: [], experience: [], education: [], skills: [], languages: [] };
  let current: SectionName | null = null;

  for (const line of lines) {
    const section = matchSection(line);
    if (section === 'skip') {
      current = null;
      continue;
    }
    if (section) {
      current = section;
      continue;
    }
    if (current) buffers[current].push(line);
  }

  if (buffers.about.length > 0) raw.about = buffers.about.join('\n\n') || null;

  // Experience: group into title/company/dates/location/description entries.
  const exp = parseExperience(buffers.experience);
  if (exp.length > 0) raw.experience = exp;

  const edu = parseEducation(buffers.education);
  if (edu.length > 0) raw.education = edu;

  const skills = parseSkills(buffers.skills);
  if (skills.length > 0) raw.skills = skills;

  const langs = parseLanguages(buffers.languages);
  if (langs.length > 0) raw.languages = langs;
}

function parseExperience(lines: string[]): RawExperience[] {
  const items: RawExperience[] = [];
  const skip = /^add (role|career break|position)|^show (all|more)/i;
  const dateRe = /\b(19|20)\d{2}\b/;
  let cur: RawExperience | null = null;

  const blank = (): RawExperience => ({
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
  const cleanTitle = (t: string): string | null => (t === 'none' ? null : t);

  for (const line of lines) {
    if (skip.test(line)) continue;

    // "Jul 2025 - Present · 1 yr 2 mos" — date range + duration.
    if (dateRe.test(line) && /present|[-–—]|yrs?|mos?/i.test(line)) continue;

    // "Noida, Uttar Pradesh, India · Remote" — location (+ work type).
    if (/, /.test(line)) {
      if (cur && !cur.location) cur.location = line.split('·')[0]?.trim() ?? null;
      continue;
    }

    // "Eduplor · Full-time" — company · employment type.
    if (line.includes('·')) {
      const [company, type] = line.split('·').map((s) => s.trim());
      if (cur && !cur.company) {
        cur.company = company || null;
        cur.employmentType = type || null;
      }
      continue;
    }

    // Bare line — a title (companies always carry a "· type" marker).
    if (!cur) {
      cur = { ...blank(), title: cleanTitle(line) };
    } else if (!cur.company) {
      cur.company = line === 'none' ? null : line;
      items.push(cur);
      cur = null;
    } else {
      items.push(cur);
      cur = { ...blank(), title: cleanTitle(line) };
    }
  }
  if (cur && cur.title) items.push(cur);
  return items.filter((i) => i.title);
}

function parseEducation(lines: string[]): RawEducation[] {
  const items: RawEducation[] = [];
  const skip = /^show (all|more)/i;
  const emptyState = /recruiter inmail|stand out|^school$|^degree,? ?field of study$/i;
  let cur: RawEducation | null = null;

  for (const line of lines) {
    if (skip.test(line) || emptyState.test(line)) continue;
    if (RANGE_RE.test(line)) continue;

    if (!cur) {
      cur = { school: line, schoolUrn: null, schoolUrl: null, schoolLogo: null, degree: null, fieldOfStudy: null, description: null, timePeriod: null, grade: null, activities: null };
    } else if (!cur.degree) {
      cur.degree = line;
      items.push(cur);
      cur = null;
    } else {
      items.push(cur);
      cur = { school: line, schoolUrn: null, schoolUrl: null, schoolLogo: null, degree: null, fieldOfStudy: null, description: null, timePeriod: null, grade: null, activities: null };
    }
  }
  if (cur) items.push(cur);
  return items.filter((i) => i.school && i.school !== 'none');
}

function parseSkills(lines: string[]): RawSkill[] {
  const skip = /^show (all|more)|^add /i;
  const names = lines.filter((l) => !skip.test(l) && !/\s·\s/.test(l) && l.length <= 120);
  return names.map((name) => ({ name, endorsementCount: null, category: null, url: null }));
}

function parseLanguages(lines: string[]): RawLanguage[] {
  const skip = /^show (all|more)|^add /i;
  return lines
    .filter((l) => !skip.test(l) && l.length <= 120)
    .map((l) => {
      const m = l.match(/^(.+?)\s*[-–—]\s*(.+)$/);
      return m ? { name: m[1]?.trim() ?? null, proficiency: m[2]?.trim() ?? null } : { name: l, proficiency: null };
    });
}
