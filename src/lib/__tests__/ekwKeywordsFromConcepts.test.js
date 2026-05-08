/**
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { ekwKeywordsFromConcepts } from '$lib/helpers/educational/ekwKeywordsFromConcepts.js';
import { CONCEPT_KIND } from 'nostr-vocab-core/constants';

/**
 * Build a synthetic kind-39738 Concept event with a prefLabel.
 * @param {{ d: string, label: string, lang?: string }} args
 * @returns {import('nostr-tools').NostrEvent}
 */
function makeConcept({ d, label, lang = 'de' }) {
  return /** @type {any} */ ({
    id: `evt-${d}`,
    pubkey: 'ekwpub',
    kind: CONCEPT_KIND,
    created_at: 1,
    sig: '',
    tags: [
      ['d', d],
      ['type', 'Concept'],
      ['prefLabel', label, lang]
    ],
    content: ''
  });
}

describe('ekwKeywordsFromConcepts', () => {
  it('returns empty list for empty input', () => {
    expect(ekwKeywordsFromConcepts([])).toEqual([]);
  });

  it('extracts German prefLabels and returns them sorted by German locale', () => {
    const events = [
      makeConcept({ d: 'kirche/gottesdienst', label: 'Gottesdienst' }),
      makeConcept({ d: 'gott/glauben-zweifel', label: 'Glauben / Zweifel' }),
      makeConcept({ d: 'kirchenjahr/abendmahl-1', label: 'Abendmahl' })
    ];
    expect(ekwKeywordsFromConcepts(events)).toEqual([
      'Abendmahl',
      'Glauben / Zweifel',
      'Gottesdienst'
    ]);
  });

  it('deduplicates labels that appear under multiple parents (e.g. Abendmahl, Gottesdienst)', () => {
    // The published EKW keywords scheme has two distinct concept events for
    // "Abendmahl" (kirche/abendmahl + ausdrucksformen/abendmahl) and two for
    // "Gottesdienst" — same label, different d-tag/parent. The flat suggestion
    // list must dedup by label so the typeahead only shows each option once.
    const events = [
      makeConcept({ d: 'kirche/abendmahl', label: 'Abendmahl' }),
      makeConcept({ d: 'ausdrucksformen/abendmahl', label: 'Abendmahl' }),
      makeConcept({ d: 'kirche/gottesdienst', label: 'Gottesdienst' }),
      makeConcept({ d: 'ausdrucksformen/gottesdienst', label: 'Gottesdienst' })
    ];
    expect(ekwKeywordsFromConcepts(events)).toEqual(['Abendmahl', 'Gottesdienst']);
  });

  it('falls back to first prefLabel when no German label exists', () => {
    const events = [makeConcept({ d: 'foo', label: 'Christmas', lang: 'en' })];
    expect(ekwKeywordsFromConcepts(events)).toEqual(['Christmas']);
  });

  it('skips concepts with no prefLabel tags', () => {
    const noLabel = /** @type {any} */ ({
      id: 'evt-empty',
      pubkey: 'ekwpub',
      kind: CONCEPT_KIND,
      created_at: 1,
      sig: '',
      tags: [
        ['d', 'mystery'],
        ['type', 'Concept']
      ],
      content: ''
    });
    const events = [noLabel, makeConcept({ d: 'gott/trinitaet', label: 'Trinität' })];
    expect(ekwKeywordsFromConcepts(events)).toEqual(['Trinität']);
  });
});
