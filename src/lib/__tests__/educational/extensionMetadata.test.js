/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import {
  buildExtensionSections,
  buildExtensionCards,
  extensionFacetIconKey,
  deriveChipLabel
} from '$lib/helpers/educational/extensionMetadata.js';

/**
 * @param {string[][]} tags
 * @param {any} [formEvent]
 */
const sectionsFrom = (tags, formEvent = null) => buildExtensionSections({ tags }, formEvent);

/**
 * @param {string[][]} tags
 * @param {any} [formEvent]
 * @param {string} [locale]
 */
const cardsFrom = (tags, formEvent = null, locale = 'en') =>
  buildExtensionCards(sectionsFrom(tags, formEvent), locale);

describe('extensionFacetIconKey', () => {
  it('maps known facets to semantic icon keys', () => {
    expect(extensionFacetIconKey('gradeLevel')).toBe('klassenstufe');
    expect(extensionFacetIconKey('schoolType')).toBe('schulart');
    expect(extensionFacetIconKey('didacticConcept')).toBe('didaktKonzept');
    expect(extensionFacetIconKey('method')).toBe('methode');
    expect(extensionFacetIconKey('methodOther')).toBe('methode');
    expect(extensionFacetIconKey('bibleReference')).toBe('bibelstelle');
  });

  it('falls back to the neutral tag icon for unknown facets', () => {
    expect(extensionFacetIconKey('somethingElse')).toBe('tag');
    expect(extensionFacetIconKey('')).toBe('tag');
    expect(extensionFacetIconKey(/** @type {any} */ (undefined))).toBe('tag');
  });
});

describe('deriveChipLabel', () => {
  it('strips a trailing "Metadaten" / "Metadata" word', () => {
    expect(deriveChipLabel('EKKW-Metadaten')).toBe('EKKW');
    expect(deriveChipLabel('Konfi-Arbeit-Metadaten')).toBe('Konfi-Arbeit');
    expect(deriveChipLabel('Foo Metadata')).toBe('Foo');
  });

  it('keeps the label when there is nothing to strip', () => {
    expect(deriveChipLabel('EKKW')).toBe('EKKW');
    expect(deriveChipLabel('')).toBe('');
  });
});

describe('buildExtensionSections', () => {
  it('returns nothing when the event has no extension metadata', () => {
    expect(sectionsFrom([['d', 'res-1']])).toEqual([]);
  });

  it('resolves registered EKW labels for ext:ekw:* tags (new shape)', () => {
    const sections = sectionsFrom([
      ['ext:ekw:gradeLevel:id', 'https://edufeed.org/v/klassenstufen/5-6'],
      ['ext:ekw:gradeLevel:prefLabel:de', '5–6'],
      ['ext:ekw:gradeLevel:type', 'Concept'],
      ['ext:ekw:methodOther', 'Freie Methode A'],
      ['ext:ekw:methodOther', 'Freie Methode B']
    ]);
    expect(sections).toHaveLength(1);
    expect(sections[0].sectionLabel).toMatch(/EKKW[\s-]Metadat/i);
    const grade = sections[0].facets.find((f) => f.facetName === 'gradeLevel');
    expect(grade?.label).toMatch(/Grade Level|Klassenstufe/i);
    const method = sections[0].facets.find((f) => f.facetName === 'methodOther');
    expect(method?.label).toMatch(/Method \(Free-text\)|Methode \(Freitext\)/i);
    expect(method?.scalars).toEqual(['Freie Methode A', 'Freie Methode B']);
  });

  it('treats legacy ekw:* tags identically (regression)', () => {
    const sections = sectionsFrom([
      ['ekw:gradeLevel:id', 'https://edufeed.org/v/klassenstufen/5-6'],
      ['ekw:gradeLevel:prefLabel:de', '5–6'],
      ['ekw:gradeLevel:type', 'Concept']
    ]);
    expect(sections[0].sectionLabel).toMatch(/EKKW[\s-]Metadat/i);
    expect(sections[0].facets[0].label).toMatch(/Grade Level|Klassenstufe/i);
  });

  it('humanizes facet ids for an unknown namespace with no form back-ref', () => {
    const sections = sectionsFrom([
      ['ext:foo:someFieldId:id', 'https://example.org/x'],
      ['ext:foo:someFieldId:prefLabel:de', 'Wert X'],
      ['ext:foo:someFieldId:type', 'Concept']
    ]);
    expect(sections[0].facets[0].label).toBe('Some Field Id');
  });

  it('uses the form authors field labels when a 30168 form event is supplied', () => {
    const formPubkey = 'b'.repeat(64);
    const formDTag = 'my-form';
    const coord = `30168:${formPubkey}:${formDTag}`;
    // Per the NIP-AMB grammar, form-emitted ext keys use the form's bare
    // `d`-tag as <ns> — colon-free, no pubkey. The pubkey is discoverable only
    // via the `a` back-ref below.
    const event = {
      tags: [
        ['a', coord, 'wss://relay.example', 'form'],
        [`ext:${formDTag}:kompetenzen:id`, 'https://example.org/komp/arg'],
        [`ext:${formDTag}:kompetenzen:prefLabel:de`, 'Argumentieren'],
        [`ext:${formDTag}:kompetenzen:type`, 'Concept']
      ]
    };
    const formEvent = {
      kind: 30168,
      pubkey: formPubkey,
      tags: [
        ['d', formDTag],
        ['name', 'Mein Lehrplan'],
        ['field', 'kompetenzen', 'concept', 'Kompetenzbereiche', '']
      ]
    };
    const sections = buildExtensionSections(event, formEvent);
    expect(sections[0].sectionLabel).toBe('Mein Lehrplan');
    expect(sections[0].facets[0].label).toBe('Kompetenzbereiche');
  });

  it('resolves registered Konfi labels via EXTENSION_NAMESPACE_LABELS', () => {
    const sections = sectionsFrom([
      ['ext:org.edufeed.ekw.konfi:zielgruppen:id', 'urn:ku3'],
      ['ext:org.edufeed.ekw.konfi:zielgruppen:prefLabel:de', 'KU3'],
      ['ext:org.edufeed.ekw.konfi:zielgruppen:type', 'Concept'],
      ['ext:org.edufeed.ekw.konfi:subtitle', 'Eine Einheit zur Taufe'],
      ['ext:org.edufeed.ekw.konfi:plainLanguage', 'true']
    ]);
    expect(sections[0].sectionLabel).toMatch(/Konfi-Arbeit-Metadaten|Confirmation Work Metadata/i);
    const zg = sections[0].facets.find((f) => f.facetName === 'zielgruppen');
    expect(zg?.label).toMatch(/Zielgruppen|Target groups/i);
  });
});

