/**
 * Public API schemas.
 *
 * This file defines the stable, versioned contract for the API. It is the
 * single place where the response shape is declared, and the parser in
 * `linkedin/parser.ts` is responsible for producing values that satisfy it.
 *
 * Field names here are snake_case and mirror the documented public API — NOT
 * LinkedIn's internal structures. Never change these shapes without bumping the
 * version; LinkedIn-side churn is absorbed by the raw types + parser instead.
 */

import { z } from 'zod';
import { parseProfileUrl } from '../utils/url.js';

// ---------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------

export const profileRequestSchema = z.object({
  url: z
    .string()
    .min(1, 'url is required')
    .refine((value) => parseProfileUrl(value).ok, {
      message: 'url must be a valid HTTPS LinkedIn profile URL beginning with /in/',
    }),
});

export type ProfileRequest = z.infer<typeof profileRequestSchema>;

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

const nullableString = z.string().nullable();
const nullableInt = z.number().int().nullable();
const nullableNumber = z.number().nullable();
const nullableBool = z.boolean().nullable();

// ---------------------------------------------------------------------------
// Profile sections
// ---------------------------------------------------------------------------

const identitySchema = z.object({
  first_name: nullableString,
  last_name: nullableString,
  middle_name: nullableString,
  maiden_name: nullableString,
  full_name: nullableString,
  headline: nullableString,
  pronouns: nullableString,
  public_identifier: nullableString,
  profile_url: nullableString,
  vanity_name: nullableString,
});

const locationSchema = z.object({
  raw: nullableString,
  city: nullableString,
  state: nullableString,
  country: nullableString,
  country_code: nullableString,
  postal_code: nullableString,
});

const imageSchema = z.object({
  url: nullableString,
  width: nullableNumber,
  height: nullableNumber,
  alt: nullableString,
});

const profileImagesSchema = z.object({
  profile: imageSchema,
  background: imageSchema,
  gallery: z.array(imageSchema),
});

const experienceSchema = z.object({
  id: nullableString,
  title: nullableString,
  company: nullableString,
  company_id: nullableString,
  company_url: nullableString,
  company_logo: nullableString,
  employment_type: nullableString,
  location: nullableString,
  description: nullableString,
  start_date: nullableString,
  end_date: nullableString,
  is_current: z.boolean(),
  duration: nullableString,
});

const educationSchema = z.object({
  id: nullableString,
  school: nullableString,
  school_id: nullableString,
  school_url: nullableString,
  school_logo: nullableString,
  degree: nullableString,
  field_of_study: nullableString,
  description: nullableString,
  start_date: nullableString,
  end_date: nullableString,
  grade: nullableString,
  activities: nullableString,
});

const skillSchema = z.object({
  name: nullableString,
  endorsement_count: nullableInt,
  category: nullableString,
  url: nullableString,
});

const certificationSchema = z.object({
  id: nullableString,
  name: nullableString,
  issuer: nullableString,
  issuer_id: nullableString,
  issuer_url: nullableString,
  issuer_logo: nullableString,
  issue_date: nullableString,
  expiration_date: nullableString,
  credential_id: nullableString,
  credential_url: nullableString,
  description: nullableString,
});

const languageSchema = z.object({
  name: nullableString,
  proficiency: nullableString,
});

const courseSchema = z.object({
  name: nullableString,
  number: nullableString,
  description: nullableString,
  associated_with: nullableString,
});

const projectSchema = z.object({
  name: nullableString,
  description: nullableString,
  url: nullableString,
  start_date: nullableString,
  end_date: nullableString,
  associated_with: nullableString,
});

const volunteerSchema = z.object({
  role: nullableString,
  organization: nullableString,
  organization_id: nullableString,
  organization_url: nullableString,
  organization_logo: nullableString,
  cause: nullableString,
  location: nullableString,
  description: nullableString,
  start_date: nullableString,
  end_date: nullableString,
  is_current: z.boolean(),
});

const awardSchema = z.object({
  title: nullableString,
  issuer: nullableString,
  issue_date: nullableString,
  description: nullableString,
});

const publicationSchema = z.object({
  title: nullableString,
  publisher: nullableString,
  publication_date: nullableString,
  description: nullableString,
  url: nullableString,
});

const patentSchema = z.object({
  title: nullableString,
  patent_number: nullableString,
  status: nullableString,
  issue_date: nullableString,
  inventors: z.array(z.string()),
  description: nullableString,
  url: nullableString,
});

const organizationSchema = z.object({
  name: nullableString,
  role: nullableString,
  description: nullableString,
  start_date: nullableString,
  end_date: nullableString,
  url: nullableString,
});

const interestSchema = z.object({
  name: nullableString,
  url: nullableString,
  image: nullableString,
});

const recommendationSchema = z.object({
  text: nullableString,
  recommender_name: nullableString,
  recommender_headline: nullableString,
  recommender_url: nullableString,
  recommender_image: nullableString,
  relationship: nullableString,
  date: nullableString,
});

const websiteSchema = z.object({
  url: z.string(),
  label: nullableString,
});

const socialProfileSchema = z.object({
  platform: z.string(),
  url: z.string(),
});

const contactInfoSchema = z.object({
  websites: z.array(websiteSchema),
  twitter: nullableString,
  github: nullableString,
  other_social_profiles: z.array(socialProfileSchema),
});

// ---------------------------------------------------------------------------
// Full profile + response envelope
// ---------------------------------------------------------------------------

export const profileSchema = z.object({
  identity: identitySchema,
  location: locationSchema,
  about: nullableString,
  profile_images: profileImagesSchema,
  experience: z.array(experienceSchema),
  education: z.array(educationSchema),
  skills: z.array(skillSchema),
  certifications: z.array(certificationSchema),
  languages: z.array(languageSchema),
  courses: z.array(courseSchema),
  projects: z.array(projectSchema),
  volunteer_experience: z.array(volunteerSchema),
  awards: z.array(awardSchema),
  publications: z.array(publicationSchema),
  patents: z.array(patentSchema),
  organizations: z.array(organizationSchema),
  interests: z.array(interestSchema),
  recommendations: z.array(recommendationSchema),
  contact_info: contactInfoSchema,
  connections_count: nullableInt,
  followers_count: nullableInt,
  open_to_work: nullableBool,
  hiring: nullableBool,
});

const metadataSchema = z.object({
  scraped_at: z.string(),
  source: z.literal('linkedin'),
  extraction_method: z.enum(['network', 'embedded_data', 'dom', 'mixed']),
  authenticated: z.boolean(),
  partial: z.boolean(),
  sections_available: z.array(z.string()),
  warnings: z.array(z.string()),
});

export const profileResponseSchema = z.object({
  success: z.literal(true),
  profile: profileSchema,
  metadata: metadataSchema,
});

export const errorResponseSchema = z.object({
  success: z.literal(false),
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.record(z.unknown()),
  }),
});

export type NormalizedProfile = z.infer<typeof profileSchema>;
export type ProfileResponse = z.infer<typeof profileResponseSchema>;
export type ErrorResponse = z.infer<typeof errorResponseSchema>;
export type NormalizedIdentity = z.infer<typeof identitySchema>;
export type NormalizedExperience = z.infer<typeof experienceSchema>;
export type NormalizedEducation = z.infer<typeof educationSchema>;
export type NormalizedImage = z.infer<typeof imageSchema>;
