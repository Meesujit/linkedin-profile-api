/**
 * CSV serialization for batch extraction results.
 *
 * Produces a flat, spreadsheet-friendly export of the most useful profile
 * fields (identity, headline, location, current role, counts, skills).
 */
import type { NormalizedProfile } from '../schemas/profile.schema.js';

export interface CsvRow {
  url: string;
  profile: NormalizedProfile;
}

const COLUMNS = [
  'url',
  'full_name',
  'headline',
  'location',
  'current_title',
  'current_company',
  'experience_count',
  'education_count',
  'skills',
  'languages',
  'about',
  'followers_count',
  'connections_count',
  'profile_image',
] as const;

function escapeCsv(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function cell(value: unknown): string {
  if (value === null || value === undefined) return '';
  return escapeCsv(String(value));
}

export function toCsv(rows: CsvRow[]): string {
  const header = COLUMNS.join(',');
  const body = rows.map(({ url, profile }) => {
    const current = profile.experience[0];
    const values: unknown[] = [
      url,
      profile.identity.full_name,
      profile.identity.headline,
      profile.location.raw,
      current?.title ?? null,
      current?.company ?? null,
      profile.experience.length,
      profile.education.length,
      profile.skills.map((s) => s.name).filter(Boolean).join('|'),
      profile.languages.map((l) => l.name).filter(Boolean).join('|'),
      profile.about?.replace(/\s+/g, ' ').trim() ?? null,
      profile.followers_count,
      profile.connections_count,
      profile.profile_images.profile.url,
    ];
    return values.map(cell).join(',');
  });
  return [header, ...body].join('\n');
}
