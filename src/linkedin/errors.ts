/**
 * LinkedIn-specific error types.
 *
 * These are thrown deep inside the extraction pipeline and translated into a
 * safe, sanitized error response by the API layer. They never carry cookies,
 * headers, or browser internals — only a machine-readable code and, optionally,
 * a small, safe `details` object.
 */

import type { ErrorCode } from '../types/index.js';

export class LinkedInError extends Error {
  readonly code: ErrorCode;
  readonly details: Record<string, unknown>;

  constructor(code: ErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'LinkedInError';
    this.code = code;
    this.details = details;
  }
}

export class AuthRequiredError extends LinkedInError {
  constructor(message = 'The LinkedIn session requires re-authentication.') {
    super('LINKEDIN_AUTH_REQUIRED', message);
    this.name = 'AuthRequiredError';
  }
}

export class ProfileNotFoundError extends LinkedInError {
  constructor(vanityName?: string) {
    super('PROFILE_NOT_FOUND', `LinkedIn profile${vanityName ? ` "${vanityName}"` : ''} was not found.`);
    this.name = 'ProfileNotFoundError';
  }
}

export class ProfileNotAccessibleError extends LinkedInError {
  constructor(vanityName?: string) {
    super(
      'PROFILE_NOT_ACCESSIBLE',
      `LinkedIn profile${vanityName ? ` "${vanityName}"` : ''} could not be accessed with the current session.`,
    );
    this.name = 'ProfileNotAccessibleError';
  }
}

export class RateLimitedError extends LinkedInError {
  constructor(message = 'LinkedIn is rate-limiting requests. Back off and retry later.') {
    super('RATE_LIMITED', message);
    this.name = 'RateLimitedError';
  }
}

export class ExtractionFailedError extends LinkedInError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super('EXTRACTION_FAILED', message, details);
    this.name = 'ExtractionFailedError';
  }
}

export class ExtractionTimeoutError extends LinkedInError {
  constructor(message = 'Profile extraction timed out.') {
    super('TIMEOUT', message);
    this.name = 'ExtractionTimeoutError';
  }
}
