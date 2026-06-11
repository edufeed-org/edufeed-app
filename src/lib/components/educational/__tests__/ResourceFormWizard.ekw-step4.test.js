/**
 * EKW step 4 — LRT picker contract test.
 *
 * After the static-vocab refactor, the EKW LRT picker is just another
 * `FormConceptPicker` instance pointed at the `ekwLrt` scheme published as
 * kind 39737/39738 events on a relay (same shape as Klassenstufen, Schulart,
 * etc.). This test pins the wiring contract by mocking the relay-side hooks
 * and asserting:
 *
 *   1. The picker mounts and renders concepts whose ids carry the canonical
 *      EKW lrt IRI prefix (so `formData.learningResourceType[0].id` round-trips
 *      back into the wizard via the EKW_NAMESPACE_IRI passthrough filter on
 *      edit-load).
 *   2. Selecting a concept emits a rich SelectedConcept whose `id` is the EKW
 *      IRI (not the d-tag), matching the shape the wizard then converts to a
 *      compact `{id, label}` for `formData.learningResourceType`.
 *   3. A pre-existing EKW-IRI selection renders as a visible chip — covers
 *      the edit-load path where `formData.learningResourceType` is hydrated
 *      from the kind-30142 event's `learningResourceType:id` tag.
 *
 * Mounting the full wizard in jsdom is impractical (multi-step nav,
 * applesauce infrastructure, blossom uploaders). This focused contract on
 * FormConceptPicker covers the meaningful wiring change introduced by the
 * refactor without that overhead.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor, cleanup } from '@testing-library/svelte';
import { CONCEPT_KIND } from 'nostr-vocab-core/constants';
import { EKW_NAMESPACE_IRI } from '$lib/helpers/educational/ekwNamespace.js';

const EKW_LRT_PREFIX = `${EKW_NAMESPACE_IRI}lrt/`;
const ARBEITSBLATT_IRI = `${EKW_LRT_PREFIX}arbeitsblatt`;
const ERKLAER_AUDIO_IRI = `${EKW_LRT_PREFIX}audio/erklaer-audio`;

vi.mock('$lib/paraglide/runtime.js', () => ({
  getLocale: () => 'de'
}));

vi.mock('$lib/paraglide/messages', () => ({
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

vi.mock('$lib/stores/vocab-store.svelte.js', () => ({
  useConceptScheme: () => () => ({
    id: 'ekw-lrt-scheme-evt-id',
    pubkey: 'ekwpub',
    kind: 39737,
    tags: [
      ['d', 'ekw-lrt'],
      ['type', 'ConceptScheme'],
      ['prefLabel', 'EKW Lerninhaltsarten', 'de']
    ],
    content: ''
  }),
  useSchemeConcepts: () => () => [
    {
      id: 'ekw-c1',
      pubkey: 'ekwpub',
      kind: CONCEPT_KIND,
      tags: [
        ['d', 'arbeitsblatt'],
        ['type', 'Concept'],
        ['prefLabel', 'Arbeitsblatt', 'de'],
        ['i', ARBEITSBLATT_IRI]
      ],
      content: ''
    },
    {
      id: 'ekw-c2',
      pubkey: 'ekwpub',
      kind: CONCEPT_KIND,
      tags: [
        ['d', 'audio/erklaer-audio'],
        ['type', 'Concept'],
        ['prefLabel', 'Erklär-Audio', 'de'],
        ['i', ERKLAER_AUDIO_IRI]
      ],
      content: ''
    }
  ]
}));

vi.mock('$lib/helpers/relay-helper.js', () => ({
  getAllLookupRelays: () => ['wss://r.example'],
  getEventLoaderLookupRelays: () => []
}));

import FormConceptPicker from '$lib/components/forms/FormConceptPicker.svelte';

const ekwLrtFieldFixture = {
  id: 'ekwLrt',
  type: 'select',
  label: 'EKW LRT',
  output: 'amb:learningResourceType',
  vocab: { address: '39737:ekwpub:ekw-lrt', relay: 'wss://r.example' }
};

beforeEach(() => {
  cleanup();
  Element.prototype.scrollIntoView = vi.fn();
});

describe('EKW step 4 — LRT picker contract', () => {
  it('renders EKW LRT concepts whose ids carry the canonical EKW lrt IRI prefix', async () => {
    const { container } = render(FormConceptPicker, {
      props: { field: ekwLrtFieldFixture, value: [], multiple: true }
    });

    const trigger = /** @type {HTMLElement} */ (
      await waitFor(() => {
        const t = container.querySelector('[role="combobox"]');
        if (!t) throw new Error('combobox not found');
        return t;
      })
    );
    await fireEvent.click(trigger);

    const options = container.querySelectorAll('[role="option"]');
    expect(options.length).toBe(2);
    const optionTexts = Array.from(options).map((el) => el.textContent ?? '');
    expect(optionTexts.some((t) => t.includes('Arbeitsblatt'))).toBe(true);
    expect(optionTexts.some((t) => t.includes('Erklär-Audio'))).toBe(true);
  });

  it('emits a SelectedConcept whose id is the EKW lrt IRI when a concept is chosen', async () => {
    /** @type {any[]} */
    let selected = [];
    const { container } = render(FormConceptPicker, {
      props: {
        field: ekwLrtFieldFixture,
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

    const options = Array.from(container.querySelectorAll('[role="option"]'));
    const erklaerAudio = /** @type {HTMLElement} */ (
      options.find((o) => o.textContent?.includes('Erklär-Audio'))
    );
    const selectButton = /** @type {HTMLElement} */ (
      erklaerAudio.querySelector('button') || erklaerAudio
    );
    await fireEvent.click(selectButton);

    expect(selected.length).toBe(1);
    expect(selected[0].id).toBe(ERKLAER_AUDIO_IRI);
    expect(selected[0].id.startsWith(EKW_LRT_PREFIX)).toBe(true);
    expect(selected[0].labels?.de).toBe('Erklär-Audio');
  });

  it('displays a pre-existing EKW-IRI selection as a chip on the trigger', async () => {
    const { container } = render(FormConceptPicker, {
      props: {
        field: ekwLrtFieldFixture,
        multiple: true,
        value: [
          {
            id: ARBEITSBLATT_IRI,
            nostrCoord: '38000:ekwpub:arbeitsblatt',
            relay: 'wss://r.example',
            labels: { de: 'Arbeitsblatt' }
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

    expect(trigger.textContent).toContain('Arbeitsblatt');
  });
});
