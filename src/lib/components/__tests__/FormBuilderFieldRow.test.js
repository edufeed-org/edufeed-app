/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor, cleanup } from '@testing-library/svelte';

vi.mock('$lib/paraglide/runtime.js', () => ({
  getLocale: () => 'de'
}));

// Short-circuit modules that transitively pull in app-settings (which calls
// window.matchMedia at import-time and blows up in jsdom without a stub).
vi.mock('$lib/helpers/event-factory.js', () => ({
  createAppEventFactory: () => ({
    build: async (/** @type {any} */ t) => t,
    sign: async (/** @type {any} */ t) => t
  })
}));

vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: { add: () => {}, getReplaceable: () => null },
  pool: {}
}));

vi.mock('$lib/loaders/base.js', () => ({
  addressLoader: () => ({ subscribe: () => ({ unsubscribe: () => {} }) }),
  timedPool: () => ({ subscribe: () => ({ unsubscribe: () => {} }) })
}));

vi.mock('$lib/stores/accounts.svelte', () => ({
  manager: { active: { signer: {}, pubkey: 'author-pub' } }
}));

vi.mock('$lib/paraglide/messages', () => ({
  // Labels/placeholders touched by FormBuilderFieldRow + SKOSDropdown
  skos_dropdown_select: () => 'Select...',
  skos_dropdown_search: () => 'Search...',
  skos_dropdown_no_results: () => 'No results',
  skos_dropdown_expand: () => 'Expand',
  skos_dropdown_collapse: () => 'Collapse',
  skos_loading: () => 'Loading...',
  skos_maximum_reached: () => 'Max reached',
  skos_selected: (/** @type {{ count: number }} */ { count }) => `${count} selected`,
  form_builder_field_name_placeholder: () => 'Field label',
  form_builder_field_required: () => 'Required',
  form_builder_field_placeholder_text: () => 'Placeholder',
  form_builder_field_options_label: () => 'Options',
  form_builder_field_option_new: () => 'New option',
  form_builder_add_option: () => 'Add option',
  form_builder_field_allow_multiple: () => 'Allow multiple',
  form_builder_min_value: () => 'Min',
  form_builder_max_value: () => 'Max',
  form_builder_min_length: () => 'Min length',
  form_builder_max_length: () => 'Max length',
  form_builder_field_option_placeholder: () => 'Add option',
  form_builder_field_option_add: () => 'Add',
  form_builder_field_option_remove: () => 'Remove',
  form_builder_field_multiple: () => 'Multiple',
  form_builder_field_vocab_label: () => 'Vocab',
  form_builder_field_vocab_placeholder: () => 'naddr1…',
  form_builder_field_vocab_invalid: () => 'Invalid naddr',
  form_builder_field_vocab_concepts_count: (/** @type {{ n: number }} */ { n }) => `${n} concepts`,
  form_builder_field_vocab_loading: () => 'Loading concepts…',
  form_builder_field_vocab_picker_label: () => 'Choose vocab',
  form_builder_field_vocab_picker_placeholder: () => 'Select a vocabulary',
  form_builder_field_output_label: () => 'Output',
  form_builder_field_output_auto: (/** @type {{ id: string }} */ { id }) => `auto (${id})`
}));

vi.mock('$lib/helpers/educational/skosLoader.js', () => ({
  fetchVocabulary: vi.fn(),
  getConceptLabel: (/** @type {any} */ c, /** @type {string} */ locale) =>
    c.labels?.[locale] || c.labels?.de || c.labels?.en || c.id,
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

// Two discovered schemes — one is what the test picks.
const schemeEvents = [
  {
    id: 'sch1',
    pubkey: 'a'.repeat(64),
    kind: 39737,
    tags: [
      ['d', 'schulfaecher'],
      ['type', 'ConceptScheme'],
      ['prefLabel', 'Schulfächer', 'de']
    ],
    content: '',
    sig: '',
    created_at: 0
  },
  {
    id: 'sch2',
    pubkey: 'a'.repeat(64),
    kind: 39737,
    tags: [
      ['d', 'hochschulfaecher'],
      ['type', 'ConceptScheme'],
      ['prefLabel', 'Hochschulfächersystematik', 'de']
    ],
    content: '',
    sig: '',
    created_at: 0
  }
];

vi.mock('$lib/stores/vocab-store.svelte.js', () => ({
  useConceptSchemes: () => () => schemeEvents,
  useSchemeConcepts: () => () => []
}));

vi.mock('$lib/helpers/relay-helper.js', () => ({
  getAllLookupRelays: () => ['wss://r.example']
}));

import FormBuilderFieldRow from '../forms/FormBuilderFieldRow.svelte';

/**
 * @returns {any}
 */
function makeField() {
  return {
    id: 'about',
    type: 'select',
    label: 'Fach',
    defaultValue: '',
    required: false,
    placeholder: '',
    min: undefined,
    max: undefined,
    selectOptions: [],
    multiple: false,
    output: '',
    vocab: undefined,
    vocabNaddrInput: '',
    vocabError: ''
  };
}

beforeEach(() => {
  cleanup();
  Element.prototype.scrollIntoView = vi.fn();
});

describe('FormBuilderFieldRow vocab picker', () => {
  it('renders discovered schemes inside a SKOSDropdown combobox for select fields', async () => {
    const field = makeField();
    const { container } = render(FormBuilderFieldRow, {
      props: { field, fields: [field], fieldIndex: 0, existing: false }
    });

    const trigger = /** @type {HTMLElement} */ (
      await waitFor(() => {
        const t = container.querySelector('[role="combobox"]');
        if (!t) throw new Error('combobox not found');
        return t;
      })
    );
    await fireEvent.click(trigger);

    const options = Array.from(container.querySelectorAll('[role="option"]'));
    const texts = options.map((o) => o.textContent || '');
    expect(texts.some((t) => t.includes('Schulfächer'))).toBe(true);
    expect(texts.some((t) => t.includes('Hochschulfächersystematik'))).toBe(true);
  });

  it('populates field.vocab and mirrors an naddr into the text input on selection', async () => {
    const field = makeField();
    const { container } = render(FormBuilderFieldRow, {
      props: { field, fields: [field], fieldIndex: 0, existing: false }
    });

    const trigger = /** @type {HTMLElement} */ (
      await waitFor(() => {
        const t = container.querySelector('[role="combobox"]');
        if (!t) throw new Error('combobox not found');
        return t;
      })
    );
    await fireEvent.click(trigger);

    const options = Array.from(container.querySelectorAll('[role="option"]'));
    const hochschul = /** @type {HTMLElement} */ (
      options.find((o) => o.textContent?.includes('Hochschulfächersystematik'))
    );
    const selectButton = /** @type {HTMLElement} */ (
      hochschul.querySelector('button') || hochschul
    );
    await fireEvent.click(selectButton);

    await waitFor(() => {
      expect(field.vocab).toBeTruthy();
    });

    expect(field.vocab?.address).toBe(`39737:${'a'.repeat(64)}:hochschulfaecher`);
    expect(field.vocabNaddrInput).toMatch(/^naddr1/);
    expect(field.vocabError).toBe('');
  });

  it('does not render the picker combobox for non-select fields', async () => {
    const field = makeField();
    field.type = 'text';
    const { container } = render(FormBuilderFieldRow, {
      props: { field, fields: [field], fieldIndex: 0, existing: false }
    });

    // Give any async rendering a tick.
    await Promise.resolve();

    // The vocab section (and its picker) is select/radio-only.
    expect(container.querySelector('[role="combobox"]')).toBeFalsy();
  });
});
