import { describe, it, expect } from 'vitest';
import { extractFromHtml, mergeRscSections, emptyRaw } from '../src/linkedin/extractor.js';

describe('extractFromHtml', () => {
  it('extracts name, headline, and location from the top card', () => {
    const html = `<html><head><title>Alex Rivera | LinkedIn</title></head><body>
      <p>Alex Rivera</p>
      <p>Senior Software Engineer at Acme Corp</p>
      <p>Bengaluru, Karnataka, India</p>
      <p>Contact info</p>
      </body></html>`;
    const raw = extractFromHtml(html, 'alex-rivera');
    expect(raw.identity.fullName).toBe('Alex Rivera');
    expect(raw.identity.firstName).toBe('Alex');
    expect(raw.identity.lastName).toBe('Rivera');
    expect(raw.identity.headline).toBe('Senior Software Engineer at Acme Corp');
    expect(raw.location.raw).toBe('Bengaluru, Karnataka, India');
    expect(raw.identity.publicIdentifier).toBe('alex-rivera');
  });

  it('returns null fields for a minimal page', () => {
    const raw = extractFromHtml('<title>x | LinkedIn</title>', 'x');
    expect(raw.identity.fullName).toBe('x');
    expect(raw.identity.headline).toBeNull();
    expect(raw.location.raw).toBeNull();
    expect(raw.experience).toEqual([]);
  });
});

describe('mergeRscSections', () => {
  it('extracts experience, education, skills, and languages', () => {
    const rsc = [
      ['Experience'],
      ['Software Engineer'],
      ['Acme Corp'],
      ['Education'],
      ['Indian Institute of Technology'],
      ['Bachelor of Technology'],
      ['Skills'],
      ['TypeScript'],
      ['Node.js'],
      ['Languages'],
      ['English - Professional working proficiency'],
    ]
      .map(([t]) => `["$","div",null,{"children":["${t}"]}]`)
      .join('\n');

    const raw = emptyRaw('alex-rivera');
    mergeRscSections(rsc, raw);

    expect(raw.experience).toHaveLength(1);
    expect(raw.experience[0]?.title).toBe('Software Engineer');
    expect(raw.experience[0]?.company).toBe('Acme Corp');
    expect(raw.education).toHaveLength(1);
    expect(raw.education[0]?.school).toBe('Indian Institute of Technology');
    expect(raw.skills.map((s) => s.name)).toEqual(['TypeScript', 'Node.js']);
    expect(raw.languages).toEqual([{ name: 'English', proficiency: 'Professional working proficiency' }]);
  });

  it('extracts the About body from wrapped/nested text', () => {
    const rsc = [
      '["$","div",null,{"children":["About"]}]',
      '["$","div",null,{"children":[null,"Automating the boring parts of life."]}]',
      '["$","div",null,{"children":[["$","br",null,{}],"Experimenting with self-hosted systems."]}]',
    ].join('\n');
    const raw = emptyRaw('x');
    mergeRscSections(rsc, raw);
    expect(raw.about).toContain('Automating the boring parts of life.');
    expect(raw.about).toContain('Experimenting with self-hosted systems.');
  });

  it('does not fabricate sections that are absent', () => {
    const raw = emptyRaw('x');
    mergeRscSections('["$","div",null,{"children":["Activity"]}]', raw);
    expect(raw.experience).toEqual([]);
    expect(raw.education).toEqual([]);
    expect(raw.skills).toEqual([]);
    expect(raw.about).toBeNull();
  });
});
