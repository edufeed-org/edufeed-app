/**
 * EducatorContextFields Component Tests — the "Pädagogischer Kontext" block
 * (Bildungsbereich, conditional subjects vocab pickers, interests) used in
 * both the profile edit modal and the signup wizard.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor, cleanup } from '@testing-library/svelte';
import { CONCEPT_KIND } from 'nostr-vocab-core/constants';
import { BILDUNGSBEREICH_NAMESPACE_IRI } from '../../helpers/educational/bildungsbereichNamespace.js';

vi.mock('$lib/paraglide/runtime.js', () => ({
  getLocale: () => 'de'
}));

vi.mock('$lib/paraglide/messages', () => ({
  skos_dropdown_select: () => 'Select...',
  skos_dropdown_search: () => 'Search...',
  skos_dropdown_no_results: () => 'No results found',
  skos_dropdown_expand: () => 'Expand',
  skos_dropdown_collapse: () => 'Collapse',
  skos_loading: () => 'Loading...',
  skos_maximum_reached: () => 'Maximum reached',
  skos_selected: (/** @type {{ count: number }} */ { count }) => `${count} selected`,
  interests_placeholder: () => 'Interesse eingeben',
  interests_remove: (/** @type {{ name: string }} */ { name }) => `${name} entfernen`,
  educator_context_levels_label: () => 'Bildungsbereich',
  educator_context_subjects_label: () => 'Fächer',
  educator_context_interests_label: () => 'Interessen',
  educator_context_places_label: () => 'Orte',
  educator_context_places_help: () => 'Hilft lokal zu vernetzen',
  places_input_label: () => 'Orte',
  places_input_placeholder: () => 'Ort suchen...',
  places_input_remove_aria: (/** @type {{name: string}} */ p) => `Ort ${p.name} entfernen`,
  location_input_loading: () => 'Lade...'
}));

vi.mock('$lib/helpers/educational/skosLoader.js', () => ({
  fetchVocabulary: vi.fn(),
  getConceptLabel: (/** @type {any} */ concept, /** @type {string} */ locale) =>
    concept.labels?.[locale] || concept.labels?.de || concept.labels?.en || concept.id,
  sortConceptsByLabel: (/** @type {any[]} */ concepts) => concepts,
  filterConcepts: (/** @type {any[]} */ concepts) => concepts
}));

// Nostr-side vocab hooks used by FormConceptPicker: one scheme, two concepts.
vi.mock('$lib/stores/vocab-store.svelte.js', () => ({
  useConceptScheme: () => () => ({
    id: 'scheme-evt-id',
    pubkey: 'pub',
    kind: 39737,
    tags: [
      ['d', 'schulfaecher'],
      ['type', 'ConceptScheme'],
      ['prefLabel', 'Schulfächer', 'de']
    ],
    content: ''
  }),
  useSchemeConcepts: () => () => [
    {
      id: 'c1',
      pubkey: 'pub',
      kind: CONCEPT_KIND,
      tags: [
        ['d', 's1017'],
        ['type', 'Concept'],
        ['prefLabel', 'Mathematik', 'de'],
        ['prefLabel', 'Mathematics', 'en'],
        ['i', 'https://w3id.org/kim/schulfaecher/s1017']
      ],
      content: ''
    }
  ]
}));

vi.mock('$lib/helpers/relay-helper.js', () => ({
  getAllLookupRelays: () => ['wss://r.example'],
  getEventLoaderLookupRelays: () => []
}));

vi.mock('$lib/helpers/educational/vocabResolver.js', () => ({
  resolveVocabField: (/** @type {string} */ key) => ({
    type: 'concept-picker',
    id: key,
    label: key,
    vocab: { address: `39737:pub:${key}`, relay: 'wss://r.example' }
  })
}));

import EducatorContextFields from '../shared/EducatorContextFields.svelte';

const EMPTY = { interests: [], educationalLevels: [], subjects: [] };
const SCHULE = {
  id: `${BILDUNGSBEREICH_NAMESPACE_IRI}schule`,
  prefLabel: { de: 'Schule', en: 'School' }
};
const EXTRA = {
  id: `${BILDUNGSBEREICH_NAMESPACE_IRI}extra`,
  prefLabel: { de: 'Extra-Institutionell', en: 'Informal / Continuing Education' }
};

beforeEach(() => {
  cleanup();
  Element.prototype.scrollIntoView = vi.fn();
});

/** @param {HTMLElement} container */
function comboboxes(container) {
  return Array.from(container.querySelectorAll('[role="combobox"]'));
}

