/**
 * LearningContentFilters Component Tests
 *
 * Tests the learning content filter panel with SKOS dropdowns,
 * active filters summary, and clear functionality.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import LearningContentFilters from '../educational/LearningContentFilters.svelte';

// Mock vocab-store so ext facet chip-lists resolve concepts offline
vi.mock('$lib/stores/vocab-store.svelte.js', () => ({
  useConceptScheme: () => () => null,
  useSchemeConcepts: () => () => [
    {
      id: 'concept-active-evt',
      pubkey: 'vocabPub',
      kind: 39737,
      tags: [
        ['d', 'active'],
        ['type', 'Concept'],
        ['prefLabel', 'Aktiv', 'de'],
        ['prefLabel', 'Active', 'en'],
        ['i', 'http://purl.org/dcx/lrmi-vocabs/interactivityType/active']
      ],
      content: ''
    }
  ]
}));

vi.mock('$lib/helpers/relay-helper.js', () => ({
  getAllLookupRelays: () => ['wss://r.example'],
  getEventLoaderLookupRelays: () => []
}));

// Forms helper transitively imports event-factory which depends on app-settings
// (window.matchMedia). Stub event-factory to keep the import chain jsdom-safe.
vi.mock('$lib/helpers/event-factory.js', () => ({
  createAppEventFactory: () => ({ build: async () => ({}), sign: async () => ({}) })
}));

// Mock paraglide messages - return the key as the string
vi.mock('$lib/paraglide/messages', () => ({
  learning_filter_resource_type: () => 'Resource Type',
  learning_filter_resource_type_placeholder: () => 'Select type...',
  learning_filter_subject: () => 'Subject',
  learning_filter_subject_placeholder: () => 'Select subject...',
  learning_filter_audience: () => 'Target Audience',
  learning_filter_audience_placeholder: () => 'Select audience...',
  learning_filter_active: () => 'Active filters',
  learning_filter_search_label: () => 'Search',
  learning_filter_clear_all: () => 'Clear all',
  learning_filter_ext_heading: () => 'Additional filters',
  skos_dropdown_select: () => 'Select...',
  skos_dropdown_search: () => 'Search...',
  skos_dropdown_no_results: () => 'No results found',
  skos_dropdown_expand: () => 'Expand',
  skos_dropdown_collapse: () => 'Collapse',
  skos_loading: () => 'Loading...',
  skos_maximum_reached: () => 'Maximum reached',
  skos_selected: (/** @type {{ count: number }} */ { count }) => `${count} selected`
}));

// Mock paraglide runtime
vi.mock('$lib/paraglide/runtime.js', () => ({
  getLocale: () => 'en'
}));

// Mock SKOS loader to avoid network calls
vi.mock('$lib/helpers/educational/skosLoader.js', () => ({
  fetchVocabulary: vi.fn().mockResolvedValue([
    { id: 'https://example.com/text', prefLabel: { en: 'Text' }, level: 0 },
    { id: 'https://example.com/video', prefLabel: { en: 'Video' }, level: 0 }
  ]),
  getConceptLabel: (/** @type {any} */ concept, /** @type {any} */ locale) =>
    concept.prefLabel?.[locale] || concept.id,
  sortConceptsByLabel: (/** @type {any} */ concepts) => concepts,
  filterConcepts: (/** @type {any} */ concepts) => concepts
}));

describe('LearningContentFilters', () => {
  it('renders with a 2-column grid for the active dropdowns', () => {
    const { container } = render(LearningContentFilters, {
      props: {
        onfilterchange: vi.fn()
      }
    });

    // Should have a grid container
    const grid = /** @type {HTMLElement} */ (container.querySelector('.grid'));
    expect(grid).toBeTruthy();
    // Should be 2 columns (not 3, since audience is disabled)
    expect(grid.classList.contains('md:grid-cols-2')).toBe(true);
  });

  it('renders Resource Type and Subject dropdowns', () => {
    const { container } = render(LearningContentFilters, {
      props: {
        onfilterchange: vi.fn()
      }
    });

    // Should have exactly 2 form-control wrappers (one per active dropdown)
    const formControls = container.querySelectorAll('.form-control');
    expect(formControls.length).toBe(2);
  });

  it('shows active filters summary when searchText is provided', async () => {
    const { container } = render(LearningContentFilters, {
      props: {
        onfilterchange: vi.fn(),
        searchText: 'mathematics'
      }
    });

    // Should show the active filters summary bar
    const summary = container.querySelector('.bg-base-200');
    expect(summary).toBeTruthy();

    // Should display the search text
    const searchBadge = /** @type {HTMLElement} */ (container.querySelector('.badge-outline'));
    expect(searchBadge).toBeTruthy();
    expect(searchBadge.textContent).toContain('mathematics');
  });

  it('does not show active filters summary when no filters active', () => {
    const { container } = render(LearningContentFilters, {
      props: {
        onfilterchange: vi.fn(),
        searchText: ''
      }
    });

    // Should NOT show the active filters summary
    const summary = container.querySelector('.bg-base-200');
    expect(summary).toBeFalsy();
  });
});

/** @type {import('nostr-tools').NostrEvent} */
const extFormEvent = {
  id: 'form-evt',
  kind: 30168,
  pubkey: 'formPub',
  sig: '',
  content: '',
  created_at: 0,
  tags: [
    ['d', 'amb-full'],
    ['name', 'AMB Full'],
    [
      'field',
      'interactivityType',
      'select',
      'Interaktivität',
      '',
      JSON.stringify({ required: false })
    ],
    [
      'field-vocab',
      'interactivityType',
      'a',
      '39737:vocabPub:interactivity-type',
      'wss://r.example'
    ],
    ['field-output', 'interactivityType', 'ext']
  ]
};

describe('LearningContentFilters ext facets (Phase D)', () => {
  it('renders no ext section when no form prop is provided', () => {
    render(LearningContentFilters, {
      props: {
        onfilterchange: vi.fn()
      }
    });
    expect(screen.queryByTestId('ext-facet-section')).toBeNull();
  });

  it('renders an ext facet chip for each vocab-bound ext concept', async () => {
    render(LearningContentFilters, {
      props: {
        form: extFormEvent,
        onfilterchange: vi.fn()
      }
    });
    const section = await screen.findByTestId('ext-facet-section');
    expect(section).toBeTruthy();
    const chip = await screen.findByText('Active');
    expect(chip).toBeTruthy();
  });

  it('emits extFields with the concept URI when a chip is toggled', async () => {
    /** @type {any} */
    let lastFilters = null;
    render(LearningContentFilters, {
      props: {
        form: extFormEvent,
        onfilterchange: (/** @type {any} */ f) => {
          lastFilters = f;
        }
      }
    });

    const chip = await screen.findByText('Active');
    await fireEvent.click(chip);

    expect(lastFilters).toBeTruthy();
    expect(lastFilters.extFields).toBeTruthy();
    const key = '30168:formPub:amb-full:interactivityType';
    expect(lastFilters.extFields[key]).toEqual([
      { id: 'http://purl.org/dcx/lrmi-vocabs/interactivityType/active' }
    ]);
  });
});
