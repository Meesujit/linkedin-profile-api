/**
 * LinkedIn internal endpoints (SDUI / React-Server-Components, "flagship-web").
 *
 * LinkedIn retired the older Voyager JSON REST API (it now returns HTTP 410
 * Gone). Profile data is instead served by the SDUI/RSC layer. Two endpoint
 * shapes are used:
 *
 *   - the profile HTML document (`GET /in/{vanity}/`) — carries the server
 *     rendered top card (name, headline, location) and an embedded React-Flight
 *     payload;
 *   - RSC `component` actions (`POST /flagship-web/rsc-action/actions/component`)
 *     — return `application/octet-stream` React-Flight payloads for the
 *     lazily-loaded profile sections (about, experience, education, skills,
 *     languages).
 *
 * Every value below was observed from the live web app (August 2026) during an
 * authorized session; nothing is guessed.
 */

/** Vanity profile page URL (relative path). */
export function profilePagePath(vanityName: string): string {
  return `/in/${encodeURIComponent(vanityName)}/`;
}

/** RSC component-action path for a given SDUI component id. */
export function componentActionPath(componentId: string): string {
  const q = encodeURIComponent(componentId);
  return `/flagship-web/rsc-action/actions/component?componentId=${q}&sduiid=${q}&parentSpanId=replay%3D`;
}

/**
 * SDUI component ids for the profile sections. LinkedIn splits the profile into
 * several lazily-loaded component trees:
 */
export const PROFILE_COMPONENTS = {
  // Top card + about (identity, headline, location, summary).
  aboveActivity: 'com.linkedin.sdui.generated.profile.dsl.impl.profileCardsAboveActivity',
  // Experience section.
  experience: 'com.linkedin.sdui.generated.profile.dsl.impl.profileCardsExperienceOnly',
  // Below-activity sections (education, skills, languages, certifications).
  belowActivity: [
    'com.linkedin.sdui.generated.profile.dsl.impl.profileCardsBelowActivityPart1WithoutExp',
    'com.linkedin.sdui.generated.profile.dsl.impl.profileCardsBelowActivityPart2',
    'com.linkedin.sdui.generated.profile.dsl.impl.profileCardsBelowActivityPart3',
    'com.linkedin.sdui.generated.profile.dsl.impl.profileCardsBelowActivityPart4',
    'com.linkedin.sdui.generated.profile.dsl.impl.profileCardsBelowActivityPart5',
    'com.linkedin.sdui.generated.profile.dsl.impl.profileCardsBelowActivityPart6',
    'com.linkedin.sdui.generated.profile.dsl.impl.profileCardsBelowActivityPart7',
  ],
} as const;
