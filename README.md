# LinkedIn Profile API

A hosted API that accepts a LinkedIn profile URL and returns most of the
information available on the profile page as structured JSON, using your own
authenticated LinkedIn session.

Built as a hiring-challenge submission (deadline 31 August 2026). TypeScript +
Node.js exclusively.

---

## Overview

`POST /v1/profile` takes a LinkedIn profile URL, opens the profile inside an
authenticated Playwright browser session, extracts the profile data LinkedIn
serves to that session, and returns it as a stable, strongly-validated JSON
structure.

The service is a **scraper over an authenticated session** — not a reverse
engineered "private API" in the sense of bypassing access controls. It only
ever reads data that LinkedIn legitimately shows to the authenticated account,
and it never fabricates missing data.

Key design principles:

- **Accuracy over completeness.** Missing fields are `null`, missing sections
  are `[]`. Nothing is guessed.
- **Layered extraction.** Structured network/embedded data first, DOM fallback
  last.
- **Clean separation.** Raw LinkedIn data → parser → normalized public schema.
- **Security-first.** No credentials in the repo, no secrets in logs/responses,
  CAPTCHA/MFA is never automated around.

---

## Architecture

```
Client
   ↓
Fastify API  (routes/profile.ts)
   ↓
Zod request validation  (schemas/profile.schema.ts + utils/url.ts)
   ↓
ProfileService  (services/profile.service.ts)  — cache, session gate, concurrency
   ↓
LinkedInClient  (linkedin/client.ts)  — navigation, auth/error detection
   ↓
BrowserManager  (linkedin/browser.ts)  — Chromium lifecycle + storage state
   ↓
Authenticated LinkedIn session
   ↓
LinkedIn profile page
   ↓
Layered extractor  (linkedin/extractor.ts)  — RSC payloads → embedded JSON → rendered innerText
   ↓
RawLinkedInProfile  (linkedin/types.ts)
   ↓
LinkedInParser  (linkedin/parser.ts)
   ↓
NormalizedProfile  (Zod)  →  JSON response
```

Responsibilities are deliberately isolated:

- The API layer contains **no** LinkedIn scraping logic.
- The scraper contains **no** Fastify route logic.
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
- **Playwright** (authenticated Chromium automation)
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
│   │   ├── browser.ts         # BrowserManager (lifecycle + concurrency)
│   │   ├── client.ts          # LinkedInClient (navigation + auth detection)
│   │   ├── extractor.ts       # layered extraction (RSC/embedded/DOM text)
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
├── scripts/
│   ├── linkedin-login.ts      # interactive authentication
│   └── linkedin-inspect.ts    # dev-only network/embedded data inspector
├── tests/                     # Vitest suites (validation, parser, extractor,
│                              #   schema, health, api — mocked extraction)
├── fixtures/linkedin/         # sanitized fictional fixtures (no real data)
├── storage/                   # session state (git-ignored)
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
pnpm exec playwright install chromium
```

> Note for WSL users: `pnpm install` must run inside the Linux filesystem (not
> on a `/mnt/...` Windows-mounted drive), because pnpm uses symlinks that
> Windows mounts handle poorly.

---

## LinkedIn Authentication

The API authenticates with **your own** LinkedIn account via a persisted
Playwright storage state (cookies). It never stores your password.

```bash
pnpm linkedin:login
```

This opens a Chromium window on the LinkedIn login page. Log in manually and
complete any CAPTCHA / MFA / verification yourself. The script detects a
successful login and saves the session to `storage/linkedin-state.json`.

- The session file is **git-ignored** and must never be committed.
- Sessions expire. When requests return `LINKEDIN_AUTH_REQUIRED`, re-run the
  login script.
- On WSL you need a display (WSLg on Windows 11, or an X server) for the
  headed browser.

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
internal browser state.

### Example request

```bash
curl -X POST https://YOUR-DOMAIN/v1/profile \
  -H "Content-Type: application/json" \
  -d '{ "url": "https://www.linkedin.com/in/example/" }'
```

---

## Reverse Engineering Approach

The challenge asks to "reverse engineer LinkedIn APIs". We interpret this
literally and ethically: **observe what LinkedIn's own web application does
during an authorized session and reproduce the data-retrieval behavior** — not
to bypass authentication, defeat access controls, or exfiltrate anything the
session is not already entitled to see.

What we actually observed (August 2026, authenticated session):

1. LinkedIn's profile page is rendered by a **Server-Driven UI (SDUI) layer over
   React Server Components** ("flagship-web"). Profile data no longer comes from
   the old Voyager API or from JSON embedded in `<code>`/`<script>` blocks.
2. The profile is fetched via `POST
   https://www.linkedin.com/flagship-web/rsc-action/actions/server-request` and
   `/actions/component` (component id
   `com.linkedin.sdui.generated.profile.dsl.impl.*`), returning
   `application/octet-stream` React-Flight payloads (not JSON).
3. The rendered DOM has **hashed, unstable class names**, no `<h1>` for the name
   (it is an `<h2>`), no semantic `#experience`/`#skills` ids, and no `og:` or
   JSON-LD meta tags — so CSS-selector scraping is unreliable by design.
