# LinkedIn Profile API

A hosted API that accepts a LinkedIn profile URL and returns most of the
information available on the profile page as structured JSON, using your own
authenticated LinkedIn session.

Built as a hiring-challenge submission (deadline 31 August 2026). TypeScript +
Node.js exclusively.

---

## Overview

`POST /v1/profile` takes a LinkedIn profile URL, makes **direct HTTP requests**
to LinkedIn's internal endpoints using your own authenticated session cookies,
and returns the profile data as a stable, strongly-validated JSON structure.

> **No browser is used at runtime.** The LinkedIn extraction layer does not use
> Playwright, Puppeteer, Selenium, Chromium, or any browser automation. It
> directly communicates with the relevant LinkedIn HTTP endpoints from the
> Node.js runtime using native `fetch`.

The service is a **reverse-engineered API client over an authenticated session**
— not a bypass of access controls. It only ever reads data that LinkedIn
legitimately returns to the authenticated account, and it never fabricates
missing data.

Key design principles:

- **Accuracy over completeness.** Missing fields are `null`, missing sections
  are `[]`. Nothing is guessed.
- **Direct HTTP.** Raw LinkedIn JSON is fetched from LinkedIn's internal REST
  endpoints and normalized; no DOM scraping, no browser.
- **Clean separation.** Raw LinkedIn data → parser → normalized public schema.
- **Security-first.** Credentials come from the environment, no secrets in logs
  or responses, CAPTCHA/MFA is never automated around.

---

## Architecture

```
Client
   ↓
Fastify API  (routes/profile.ts)
   ↓
Zod request validation  (schemas/profile.schema.ts + utils/url.ts)
   ↓
ProfileService  (services/profile.service.ts)  — cache, session gate
   ↓
LinkedInClient  (linkedin/client.ts)  — endpoint selection, error mapping
   ↓
LinkedInHttp  (linkedin/http.ts)  — native fetch + timeout + auth headers
   ↓
LinkedIn internal endpoints  (voyager/api/...)  ← direct HTTP, no browser
   ↓
RawLinkedInProfile  (linkedin/types.ts)
   ↓
LinkedInParser  (linkedin/parser.ts)
   ↓
NormalizedProfile  (Zod)  →  JSON response
```

Responsibilities are deliberately isolated:

- The API layer contains **no** LinkedIn scraping logic.
- The LinkedIn client contains **no** Fastify route logic.
- The parser does **not** depend on HTTP request objects.
- Raw LinkedIn data and the normalized API schema are **separate types**, so
  LinkedIn-side changes are absorbed in `extractor.ts` / `parser.ts` without
  breaking the public API.

---

## Features

The API extracts, when available:

| Section | Notes |
| --- | --- |
| Identity | first/last/middle/maiden name, full name, headline, pronouns, public identifier, profile URL, vanity name |
| Location | raw, city, state, country, country code, postal code |
| About | cleaned whitespace |
| Images | profile picture, background picture, gallery (URL + dimensions + alt) |
| Experience | title, company (+id/url/logo), employment type, location, description, dates, `is_current`, computed duration |
| Education | school (+id/url/logo), degree, field of study, dates, grade, activities |
| Skills | name, endorsement count (null when unknown), category, url |
| Certifications | name, issuer (+id/url/logo), dates, credential id/url, description |
| Languages | name, proficiency |
| Courses / Projects | name, description, dates, associated-with, url |
| Volunteer experience | role, organization, cause, dates, `is_current` |
| Awards / Publications / Patents / Organizations / Interests / Recommendations | per the public schema |
| Contact info | websites, twitter, github, other social profiles (only what the session exposes) |
| Metadata | connections/followers count, open-to-work, hiring (null when unavailable) |

Every response also carries extraction metadata (method, sections present,
warnings, `partial` flag) so consumers can tell exactly what was recovered.

---

## Tech Stack

