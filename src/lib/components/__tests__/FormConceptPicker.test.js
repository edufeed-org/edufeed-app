/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor, cleanup } from '@testing-library/svelte';

// Paraglide runtime used by both FormConceptPicker (locale) and SKOSDropdown.
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
  skos_selected: (/** @type {{ count: number }} */ { count }) => `${count} selected`
}));

// skosLoader is imported by SKOSDropdown. The FormConceptPicker path never calls
// fetchVocabulary (concepts are passed in via prop), so the mock just needs to
// exist for the module to import and provide usable label/filter helpers.
vi.mock('$lib/helpers/educational/skosLoader.js', () => ({
  fetchVocabulary: vi.fn(),
  getConceptLabel: (/** @type {any} */ concept, /** @type {string} */ locale) =>
    concept.labels?.[locale] || concept.labels?.de || concept.labels?.en || concept.id,
  sortConceptsByLabel: (/** @type {any[]} */ concepts) => concepts,
  filterConcepts: (
    /** @type {any[]} */ concepts,
    /** @type {string} */ searchTerm,
    /** @type {string} */ locale
  ) => {
    if (!searchTerm?.trim()) return concepts;
    const term = searchTerm.toLowerCase().trim();
    return concepts.filter((/** @type {any} */ c) => {
      const label = c.labels?.[locale] || c.labels?.de || c.labels?.en || c.id;
      return label.toLowerCase().includes(term);
    });
  }
}));

// Nostr-side vocab hooks: return a scheme + a two-concept list.
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
      kind: 39737,
      tags: [
        ['d', 's1017'],
        ['type', 'Concept'],
        ['prefLabel', 'Mathematik', 'de'],
        ['prefLabel', 'Mathematics', 'en'],
        ['i', 'https://w3id.org/kim/schulfaecher/s1017']
      ],
      content: ''
    },
    {
      id: 'c2',
      pubkey: 'pub',
      kind: 39737,
      tags: [
        ['d', 's1002'],
        ['type', 'Concept'],
        ['prefLabel', 'Biologie', 'de'],
        ['i', 'https://w3id.org/kim/schulfaecher/s1002']
      ],
      content: ''
    }
  ]
}));

vi.mock('$lib/helpers/relay-helper.js', () => ({
  getAllLookupRelays: () => ['wss://r.example']
}));

import FormConceptPicker from '../forms/FormConceptPicker.svelte';

const fieldFixture = {
  id: 'about',
  type: 'select',
  label: 'Fach',
  output: 'amb:about',
  vocab: { address: '39737:pub:schulfaecher', relay: 'wss://r.example' }
};

beforeEach(() => {
  cleanup();
  Element.prototype.scrollIntoView = vi.fn();
});

describe('FormConceptPicker', () => {
  it('renders the bound concepts inside a SKOSDropdown trigger', async () => {
    const { container } = render(FormConceptPicker, {
      props: { field: fieldFixture, value: [], multiple: true }
    });

    const trigger = /** @type {HTMLElement} */ (
      await waitFor(() => {
        const t = container.querySelector('[role="combobox"]');
        if (!t) throw new Error('combobox not found');
        return t;
      })
    );
    expect(trigger).toBeTruthy();

    await fireEvent.click(trigger);

    const options = container.querySelectorAll('[role="option"]');
    expect(options.length).toBe(2);
    expect(options[0].textContent).toContain('Mathematik');
    expect(options[1].textContent).toContain('Biologie');
  });

  it('emits the rich SelectedConcept shape when an option is chosen', async () => {
    /** @type {any[]} */
    let selected = [];
    const { container } = render(FormConceptPicker, {
      props: {
        field: fieldFixture,
        value: [],
        multiple: true,
        onchange: (/** @type {any[]} */ v) => {
          selected = v;
        }
      }
    });

    const trigger = /** @type {HTMLElement} */ (
      await waitFor(() => {
        const t = container.querySelector('[role="combobox"]');
        if (!t) throw new Error('combobox not found');
        return t;
      })
    );
    await fireEvent.click(trigger);

    // Click the Mathematik option (use the inner button for the selection)
    const options = Array.from(container.querySelectorAll('[role="option"]'));
    const mathOption = /** @type {HTMLElement} */ (
      options.find((o) => o.textContent?.includes('Mathematik'))
    );
    const selectButton = /** @type {HTMLElement} */ (
      mathOption.querySelector('button') || mathOption
    );
    await fireEvent.click(selectButton);

    expect(selected.length).toBe(1);
    expect(selected[0]).toMatchObject({
      id: 'https://w3id.org/kim/schulfaecher/s1017',
      nostrCoord: '39737:pub:s1017',
      relay: 'wss://r.example',
      labels: { de: 'Mathematik', en: 'Mathematics' }
    });
  });

  it('disables the trigger when disabled prop is true', async () => {
    const { container } = render(FormConceptPicker, {
      props: { field: fieldFixture, value: [], multiple: true, disabled: true }
    });

    const trigger = /** @type {HTMLButtonElement} */ (
      await waitFor(() => {
        const t = container.querySelector('[role="combobox"]');
        if (!t) throw new Error('combobox not found');
        return t;
      })
    );

    expect(trigger.disabled).toBe(true);
    expect(trigger.classList.contains('select-disabled')).toBe(true);

    // Clicking a disabled trigger should not open the listbox.
    await fireEvent.click(trigger);
    expect(container.querySelector('[role="listbox"]')).toBeFalsy();
  });

  it('shows incoming value as selected badges via the dropdown trigger', async () => {
    const { container } = render(FormConceptPicker, {
      props: {
        field: fieldFixture,
        multiple: true,
        value: [
          {
            id: 'https://w3id.org/kim/schulfaecher/s1017',
            nostrCoord: '39737:pub:s1017',
            relay: 'wss://r.example',
            labels: { de: 'Mathematik', en: 'Mathematics' }
          }
        ]
      }
    });

    const trigger = /** @type {HTMLElement} */ (
      await waitFor(() => {
        const t = container.querySelector('[role="combobox"]');
        if (!t) throw new Error('combobox not found');
        return t;
      })
    );

    expect(trigger.textContent).toContain('Mathematik');
  });
});
