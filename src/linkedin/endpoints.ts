/**
 * LinkedIn internal API endpoints (Voyager REST).
 *
 * These are the endpoints LinkedIn's own web application historically used and
 * that the authenticated session can reach. Each is hit with a plain HTTP GET
 * carrying the session cookies (`li_at` + `JSESSIONID`) and a `csrf-token`
 * header — see `http.ts` / `auth.ts`.
 *
 * NOTE: only endpoints whose response shape has been observed are listed. The
 * `profileView` response already embeds most sections (identity, headline,
 * location, summary/about, experience, education, skills, certifications,
 * languages, profile/background images), so it is the primary source.
 */
export const LINKEDIN_ORIGIN = 'https://www.linkedin.com';

export interface EndpointSpec {
  method: 'GET' | 'POST';
  path: (identifier: string) => string;
  purpose: string;
}

export const ENDPOINTS = {
  profileView: {
    method: 'GET',
    path: (id: string) => `/voyager/api/identity/profiles/${encodeURIComponent(id)}/profileView`,
    purpose: 'Full profile entity: identity, headline, summary, location, experience, education, skills, certifications, languages, images.',
  },
  profileContactInfo: {
    method: 'GET',
    path: (id: string) => `/voyager/api/identity/profiles/${encodeURIComponent(id)}/profileContactInfo`,
    purpose: 'Public contact information (websites, social profiles) exposed to the authenticated account.',
  },
} satisfies Record<string, EndpointSpec>;