- **Node.js 22 LTS** + **TypeScript 5** (strict mode)
- **Fastify 5** (HTTP framework)
- **Native `fetch` (undici)** — direct LinkedIn HTTP requests (no browser)
- **Zod** (request + response validation)
- **Vitest** (testing)
- **pnpm** (package manager)
- **Docker** / Docker Compose (deployment)
- **Pino** (structured logging)

---

## Project Structure

```
linkedin-profile-api/
├── src/
│   ├── server.ts              # process entry point + graceful shutdown
│   ├── app.ts                 # Fastify factory + plugin wiring
│   ├── config.ts              # env-driven configuration
│   ├── routes/
│   │   ├── health.ts          # GET /health
│   │   └── profile.ts         # POST /v1/profile + error mapping
│   ├── schemas/
│   │   └── profile.schema.ts  # public Zod schemas (request + response)
│   ├── linkedin/
│   │   ├── auth.ts            # session credential resolution (env vars)
│   │   ├── http.ts            # direct HTTP client (fetch + timeout + error mapping)
│   │   ├── endpoints.ts       # LinkedIn internal endpoint definitions
│   │   ├── client.ts          # LinkedInClient (endpoint selection + auth detection)
│   │   ├── extractor.ts       # raw LinkedIn JSON → raw model mapping
│   │   ├── parser.ts          # raw → normalized mapping
│   │   ├── types.ts           # raw LinkedIn data model
│   │   └── errors.ts          # typed LinkedIn errors
│   ├── services/
│   │   └── profile.service.ts # orchestration (cache/session/extract/parse)
│   ├── utils/
│   │   ├── logger.ts          # pino config (redacted)
│   │   ├── url.ts             # URL validation + normalization
│   │   └── cache.ts           # in-memory TTL cache
│   └── types/
│       └── index.ts           # shared types (error codes, metadata)
├── tests/                     # Vitest suites (validation, parser, extractor,
│                              #   auth, http, schema, health, api — mocked HTTP)
├── fixtures/linkedin/         # sanitized fictional fixtures (no real data)
├── Dockerfile
├── docker-compose.yml
├── tsconfig.json / tsconfig.build.json
├── vitest.config.ts
└── README.md
```

---

## Setup

Prerequisites: Node.js ≥ 22, pnpm.

```bash
git clone <repo-url>
cd linkedin-profile-api
pnpm install
cp .env.example .env      # optional — defaults are sensible
```

> Note for WSL users: `pnpm install` must run inside the Linux filesystem (not
> on a `/mnt/...` Windows-mounted drive), because pnpm uses symlinks that
> Windows mounts handle poorly.

---

## LinkedIn Authentication

The API authenticates with **your own** LinkedIn account via session cookies
(`li_at` + `JSESSIONID`). It never sees or stores your password, and **no
browser is used anywhere** — the cookies are obtained from your own logged-in
browser and supplied to the API through environment variables.

1. Log into LinkedIn normally in your browser.
2. Open DevTools → Application → Cookies → `https://www.linkedin.com`.
3. Copy the `li_at` and `JSESSIONID` values.
4. Set them as `LINKEDIN_LI_AT` and `LINKEDIN_JSESSIONID` — in your hosting
   platform's secret store for deployment, or a git-ignored `.env` for local use.

```bash
cp .env.example .env
# fill LINKEDIN_LI_AT and LINKEDIN_JSESSIONID in .env
pnpm dev
```

- `.env` is git-ignored; env vars are injected as secrets and never committed.
- Sessions expire. When requests return `LINKEDIN_AUTH_REQUIRED`, refresh the
  cookie values.

---

## Running Locally

```bash
pnpm dev       # tsx watch, dev server on :8000
# or, production-style:
pnpm build
pnpm start     # node dist/server.js
```

Verify:

```bash
curl http://localhost:8000/health
```

---

## API Documentation

| Method | Path | Description |
| --- | --- | --- |
| GET | `/health` | Liveness check (no session details) |
| POST | `/v1/profile` | Extract a profile |
| GET | `/docs` | Interactive Swagger UI |
| GET | `/docs/json` | OpenAPI JSON |
| GET | `/docs/yaml` | OpenAPI YAML |