describe('buildExtensionCards', () => {
  it('linkifies bibleReference scalars to die-bibel.de and keeps free text plain', () => {
    const cards = cardsFrom([
      ['ext:ekw:bibleReference', 'Mt 5,3-12'],
      ['ext:ekw:bibleReference', 'Freitext-Notiz']
    ]);
    const bible = cards.find((c) => c.key.endsWith(':bibleReference'));
    expect(bible?.iconKey).toBe('bibelstelle');
    expect(bible?.scalars?.[0]).toEqual({
      text: 'Mt 5,3-12',
      href: 'https://www.die-bibel.de/bibel/LU17/MAT.5.3-12',
      long: false
    });
    expect(bible?.scalars?.[1].href).toBeUndefined();
  });

  it('carries a provenance chip derived from the section label', () => {
    const cards = cardsFrom([['ext:ekw:methodOther', 'Bibeltheater']]);
    expect(cards[0].chip).toBe('EKKW');
  });

  it('renders a boolean-true facet as a checkmark card and hides boolean-false', () => {
    const trueCards = cardsFrom([['ext:org.edufeed.ekw.konfi:plainLanguage', 'true']]);
    const flag = trueCards.find((c) => c.key.endsWith(':plainLanguage'));
    expect(flag?.iconKey).toBe('check');
    expect(flag?.value).toBe('✓');

    const falseCards = cardsFrom([['ext:org.edufeed.ekw.konfi:plainLanguage', 'false']]);
    expect(falseCards.find((c) => c.key.endsWith(':plainLanguage'))).toBeUndefined();
  });

  it('marks long values as wide so they span two columns', () => {
    const cards = cardsFrom([
      ['ext:ekw:schoolType:id', 'urn:x'],
      ['ext:ekw:schoolType:prefLabel:de', 'Gesamtschule, Hauptschule/Mittelschule, Realschule'],
      ['ext:ekw:schoolType:type', 'Concept']
    ]);
    expect(cards[0].wide).toBe(true);
  });

  it('renders BOTH halves of a mixed facet on one card (vocab picks + custom value)', () => {
    // The Konfi `allowCustom` shape. The custom value used to vanish here
    // because the facet was locked to `concept` by the leading `:id` tag.
    const NS = 'org.edufeed.ekw.konfi';
    const cards = cardsFrom([
      [`ext:${NS}:zeitstruktur:id`, 'urn:doppelstunde'],
      [`ext:${NS}:zeitstruktur:prefLabel:de`, 'Doppelstunde'],
      [`ext:${NS}:zeitstruktur:type`, 'Concept'],
      [`ext:${NS}:zeitstruktur`, '2 x 90 Min.']
    ]);

    const card = cards.find((c) => c.key.endsWith(':zeitstruktur'));
    expect(card).toBeDefined();
    expect(card?.scalars?.map((s) => s.text)).toEqual(['Doppelstunde', '2 x 90 Min.']);
  });

  it('does not classify a mixed facet as a boolean flag', () => {
    // A single 'true' scalar alongside concepts is not a boolean flag — the
    // concepts would be thrown away with it.
    const NS = 'org.edufeed.ekw.konfi';
    const cards = cardsFrom([
      [`ext:${NS}:lernformat:id`, 'urn:x'],
      [`ext:${NS}:lernformat:prefLabel:de`, 'Freizeit'],
      [`ext:${NS}:lernformat:type`, 'Concept'],
      [`ext:${NS}:lernformat`, 'true']
    ]);

    const card = cards.find((c) => c.key.endsWith(':lernformat'));
    expect(card?.value).not.toBe('✓');
    expect(card?.scalars?.map((s) => s.text)).toEqual(['Freizeit', 'true']);
  });
});
