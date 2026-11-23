/**
 * @vitest-environment node
 *
 * The concept URIs the app mints (https://edufeed.org/ns/educationalLevel#…)
 * must resolve: HTML for people, JSON-LD or Turtle for machines.
 */
import { describe, it, expect } from 'vitest';
import {
  EDUCATIONAL_LEVEL_SCHEME,
  negotiate,
  toJsonLd,
  toTurtle,
  toHtml
} from '../skos-namespace.js';
import { BILDUNGSBEREICHE } from '$lib/helpers/educational/bildungsbereich.js';

const ID = 'https://edufeed.org/ns/educationalLevel#erwachsenenbildung';
const FORTBILDUNG = 'https://w3id.org/kim/educationalLevel/level_C';

describe('educationalLevel namespace document', () => {
  it('describes every level the form can write under the namespace', () => {
    const offered = Object.values(BILDUNGSBEREICHE).flatMap(
      (b) => b.extraEducationalLevels?.map((c) => c.id) ?? []
    );
    expect(EDUCATIONAL_LEVEL_SCHEME.concepts.map((c) => c.id)).toEqual(offered);
    expect(offered).toEqual([ID]);
  });

  it('JSON-LD: a ConceptScheme and the concept with labels, definition and closeMatch', () => {
    const doc = toJsonLd(EDUCATIONAL_LEVEL_SCHEME);
    const graph = /** @type {any[]} */ (doc['@graph']);
    expect(graph[0]).toMatchObject({
      id: 'https://edufeed.org/ns/educationalLevel',
      type: 'ConceptScheme',
      hasTopConcept: [ID]
    });
    expect(graph[1]).toMatchObject({
      id: ID,
      type: 'Concept',
      prefLabel: { de: 'Erwachsenenbildung', en: 'Adult education' },
      inScheme: 'https://edufeed.org/ns/educationalLevel',
      closeMatch: [FORTBILDUNG]
    });
    expect(graph[1].definition.de).toBeTruthy();
  });

  it('Turtle: the same statements', () => {
    const ttl = toTurtle(EDUCATIONAL_LEVEL_SCHEME);
    expect(ttl).toContain('@prefix skos: <http://www.w3.org/2004/02/skos/core#> .');
    expect(ttl).toContain(`<${ID}> a skos:Concept ;`);
    expect(ttl).toContain('skos:prefLabel "Erwachsenenbildung"@de, "Adult education"@en ;');
    expect(ttl).toContain(`skos:closeMatch <${FORTBILDUNG}> ;`);
  });

  it('HTML: an anchor per concept so the hash URI lands on it, and the JSON-LD embedded', () => {
    const html = toHtml(EDUCATIONAL_LEVEL_SCHEME);
    expect(html).toContain('id="erwachsenenbildung"');
    expect(html).toContain('Erwachsenenbildung');
    expect(html).toContain('<script type="application/ld+json">');
    expect(html).toContain(`href="${FORTBILDUNG}"`);
  });

  it('escapes text in HTML and Turtle', () => {
    const scheme = {
      ...EDUCATIONAL_LEVEL_SCHEME,
      concepts: [{ id: ID, labels: { de: 'A "<b>" & B' }, definition: {}, closeMatch: [] }]
    };
    expect(toHtml(scheme)).toContain('A &quot;&lt;b&gt;&quot; &amp; B');
    expect(toTurtle(scheme)).toContain('"A \\"<b>\\" & B"@de');
  });

  it('negotiates by Accept header, HTML by default', () => {
    expect(negotiate('text/html,application/xhtml+xml')).toBe('html');
    expect(negotiate(null)).toBe('html');
    expect(negotiate('*/*')).toBe('html');
    expect(negotiate('application/ld+json')).toBe('jsonld');
    expect(negotiate('application/json')).toBe('jsonld');
    expect(negotiate('text/turtle, application/ld+json;q=0.5')).toBe('turtle');
  });
});
