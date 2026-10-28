/**
 * Subject picker group on wizard step 4. Validation needs ONE subject across
 * all Bildungsbereich vocabs (validateWizardStep: `subjectsCount === 0`), so
 * with two vocabs (Extra-Institutionell: Schule + Hochschule) the group must
 * read as one required field, not as two — a user took two asterisks as
 * "both required" (prod report 2026-10-28).
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';

vi.mock('$lib/paraglide/runtime.js', () => ({ getLocale: () => 'de' }));
vi.mock('$lib/paraglide/messages', () => ({
  amb_form_label_subject: () => 'Fach / Thema',
  amb_form_help_subject_one_of: () => 'EINES_REICHT',
  amb_form_help_subject_pick_bildungsbereich: () => 'BEREICH_WAEHLEN',
  skos_dropdown_select: () => 'Auswählen…',
  skos_dropdown_search: () => 'Suchen…',
  skos_dropdown_no_results: () => 'Keine Treffer',
  skos_dropdown_expand: () => 'Aufklappen',
  skos_dropdown_collapse: () => 'Zuklappen',
  skos_loading: () => 'Lädt…',
  skos_maximum_reached: () => 'Maximum erreicht',
  skos_selected: (/** @type {{ count: number }} */ { count }) => `${count} ausgewählt`
}));
vi.mock('$lib/helpers/educational/skosLoader.js', () => ({
  fetchVocabulary: vi.fn(),
  getConceptLabel: (/** @type {any} */ c, /** @type {string} */ locale) =>
    c.labels?.[locale] || c.labels?.de || c.id,
  sortConceptsByLabel: (/** @type {any[]} */ c) => c,
  filterConcepts: (/** @type {any[]} */ c) => c
}));
vi.mock('$lib/stores/vocab-store.svelte.js', () => ({
  useConceptScheme: () => () => null,
  useSchemeConcepts: () => () => []
}));
vi.mock('$lib/helpers/relay-helper.js', () => ({
  getAllLookupRelays: () => ['wss://r.example'],
  getEventLoaderLookupRelays: () => []
}));

import SubjectVocabPickers from '$lib/components/educational/SubjectVocabPickers.svelte';

const PK = 'd2689e2f41dabfba953da26655a94ce2aa4e029c383ee921c6a4deafab99a612';
/** @param {string} d */
const field = (d) => ({
  id: d,
  type: 'select',
  label: d,
  output: 'amb:about',
  vocab: { address: `39737:${PK}:${d}`, relay: 'wss://r.example' }
});
const SCHULE = { key: 'schulfaecher', field: field('schulfaecher') };
const HOCHSCHULE = { key: 'hochschulfaecher', field: field('hochschulfaecher') };

const asterisks = (/** @type {HTMLElement} */ c) =>
  Array.from(c.querySelectorAll('.text-error')).filter((el) => el.textContent?.trim() === '*');

beforeEach(() => {
  cleanup();
  Element.prototype.scrollIntoView = vi.fn();
});

describe('SubjectVocabPickers', () => {
  it('one vocab: a single required label, no one-of hint', () => {
    const { container, queryByText } = render(SubjectVocabPickers, {
      props: { fields: [SCHULE], valuesByKey: {}, onchange: () => {} }
    });
    expect(container.querySelectorAll('[role="combobox"]')).toHaveLength(1);
    expect(asterisks(container)).toHaveLength(1);
    expect(queryByText('EINES_REICHT')).toBeNull();
  });

  it('two vocabs: ONE required marker for the group, the one-of hint, and captions per picker', () => {
    const { container, getByText } = render(SubjectVocabPickers, {
      props: { fields: [SCHULE, HOCHSCHULE], valuesByKey: {}, onchange: () => {} }
    });
    expect(container.querySelectorAll('[role="combobox"]')).toHaveLength(2);
    expect(asterisks(container)).toHaveLength(1);
    expect(getByText('EINES_REICHT')).toBeTruthy();
    expect(getByText('Schule')).toBeTruthy();
    expect(getByText('Hochschule')).toBeTruthy();
  });

  it('no vocab: tells the user to pick a Bildungsbereich in step 1', () => {
    const { container, getByText } = render(SubjectVocabPickers, {
      props: { fields: [], valuesByKey: {}, onchange: () => {} }
    });
    expect(container.querySelectorAll('[role="combobox"]')).toHaveLength(0);
    expect(getByText('BEREICH_WAEHLEN')).toBeTruthy();
  });

  it('shows the shared error once below the group', () => {
    const { getAllByText } = render(SubjectVocabPickers, {
      props: { fields: [SCHULE, HOCHSCHULE], valuesByKey: {}, onchange: () => {}, error: 'FEHLT' }
    });
    expect(getAllByText('FEHLT')).toHaveLength(1);
  });
});