### `GET /health`

```json
{ "status": "ok", "service": "linkedin-profile-api" }
```

### `POST /v1/profile`

Request:

```json
{ "url": "https://www.linkedin.com/in/example/" }
```

`url` must be an HTTPS LinkedIn profile URL whose path begins with `/in/`.
Arbitrary URLs are rejected with `400 INVALID_URL`.

Success response (abbreviated — every section follows the same shape):

```json
{
  "success": true,
  "profile": {
    "identity": {
      "first_name": "Alex",
      "last_name": "Rivera",
      "full_name": "Alex James Rivera",
      "headline": "Senior Software Engineer",
      "pronouns": null,
      "public_identifier": "alex-rivera",
      "profile_url": "https://www.linkedin.com/in/alex-rivera/",
      "vanity_name": "alex-rivera"
    },
    "location": {
      "raw": "Bengaluru, Karnataka, India",
      "city": "Bengaluru",
      "state": "Karnataka",
      "country": "India",
      "country_code": "IN",
      "postal_code": null
    },
    "about": "Software engineer focused on distributed systems...",
    "profile_images": {
      "profile": { "url": "https://...", "width": 200, "height": 200, "alt": "Alex Rivera" },
      "background": { "url": "https://...", "width": 1584, "height": 396, "alt": null },
      "gallery": []
    },
    "experience": [
      {
        "id": null,
        "title": "Senior Software Engineer",
        "company": "Acme Corp",
        "company_id": "12345",
        "company_url": "https://www.linkedin.com/company/acme-corp/",
        "company_logo": null,
        "employment_type": "Full-time",
        "location": "Bengaluru, Karnataka, India",
        "description": "Leading the search infrastructure team.",
        "start_date": "2022-03",
        "end_date": null,
        "is_current": true,
        "duration": null
      }
    ],
    "education": [],
    "skills": [{ "name": "TypeScript", "endorsement_count": 45, "category": null, "url": null }],
    "certifications": [],
    "languages": [{ "name": "English", "proficiency": "Professional working proficiency" }],
    "courses": [],
    "projects": [],
    "volunteer_experience": [],
    "awards": [],
    "publications": [],
    "patents": [],
    "organizations": [],
    "interests": [],
    "recommendations": [],
    "contact_info": {
      "websites": [{ "url": "https://alexrivera.dev", "label": "Portfolio" }],
      "twitter": null,
      "github": null,
      "other_social_profiles": []
    },
    "connections_count": 512,
    "followers_count": 1204,
    "open_to_work": false,
    "hiring": true
  },
  "metadata": {
    "scraped_at": "2026-08-27T00:00:00.000Z",
    "source": "linkedin",
    "extraction_method": "network",
    "authenticated": true,
    "partial": false,
    "sections_available": ["identity", "location", "about", "experience", "skills", "languages"],
    "warnings": []
  }
}
```

Error response:

```json
{
  "success": false,
  "error": {
    "code": "LINKEDIN_AUTH_REQUIRED",
    "message": "The LinkedIn session requires re-authentication.",
    "details": {}
  }
}
```

Error codes: `INVALID_URL`, `LINKEDIN_AUTH_REQUIRED`, `PROFILE_NOT_FOUND`,
`PROFILE_NOT_ACCESSIBLE`, `EXTRACTION_FAILED`, `RATE_LIMITED`, `TIMEOUT`,
`INTERNAL_ERROR`. Responses never include stack traces, cookies, headers, or
internal state.

### Example request

```bash
curl -X POST https://YOUR-DOMAIN/v1/profile \
  -H "Content-Type: application/json" \
  -d '{ "url": "https://www.linkedin.com/in/example/" }'
```

---

## Reverse Engineering Approach

The challenge asks to "reverse engineer LinkedIn APIs". We interpret this
literally and ethically: **reproduce the HTTP requests LinkedIn's own web
application makes during an authorized session** — not to bypass authentication,
defeat access controls, or exfiltrate anything the session is not entitled to.

How the LinkedIn web communication was investigated:

