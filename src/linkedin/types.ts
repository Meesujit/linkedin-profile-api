/**
 * Raw LinkedIn data model.
 *
 * These types describe the *raw* shape of profile data as LinkedIn exposes it
 * (through embedded JSON, network payloads, or the DOM), NOT the public API
 * schema. Field names intentionally mirror LinkedIn's own conventions
 * (camelCase, `summary`, `timePeriod`, `*Urn`, ...) so the parser in
 * `parser.ts` remains the single translation point into the stable,
 * snake_case public contract.
 *
 * When LinkedIn changes its internal structures, only this file, the extractor,
 * and the parser need updating — the public API stays stable.
 */

export interface RawDate {
  year: number | null;
  month: number | null;
  day: number | null;
}

export interface RawTimePeriod {
  startDate: RawDate | null;
  endDate: RawDate | null;
}

export interface RawImage {
  url: string | null;
  width: number | null;
  height: number | null;
  alt: string | null;
}

export interface RawIdentity {
  firstName: string | null;
  lastName: string | null;
  middleName: string | null;
  maidenName: string | null;
  fullName: string | null;
  headline: string | null;
  pronouns: string | null;
  publicIdentifier: string | null;
  profileUrl: string | null;
  vanityName: string | null;
}

export interface RawLocation {
  raw: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  countryCode: string | null;
  postalCode: string | null;
}

export interface RawExperience {
  title: string | null;
  company: string | null;
  companyUrn: string | null;
  companyUrl: string | null;
  companyLogo: string | null;
  employmentType: string | null;
  location: string | null;
  description: string | null;
  timePeriod: RawTimePeriod | null;
}

export interface RawEducation {
  school: string | null;
  schoolUrn: string | null;
  schoolUrl: string | null;
  schoolLogo: string | null;
  degree: string | null;
  fieldOfStudy: string | null;
  description: string | null;
  timePeriod: RawTimePeriod | null;
  grade: string | null;
  activities: string | null;
}

export interface RawSkill {
  name: string | null;
  endorsementCount: number | null;
  category: string | null;
  url: string | null;
}

export interface RawCertification {
  name: string | null;
  issuer: string | null;
  issuerUrn: string | null;
  issuerUrl: string | null;
  issuerLogo: string | null;
  issueDate: RawDate | null;
  expirationDate: RawDate | null;
  credentialId: string | null;
  credentialUrl: string | null;
  description: string | null;
}

export interface RawLanguage {
  name: string | null;
  proficiency: string | null;
}

export interface RawCourse {
  name: string | null;
  number: string | null;
  description: string | null;
  associatedWith: string | null;
}

export interface RawProject {
  name: string | null;
  description: string | null;
  url: string | null;
  timePeriod: RawTimePeriod | null;
  associatedWith: string | null;
}

export interface RawVolunteer {
  role: string | null;
  organization: string | null;
  organizationUrn: string | null;
  organizationUrl: string | null;
  organizationLogo: string | null;
  cause: string | null;
  location: string | null;
  description: string | null;
  timePeriod: RawTimePeriod | null;
}

export interface RawAward {
  title: string | null;
  issuer: string | null;
  issueDate: RawDate | null;
  description: string | null;
}

export interface RawPublication {
  title: string | null;
  publisher: string | null;
  publicationDate: RawDate | null;
  description: string | null;
  url: string | null;
}

export interface RawPatent {
  title: string | null;
  patentNumber: string | null;
  status: string | null;
  issueDate: RawDate | null;
  inventors: string[];
  description: string | null;
  url: string | null;
}

export interface RawOrganization {
  name: string | null;
  role: string | null;
  description: string | null;
  timePeriod: RawTimePeriod | null;
  url: string | null;
}

export interface RawInterest {
  name: string | null;
  url: string | null;
  image: string | null;
}

export interface RawRecommendation {
  text: string | null;
  recommenderName: string | null;
  recommenderHeadline: string | null;
  recommenderUrl: string | null;
  recommenderImage: string | null;
  relationship: string | null;
  date: string | null;
}

export interface RawWebsite {
  url: string;
  label: string | null;
}

export interface RawSocialProfile {
  platform: string;
  url: string;
}

export interface RawContactInfo {
  websites: RawWebsite[];
  twitter: string | null;
  github: string | null;
  otherSocialProfiles: RawSocialProfile[];
}

export interface RawLinkedInProfile {
  entityUrn: string | null;
  identity: RawIdentity;
  location: RawLocation;
  about: string | null;
  profilePicture: RawImage | null;
  backgroundPicture: RawImage | null;
  gallery: RawImage[];
  experience: RawExperience[];
  education: RawEducation[];
  skills: RawSkill[];
  certifications: RawCertification[];
  languages: RawLanguage[];
  courses: RawCourse[];
  projects: RawProject[];
  volunteerExperience: RawVolunteer[];
  awards: RawAward[];
  publications: RawPublication[];
  patents: RawPatent[];
  organizations: RawOrganization[];
  interests: RawInterest[];
  recommendations: RawRecommendation[];
  contactInfo: RawContactInfo;
  connectionsCount: number | null;
  followersCount: number | null;
  openToWork: boolean | null;
  hiring: boolean | null;
}
