/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { parseExtensionTags } from '$lib/helpers/educational/parseExtensionTags.js';

describe('parseExtensionTags', () => {
  it('returns an empty namespaces map when no extension tags are present', () => {
    const event = {
      tags: [
        ['d', 'res-1'],
        ['name', 'Pythagoras'],
        ['t', 'mathematik'],
        ['about:id', 'http://w3id.org/kim/schulfaecher/s1017']
      ]
    };
    const parsed = parseExtensionTags(event);
    expect(parsed.namespaces.size).toBe(0);
  });

  it('parses an ext:ekw concept facet (id + prefLabel + type triple)', () => {
    const event = {
      tags: [
        ['ext:ekw:gradeLevel:id', 'https://edufeed.org/v/klassenstufen/5-6'],
        ['ext:ekw:gradeLevel:prefLabel:de', '5–6'],
        ['ext:ekw:gradeLevel:type', 'Concept']
      ]
    };
    const parsed = parseExtensionTags(event);

    const ekw = parsed.namespaces.get('ekw');
    expect(ekw).toBeDefined();
    const facet = ekw?.facets.get('gradeLevel');
    expect(facet?.kind).toBe('concept');
    expect(facet?.items).toEqual([
      {
        id: 'https://edufeed.org/v/klassenstufen/5-6',
        prefLabels: { de: '5–6' }
      }
    ]);
  });

  it('parses a legacy unprefixed ekw:* concept facet identically to ext:ekw:*', () => {
    const event = {
      tags: [
        ['ekw:gradeLevel:id', 'https://edufeed.org/v/klassenstufen/5-6'],
        ['ekw:gradeLevel:prefLabel:de', '5–6'],
        ['ekw:gradeLevel:type', 'Concept']
      ]
    };
    const parsed = parseExtensionTags(event);

    const ekw = parsed.namespaces.get('ekw');
    const facet = ekw?.facets.get('gradeLevel');
    expect(facet?.kind).toBe('concept');
    expect(facet?.items).toEqual([
      {
        id: 'https://edufeed.org/v/klassenstufen/5-6',
        prefLabels: { de: '5–6' }
      }
    ]);
  });

  it('preserves order and pairs prefLabels positionally for multiple concepts in the same facet', () => {
    const event = {
      tags: [
        ['ext:ekw:method:id', 'https://edufeed.org/v/methode/rollenspiel'],
        ['ext:ekw:method:prefLabel:de', 'Rollenspiel'],
        ['ext:ekw:method:type', 'Concept'],
        ['ext:ekw:method:id', 'https://edufeed.org/v/methode/diskussion'],
        ['ext:ekw:method:prefLabel:de', 'Diskussion'],
        ['ext:ekw:method:type', 'Concept']
      ]
    };
    const parsed = parseExtensionTags(event);

    const facet = parsed.namespaces.get('ekw')?.facets.get('method');
    expect(facet?.items).toEqual([
      {
        id: 'https://edufeed.org/v/methode/rollenspiel',
        prefLabels: { de: 'Rollenspiel' }
      },
      {
        id: 'https://edufeed.org/v/methode/diskussion',
        prefLabels: { de: 'Diskussion' }
      }
    ]);
  });

  it('parses a scalar facet (bare key, no :id/:prefLabel/:type)', () => {
    const event = {
      tags: [['ext:ekw:methodOther', 'Freie Methode A']]
    };
    const parsed = parseExtensionTags(event);

    const facet = parsed.namespaces.get('ekw')?.facets.get('methodOther');
    expect(facet?.kind).toBe('scalar');
    expect(facet?.items).toEqual(['Freie Methode A']);
  });

  it('joins multiple scalar tags with the same key into separate items', () => {
    const event = {
      tags: [
        ['ext:ekw:methodOther', 'Freie Methode A'],
        ['ext:ekw:methodOther', 'Freie Methode B']
      ]
    };
    const parsed = parseExtensionTags(event);

    const facet = parsed.namespaces.get('ekw')?.facets.get('methodOther');
    expect(facet?.kind).toBe('scalar');
    expect(facet?.items).toEqual(['Freie Methode A', 'Freie Methode B']);
  });

  it('ignores a form-coordinate namespace (ext:30168:<pub>:<d>:*) — surplus segments are not legal <ns>', () => {
    // `<ns>` and `<facet>` MUST NOT contain `:`, so these keys have surplus
    // segments and their segmentation is ambiguous. The normative rule is to
    // ignore them outright rather than guess — see nips/AMB.md.
    const pub = 'a'.repeat(64);
    const event = {
      tags: [
        [`ext:30168:${pub}:my-form:kompetenz:id`, 'https://example.org/komp/arg'],
        [`ext:30168:${pub}:my-form:kompetenz:prefLabel:de`, 'Argumentieren'],
        [`ext:30168:${pub}:my-form:kompetenz:type`, 'Concept'],
        [`ext:30168:${pub}:my-form:klassenstufe`, '7']
      ]
    };
    const parsed = parseExtensionTags(event);
    expect(parsed.namespaces.size).toBe(0);
  });

  it('parses form-emitted ext using the form d-tag as <ns>', () => {
    // The conformant replacement for the shape above: <ns> is the form's bare
    // `d`-tag, and the author pubkey lives in the resource's `a` back-ref.
    const event = {
      tags: [
        ['ext:my-form:kompetenz:id', 'https://example.org/komp/arg'],
        ['ext:my-form:kompetenz:prefLabel:de', 'Argumentieren'],
        ['ext:my-form:kompetenz:type', 'Concept'],
        ['ext:my-form:klassenstufe', '7']
      ]
    };
    const parsed = parseExtensionTags(event);

    const ns = parsed.namespaces.get('my-form');
    expect(ns).toBeDefined();
    expect(ns?.facets.get('kompetenz')?.kind).toBe('concept');
    expect(ns?.facets.get('kompetenz')?.items).toEqual([
      { id: 'https://example.org/komp/arg', prefLabels: { de: 'Argumentieren' } }
    ]);
    expect(ns?.facets.get('klassenstufe')?.kind).toBe('scalar');
    expect(ns?.facets.get('klassenstufe')?.items).toEqual(['7']);
  });

  it('ignores legacy surplus-segment konfi keys (no back-compat read shim)', () => {
    const parsed = parseExtensionTags({
      tags: [
        ['ext:ekw:konfi:themen:id', 'urn:t1'],
        ['ext:ekw:konfi:themen:prefLabel:de', 'Thema 1'],
        ['ext:ekw:konfi:themen:type', 'Concept']
      ]
    });
    expect(parsed.namespaces.size).toBe(0);
  });

  it('ignores an unknown sub rather than guessing at it', () => {
    const parsed = parseExtensionTags({
      tags: [['ext:ekw:gradeLevel:bogusSub', 'x']]
    });
    expect(parsed.namespaces.size).toBe(0);
  });

  it('isolates mixed namespaces in the same event', () => {
    const event = {
      tags: [
        ['ext:ekw:gradeLevel:id', 'g1'],
        ['ext:ekw:gradeLevel:prefLabel:de', 'G1'],
        ['ext:foo:bar:id', 'b1'],
        ['ext:foo:bar:prefLabel:en', 'B1']
      ]
    };
    const parsed = parseExtensionTags(event);

    expect(parsed.namespaces.has('ekw')).toBe(true);
    expect(parsed.namespaces.has('foo')).toBe(true);
    expect(parsed.namespaces.get('ekw')?.facets.has('gradeLevel')).toBe(true);
    expect(parsed.namespaces.get('foo')?.facets.has('bar')).toBe(true);
  });

  it('collects multiple prefLabel locales into one entry', () => {
    const event = {
      tags: [
        ['ext:ekw:gradeLevel:id', 'g1'],
        ['ext:ekw:gradeLevel:prefLabel:de', 'Klasse 1'],
        ['ext:ekw:gradeLevel:prefLabel:en', 'Grade 1']
      ]
    };
    const parsed = parseExtensionTags(event);

    const item = parsed.namespaces.get('ekw')?.facets.get('gradeLevel')?.items[0];
    expect(item).toMatchObject({
      id: 'g1',
      prefLabels: { de: 'Klasse 1', en: 'Grade 1' }
    });
  });

  it('ignores malformed keys without throwing', () => {
    const event = {
      tags: [
        ['ext:', 'broken'],
        ['ext:ekw:', 'broken'],
        ['ext', 'broken'],
        [''],
        ['ext:ekw:gradeLevel:id', 'g1'] // valid alongside garbage
      ]
    };
    const parsed = parseExtensionTags(event);

    // Only the valid one survived
    expect(parsed.namespaces.size).toBe(1);
    expect(parsed.namespaces.get('ekw')?.facets.get('gradeLevel')?.items).toEqual([
      { id: 'g1', prefLabels: {} }
    ]);
  });

  it('handles missing tags array safely', () => {
    expect(parseExtensionTags({}).namespaces.size).toBe(0);
    expect(parseExtensionTags({ tags: null }).namespaces.size).toBe(0);
    expect(parseExtensionTags(null).namespaces.size).toBe(0);
  });
});
