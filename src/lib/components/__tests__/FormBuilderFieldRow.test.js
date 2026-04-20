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
  form_builder_field_vocab_samples_label: () => 'Includes:',
  form_builder_field_vocab_clear: () => 'Change vocabulary',
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

// Two discovered schemes — one is what the test picks. Both carry a
// `published_at` tag so the helper treats them as published (non-draft).
const schemeEvents = [
  {
    id: 'sch1',
    pubkey: 'a'.repeat(64),
    kind: 39737,
    tags: [
      ['d', 'schulfaecher'],
      ['type', 'ConceptScheme'],
      ['prefLabel', 'Schulfächer', 'de'],
      ['published_at', '1710000000']
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
      ['prefLabel', 'Hochschulfächersystematik', 'de'],
      ['description', 'Systematik aller deutschen Hochschulfächer.', 'de'],
      ['published_at', '1710000000']
    ],
    content: '',
    sig: '',
    created_at: 0
  },
  // Draft scheme — intentionally missing `published_at`. The helper should
  // filter it out so it never appears in the picker combobox.
  {
    id: 'sch-draft',
    pubkey: 'a'.repeat(64),
    kind: 39737,
    tags: [
      ['d', 'entwurf-vokabular'],
      ['type', 'ConceptScheme'],
      ['prefLabel', 'Entwurf Vokabular', 'de']
    ],
    content: '',
    sig: '',
    created_at: 0
  }
];

// Fake concepts to feed the preview's sample-labels row post-selection.
const hochschulConcepts = [
  {
    id: 'c1',
    pubkey: 'a'.repeat(64),
    kind: 39737,
    tags: [
      ['d', 'mathe'],
      ['type', 'Concept'],
      ['prefLabel', 'Mathematik', 'de']
    ],
    labels: { de: 'Mathematik' },
    content: '',
    sig: '',
    created_at: 0
  },
  {
    id: 'c2',
    pubkey: 'a'.repeat(64),
    kind: 39737,
    tags: [
      ['d', 'physik'],
      ['type', 'Concept'],
      ['prefLabel', 'Physik', 'de']
    ],
    labels: { de: 'Physik' },
    content: '',
    sig: '',
    created_at: 0
  },
  {
    id: 'c3',
    pubkey: 'a'.repeat(64),
    kind: 39737,
    tags: [
      ['d', 'informatik'],
      ['type', 'Concept'],
      ['prefLabel', 'Informatik', 'de']
    ],
    labels: { de: 'Informatik' },
    content: '',
    sig: '',
    created_at: 0
  }
];

vi.mock('$lib/stores/vocab-store.svelte.js', () => ({
  useConceptSchemes: () => () => schemeEvents,
  useSchemeConcepts: (/** @type {() => string | undefined} */ getCoord) => () => {
    // Only emit concepts once a scheme has been selected — keeps the
    // pre-selection picker showing the loading state.
    return getCoord() ? hochschulConcepts : [];
  }
}));

vi.mock('$lib/helpers/relay-helper.js', () => ({
  getAllLookupRelays: () => ['wss://r.example']
}));

import FormBuilderFieldRow from '../forms/FormBuilderFieldRow.svelte';
import FormBuilderFieldRowTestWrapper from './FormBuilderFieldRowTestWrapper.svelte';

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

  it('omits draft schemes (missing published_at) from the picker combobox', async () => {
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

    const texts = Array.from(container.querySelectorAll('[role="option"]')).map(
      (o) => o.textContent || ''
    );
    expect(texts.some((t) => t.includes('Entwurf Vokabular'))).toBe(false);
    // Sanity: published schemes still show — ensures we didn't filter everything.
    expect(texts.some((t) => t.includes('Schulfächer'))).toBe(true);
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

/**
 * Render via the wrapper (which holds `field` in $state so child mutations
 * trigger reactive updates in the preview block), pick Hochschulfächersystematik,
 * and return the container plus a live snapshot accessor.
 *
 * Plain JS objects passed as props don't propagate mutations back as reactive
 * signals — we need $state-ownership at the wrapper boundary for the
 * post-selection {#if field.vocab?.address} block to render.
 * @param {any} initialField
 */
async function renderAndPickHochschul(initialField) {
  /** @type {any} */
  let latestField = initialField;
  const { container } = render(FormBuilderFieldRowTestWrapper, {
    props: {
      initialField,
      fieldIndex: 0,
      existing: false,
      onUpdate: (/** @type {any} */ f) => {
        latestField = f;
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

  const options = Array.from(container.querySelectorAll('[role="option"]'));
  const hochschul = /** @type {HTMLElement} */ (
    options.find((o) => o.textContent?.includes('Hochschulfächersystematik'))
  );
  const selectButton = /** @type {HTMLElement} */ (hochschul.querySelector('button') || hochschul);
  await fireEvent.click(selectButton);

  await waitFor(() => {
    if (!latestField.vocab) throw new Error('vocab not set yet');
  });

  return { container, getField: () => latestField };
}

describe('FormBuilderFieldRow vocab preview (post-selection)', () => {
  it('renders the scheme description after selection', async () => {
    const field = makeField();
    const { container } = await renderAndPickHochschul(field);
    await waitFor(() => {
      if (!(container.textContent || '').includes('Systematik aller deutschen Hochschulfächer.'))
        throw new Error('description not rendered yet');
    });
  });

  it('renders sample concept labels after selection', async () => {
    const field = makeField();
    const { container } = await renderAndPickHochschul(field);
    await waitFor(() => {
      const text = container.textContent || '';
      if (!text.includes('Includes:')) throw new Error('Includes: label not rendered yet');
    });
    const text = container.textContent || '';
    const anyLabel = ['Mathematik', 'Physik', 'Informatik'].some((l) => text.includes(l));
    expect(anyLabel).toBe(true);
  });

  it('clears field.vocab when the "Change vocabulary" button is clicked', async () => {
    const field = makeField();
    const { container, getField } = await renderAndPickHochschul(field);

    const clearBtn = /** @type {HTMLButtonElement} */ (
      await waitFor(() => {
        const btn = Array.from(container.querySelectorAll('button')).find((b) =>
          b.textContent?.includes('Change vocabulary')
        );
        if (!btn) throw new Error('Change vocabulary button not found');
        return btn;
      })
    );
    await fireEvent.click(clearBtn);

    await waitFor(() => {
      expect(getField().vocab).toBeUndefined();
    });
    expect(getField().vocabNaddrInput).toBe('');
    expect(getField().vocabError).toBe('');
  });
});