4. The name is reliably available in `<title>` ("Name | LinkedIn"), images in
   `<img>`/`<link rel="preload">` tags, and the remaining visible data in the
   rendered `innerText`.

Accordingly the extractor does **not** hard-code undocumented endpoints and does
**not** copy proprietary PhantomBuster code. It reads only data LinkedIn renders
to the authenticated session:

- `<title>` → name; `<img>`/`<link rel="preload">` → profile + background images;
- section-anchored parsing of `document.body.innerText` → headline, pronouns,
  location, about, skills, languages, follower/connection counts.

PhantomBuster's public documentation is used only as architectural inspiration
(an authenticated cookie/session drives the scraper).

---

## Data Extraction Strategy

Layered, in priority order (the extractor reports which layers contributed via
`extraction_method`):

1. **Rendered DOM text** — the primary source today. Name from `<title>`, images
   from `<img>`/`<link rel="preload">`, and headline/location/about/skills/
   languages/counts parsed from the rendered `innerText` via section-header
   anchoring (immune to hashed class names). The page is auto-scrolled (through
   LinkedIn's nested `<main>` scroller) to trigger lazy-loaded Experience,
   Education, Projects, and Skills sections before extraction.
2. **Network payloads** — JSON responses observed during navigation. Inactive on
   the current SDUI frontend (which returns `octet-stream` RSC payloads) but
   retained for when LinkedIn serves JSON again.
3. **Embedded JSON** — structured data inlined in the page HTML. Also currently
   absent; kept as a fallback.

The parser then enforces the "never fabricate" rule: anything not reliably
recoverable from the rendered page is returned as `null`/`[]` rather than
guessed.

---

## Security

- Authentication uses **only your own** (or an explicitly authorized) account.
- Session state lives outside the repository (`storage/`, git-ignored); the
  password is never seen or stored.
- Configuration comes from environment variables; `.env` is git-ignored.
- CAPTCHA, MFA, checkpoints, and identity verification are **never automated
  around** — they require manual interaction.
- Rate limits are respected; the API rate-limiter protects the public endpoint
  and never exists to defeat LinkedIn's own limits.
- Logs are redacted (cookies, authorization headers, tokens, sessions).
- Error responses never leak secrets, stack traces, or browser state.
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
payload, `/health`, and `POST /v1/profile` (invalid URL, valid URL, and
auth-required) with **mocked** extraction. Tests require no live LinkedIn
access. Fixtures are fictional and sanitized — no real person's data, no
credentials.

---

## Docker

```bash
docker compose up --build
```

The image installs Playwright's Chromium and its OS dependencies, builds the
project, and runs `node dist/server.js` on `0.0.0.0:8000`. No secrets are baked
into the image. The LinkedIn session state is mounted from `./storage` (generate
it on the host first with `pnpm linkedin:login`).

---

## Deployment

Any container platform that supports Chromium works (Render, Railway, Fly.io,
etc.). Configure secrets via the platform's secret store — never in the repo,
Dockerfile, or logs.

```text
NODE_ENV=production
LINKEDIN_STATE_PATH=storage/linkedin-state.json
HEADLESS=true
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

- LinkedIn migrated to an SDUI/React-Server-Components frontend (2026). Its DOM
  uses hashed, unstable class names and its data payloads are
  `application/octet-stream` RSC wire format — not the JSON of the older Voyager
  era. The extractor therefore relies on `innerText`/`<title>`/`<img>` and can
  change when LinkedIn's markup changes.
- Structured **experience/education/projects/skills** are recovered by
  auto-scrolling the profile, but only the items LinkedIn renders *without*
  clicking "Show all" are captured. Long sections (e.g. "Skills (47)" shows 2 of
  47) are therefore partial. Descriptions inside experience entries are also not
  parsed (they sit in the RSC payloads).
- `is_current` is inferred from an absent end date (LinkedIn's convention) and
  can be wrong for profiles with incomplete date data.
- Profile visibility differs by relationship; some sections may be absent or
  partial for the authenticated account.
- Some profiles may require additional verification to view.
- Sessions expire and must be renewed via `pnpm linkedin:login`.
- Image URLs are CDN-signed and can change or expire.
- LinkedIn rate limits / checkpoints may occur; the service backs off rather
  than retrying aggressively.
- Some fields (e.g. contact details behind LinkedIn's "Contact info" overlay,
  endorsement totals) may be unavailable without additional interaction.
- The API cannot guarantee 100% completeness for every profile.

---

## Future Improvements

- Parse the SDUI/RSC `application/octet-stream` payloads (React-Flight format) to
  recover structured experience/education/certifications and full geo data — the
  single biggest completeness win.
- Persistent cache (Redis) for horizontal scaling.
- Per-profile session pool / rotation for higher throughput.
- Scheduled session-health checks with automatic `LINKEDIN_AUTH_REQUIRED`
  alerting.
- Expand contact-info extraction (the contact modal / contact endpoint).
- Snapshot-based extractor regression tests against recorded (sanitized)
  payloads.
- Deeper `geo` location parsing into structured city/state/country.