describe('EducatorContextFields', () => {
  it('renders the Bildungsbereich dropdown with all Bildungsbereiche', async () => {
    const { container } = render(EducatorContextFields, {
      props: { value: EMPTY, onchange: vi.fn() }
    });

    const [levels] = comboboxes(/** @type {HTMLElement} */ (container));
    expect(levels).toBeTruthy();
    await fireEvent.click(levels);

    const options = Array.from(container.querySelectorAll('[role="option"]'));
    expect(options.length).toBe(4);
    expect(options.map((o) => o.textContent).join(' ')).toContain('Schule');
  });

  it('shows no subjects picker when no Bildungsbereich is selected', () => {
    const { container } = render(EducatorContextFields, {
      props: { value: EMPTY, onchange: vi.fn() }
    });

    expect(comboboxes(/** @type {HTMLElement} */ (container)).length).toBe(1);
  });

  it('emits the namespaced level concept when a Bildungsbereich is picked', async () => {
    const onchange = vi.fn();
    const { container } = render(EducatorContextFields, {
      props: { value: { ...EMPTY, interests: ['Klettern'] }, onchange }
    });

    const [levels] = comboboxes(/** @type {HTMLElement} */ (container));
    await fireEvent.click(levels);
    const schuleOption = Array.from(container.querySelectorAll('[role="option"]')).find((o) =>
      o.textContent?.includes('Schule')
    );
    expect(schuleOption).toBeTruthy();
    const button = /** @type {HTMLElement} */ (
      schuleOption?.querySelector('button') || schuleOption
    );
    await fireEvent.click(button);

    expect(onchange).toHaveBeenCalledWith({
      interests: ['Klettern'],
      educationalLevels: [SCHULE],
      subjects: []
    });
  });

  it('renders one subjects picker for the schule level', async () => {
    const { container } = render(EducatorContextFields, {
      props: { value: { ...EMPTY, educationalLevels: [SCHULE] }, onchange: vi.fn() }
    });

    await waitFor(() => {
      if (comboboxes(/** @type {HTMLElement} */ (container)).length !== 2) {
        throw new Error('subjects picker not rendered yet');
      }
    });
  });

  it('renders two subject pickers for the extra level', async () => {
    const { container } = render(EducatorContextFields, {
      props: { value: { ...EMPTY, educationalLevels: [EXTRA] }, onchange: vi.fn() }
    });

    await waitFor(() => {
      if (comboboxes(/** @type {HTMLElement} */ (container)).length !== 3) {
        throw new Error('both subject pickers not rendered yet');
      }
    });
  });

  it('merges a picked subject back with its vocab key', async () => {
    const onchange = vi.fn();
    const { container } = render(EducatorContextFields, {
      props: { value: { ...EMPTY, educationalLevels: [SCHULE] }, onchange }
    });

    await waitFor(() => {
      if (comboboxes(/** @type {HTMLElement} */ (container)).length !== 2) {
        throw new Error('subjects picker not rendered yet');
      }
    });
    const subjectsTrigger = /** @type {HTMLElement} */ (
      comboboxes(/** @type {HTMLElement} */ (container))[1]
    );
    await fireEvent.click(subjectsTrigger);

    const mathOption = Array.from(container.querySelectorAll('[role="option"]')).find((o) =>
      o.textContent?.includes('Mathematik')
    );
    expect(mathOption).toBeTruthy();
    const button = /** @type {HTMLElement} */ (mathOption?.querySelector('button') || mathOption);
    await fireEvent.click(button);

    expect(onchange).toHaveBeenCalledWith({
      interests: [],
      educationalLevels: [SCHULE],
      subjects: [
        {
          id: 'https://w3id.org/kim/schulfaecher/s1017',
          prefLabel: { de: 'Mathematik', en: 'Mathematics' },
          vocab: 'schulfaecher'
        }
      ]
    });
  });

  it('emits updated interests while preserving levels and subjects', async () => {
    const onchange = vi.fn();
    const subjects = [
      {
        id: 'https://w3id.org/kim/schulfaecher/s1017',
        prefLabel: { de: 'Mathematik' },
        vocab: 'schulfaecher'
      }
    ];
    const { container } = render(EducatorContextFields, {
      props: {
        value: { interests: ['Klettern'], educationalLevels: [SCHULE], subjects },
        onchange
      }
    });

    const input = /** @type {HTMLInputElement} */ (
      container.querySelector('input[placeholder="Interesse eingeben"]')
    );
    expect(input).toBeTruthy();
    await fireEvent.input(input, { target: { value: 'Podcasts' } });
    await fireEvent.keyDown(input, { key: 'Enter' });

    expect(onchange).toHaveBeenCalledWith({
      interests: ['Klettern', 'Podcasts'],
      educationalLevels: [SCHULE],
      subjects
    });
  });
});
