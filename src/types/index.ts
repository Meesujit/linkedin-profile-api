/**
 * Shared, framework-agnostic types used across the service.
 */

export type ErrorCode =
  | 'INVALID_URL'
  | 'LINKEDIN_AUTH_REQUIRED'
  | 'PROFILE_NOT_FOUND'
  | 'PROFILE_NOT_ACCESSIBLE'
  | 'EXTRACTION_FAILED'
  | 'RATE_LIMITED'
  | 'TIMEOUT'
  | 'INTERNAL_ERROR';

export type ExtractionMethod = 'network' | 'embedded_data' | 'dom' | 'mixed';

export interface ExtractionMetadata {
  scraped_at: string;
  source: 'linkedin';
  extraction_method: ExtractionMethod;
  authenticated: boolean;
  partial: boolean;
  sections_available: string[];
  warnings: string[];
}