1. During development, LinkedIn's own web-application traffic was inspected in
   an authenticated browser session (dev-only investigation). Two data sources
   were identified:
   - The current frontend fetches the profile through a **Server-Driven UI /
     React Server Components** pipeline (`flagship-web/rsc-action`) returning
     `application/octet-stream` React-Flight payloads.
   - LinkedIn's legacy **internal REST API** (`/voyager/api/...`) — the JSON API
     used by earlier generations of scrapers.
2. The client targets the Voyager API: `li_at` + `JSESSIONID` session cookies
   (plus a `csrf-token` header derived from `JSESSIONID`) are attached to each
   `GET` request for the profile entity as JSON.
3. **Live result (August 2026):** the Voyager endpoints return **HTTP 410 Gone**
   — LinkedIn has retired the Voyager JSON API. The request authenticates
   correctly (no redirect / auth-wall), but the endpoint no longer exists.

Endpoints targeted (and observed outcome):

| Endpoint | Method | Purpose | Observed |
| --- | --- | --- | --- |
| `/voyager/api/identity/profiles/{id}/profileView` | GET | Full profile: identity, headline, location, summary/about, experience, education, skills, certifications, languages, images | **HTTP 410 Gone** (retired) |
| `/voyager/api/identity/profiles/{id}/profileContactInfo` | GET | Public contact info (websites, social profiles) | retired (same namespace) |

Profile identifiers: a `/in/<public-identifier>/` URL is parsed and normalized
(see `utils/url.ts`); the `<public-identifier>` becomes the path segment used in
the endpoint.

The parser pipeline (raw → `RawLinkedInProfile` → normalized schema) is fully
implemented and tested against a Voyager-shaped fixture; it is the part that
remains useful regardless of which endpoint ultimately supplies the raw JSON.
When a Voyager payload is provided (e.g. a recorded fixture), normalization
works end-to-end. The Voyager payloads embed the full section lists (with
`{ "*elements": [...] }` paging wrappers), so no pagination is required.

Authentication: the `li_at` (long-lived auth token) and `JSESSIONID` (session
CSRF token) cookies are read from the environment and attached to every
request; the `csrf-token` header is the `JSESSIONID` value with its quotes
stripped. Live testing confirmed the authentication is accepted — the observed
410 is an endpoint-not-found, not an auth rejection.

The remaining direct-HTTP surface is the SDUI/RSC pipeline
(`flagship-web/rsc-action`), which returns `application/octet-stream`
React-Flight wire format rather than JSON — documented under Future
Improvements as the next reverse-engineering target.

No undocumented endpoints are assumed or invented. No proprietary PhantomBuster
code is used; its public documentation is used only as architectural inspiration
(an authenticated cookie/session drives the client).

---

## Data Extraction Strategy

Single-source, deterministic:

1. **Direct HTTP** — `GET /voyager/api/identity/profiles/{id}/profileView`
   returns the profile entity as JSON; `extractor.ts` maps it into
   `RawLinkedInProfile`.
2. **Contact info** — a separate best-effort `GET .../profileContactInfo`
   enriches `contact_info`; its absence is non-fatal.

The parser then enforces the "never fabricate" rule: any field or section the
payload does not contain is returned as `null`/`[]`. The `extraction_method` in
the response metadata is `network`.

---

## Security

- Authentication uses **only your own** (or an explicitly authorized) account.
- Credentials (`LINKEDIN_LI_AT` + `LINKEDIN_JSESSIONID`) come from the
  environment / deployment secret store and are **never committed**; the
  password is never seen or stored.
- Session values are **never logged** and **never returned** by the API.
- `.env` is git-ignored; `.env.example` contains placeholders only.
- CAPTCHA, MFA, checkpoints, and identity verification are **never automated
  around** — they require manual interaction.
- Rate limits are respected; the API rate-limiter protects the public endpoint
  and never exists to defeat LinkedIn's own limits.
- Logs are redacted (cookies, authorization headers, tokens).
- Error responses never leak secrets, stack traces, or internal state.
- Access is limited to what the authenticated session can legitimately see.

---

## Testing

```bash
pnpm test          # vitest run
pnpm test:watch
pnpm typecheck     # tsc --noEmit (strict)
pnpm lint
```

Coverage: URL validation (valid/invalid cases), Zod request + response schema
validation, parser mapping (identity, experience, education, skills,
certifications, languages, images, dates, durations, current-vs-past roles,
missing/null/empty data), extractor mapping from a fictional LinkedIn-shaped
payload, session resolution (`auth.ts`), the HTTP client's error mapping
(redirects, 999, 401/403/404/429, timeout), and `POST /v1/profile` (invalid
URL, valid URL, and auth-required) with **mocked** HTTP. Tests require no live
LinkedIn access. Fixtures are fictional and sanitized — no real person's data,
no credentials.

---

## Docker

```bash
docker compose up --build
```

The image builds the project and runs `node dist/server.js` on `0.0.0.0:8000`.
**No browser or Chromium is installed** — the LinkedIn client is direct HTTP.
No secrets are baked into the image; session credentials are injected via
`LINKEDIN_LI_AT` / `LINKEDIN_JSESSIONID` at runtime.

---

## Deployment

Any Node.js container platform works (Render, Railway, Fly.io, etc.) — no
Chromium or browser support is required. Configure the session credentials as
secrets via the platform's secret store — never in the repo, Dockerfile, or
logs.

```text
NODE_ENV=production
LINKEDIN_LI_AT=<your li_at cookie>
LINKEDIN_JSESSIONID=<your JSESSIONID cookie>
```

After deploying, validate externally:

```bash
curl https://YOUR-DOMAIN/health
curl -X POST https://YOUR-DOMAIN/v1/profile \
  -H "Content-Type: application/json" \
  -d '{ "url": "https://www.linkedin.com/in/example/" }'
```

> The placeholder `YOUR-DOMAIN` above is not a real URL; replace it with the
> actual deployment once provisioned.

---

## Known Limitations

- **Voyager is retired.** Live testing (August 2026) returned HTTP 410 Gone for
  `/voyager/api/identity/profiles/{id}/profileView` — LinkedIn has removed the
  Voyager JSON API. The client's authentication is accepted (the request is not
  rejected as auth/anti-bot), but the endpoint no longer exists; the current
  profile data source is the SDUI/RSC layer (`flagship-web/rsc-action`).
- The `profileView` response shape (Voyager era) varies by profile and by
  LinkedIn release; field mapping is defensive and may need updating.
- **Anti-bot**: LinkedIn (via Cloudflare and its own `fabric` layer) may reject
  requests it deems non-browser (HTTP 999, `li_at=delete me`, or 302 redirects).
  A fresh, valid session and conservative request rate minimize this, but it
  cannot be guaranteed. When it happens the API surfaces `RATE_LIMITED` or
  `LINKEDIN_AUTH_REQUIRED` rather than retrying aggressively.
- Profile visibility differs by relationship; some sections may be absent or
  partial for the authenticated account.
- Some profiles may require additional verification to view.
- Sessions expire and must be renewed.
- Image URLs are CDN-signed and can change or expire.
- Some fields (e.g. contact details not exposed to the session) may be
  unavailable.
- `is_current` is inferred from an absent end date (LinkedIn's convention) and
  can be wrong for profiles with incomplete date data.
- The API cannot guarantee 100% completeness for every profile.

---

## Future Improvements

- Reverse-engineer the SDUI/RSC pipeline (`flagship-web/rsc-action`) — the
  current profile data source — and parse its `application/octet-stream`
  React-Flight payloads. This is the main path back to live extraction now that
  Voyager is retired.
- Persist a validated session and add health checks that surface
  `LINKEDIN_AUTH_REQUIRED` before requests fail.
- Persistent cache (Redis) for horizontal scaling.
- Snapshot-based extractor regression tests against recorded (sanitized)
  payloads.
- Deeper `geo` location parsing into structured city/state/country.
