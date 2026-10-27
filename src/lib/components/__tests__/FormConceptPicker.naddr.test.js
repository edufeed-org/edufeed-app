/** @vitest-environment jsdom */
// NIP-VOCAB canonical concept identifiers: concepts without an `i` URI are
// identified by their canonical nostr:naddr1… URI; stored legacy ids
// (nostr:<kind>:<pubkey>:<d>) must still match the loaded concept events.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor, cleanup } from '@testing-library/svelte';
import { CONCEPT_KIND } from 'nostr-vocab-core/constants';
import { identifierFromAddress } from 'nostr-vocab-core/identifiers';

const PK = 'd2689e2f41dabfba953da26655a94ce2aa4e029c383ee921c6a4deafab99a612';

vi.mock('$lib/paraglide/runtime.js', () => ({ getLocale: () => 'de' }));
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
vi.mock('$lib/helpers/educational/skosLoader.js', () => ({
  fetchVocabulary: vi.fn(),
  getConceptLabel: (/** @type {any} */ c, /** @type {string} */ locale) =>
    c.labels?.[locale] || c.labels?.de || c.id,
  sortConceptsByLabel: (/** @type {any[]} */ c) => c,
  filterConcepts: (/** @type {any[]} */ c) => c
}));
vi.mock('$lib/stores/vocab-store.svelte.js', () => ({
  useConceptScheme: () => () => ({
    id: 's',
    pubkey: PK,
    kind: 39737,
    tags: [
      ['d', 'klassenstufen'],
      ['type', 'ConceptScheme'],
      ['prefLabel', 'Klassenstufen', 'de']
    ],
    content: ''
  }),
  useSchemeConcepts: () => () => [
    {
      id: 'c56',
      pubkey: PK,
      kind: CONCEPT_KIND,
      tags: [
        ['d', '5-6'],
        ['type', 'Concept'],
        ['prefLabel', 'Klasse 5/6', 'de']
      ],
      content: ''
    },
    {
      id: 'c78',
      pubkey: PK,
      kind: CONCEPT_KIND,
      tags: [
        ['d', '7-8'],
        ['type', 'Concept'],
        ['prefLabel', 'Klasse 7/8', 'de']
      ],
      content: ''
    }
  ]
}));
vi.mock('$lib/helpers/relay-helper.js', () => ({
  getAllLookupRelays: () => ['wss://r.example'],
  getEventLoaderLookupRelays: () => []
}));

import FormConceptPicker from '../forms/FormConceptPicker.svelte';

const field = {
  id: 'educationalLevel',
  type: 'select',
  label: 'Stufe',
  output: 'amb:educationalLevel',
  vocab: { address: `39737:${PK}:klassenstufen`, relay: 'wss://r.example' }
};
const N56 = identifierFromAddress(`39738:${PK}:5-6`);

beforeEach(() => {
  cleanup();
  Element.prototype.scrollIntoView = vi.fn();
});

const openTrigger = async (/** @type {HTMLElement} */ container) => {
  const trigger = /** @type {HTMLElement} */ (
    await waitFor(() => {
      const t = container.querySelector('[role="combobox"]');
      if (!t) throw new Error('combobox not found');
      return t;
    })
  );
  return trigger;
};

describe('FormConceptPicker — canonical naddr identifiers', () => {
  it('emits the canonical nostr:naddr id (not the raw coordinate) for a concept without an i tag', async () => {
    /** @type {any[]} */ let selected = [];
    const { container } = render(FormConceptPicker, {
      props: {
        field,
        value: [],
        multiple: true,
        onchange: (/** @type {any[]} */ v) => {
          selected = v;
        }
      }
    });
    const trigger = await openTrigger(container);
    await fireEvent.click(trigger);
    const opt = /** @type {HTMLElement} */ (
      Array.from(container.querySelectorAll('[role="option"]')).find((o) =>
        o.textContent?.includes('Klasse 5/6')
      )
    );
    await fireEvent.click(opt.querySelector('button') || opt);
    expect(selected).toHaveLength(1);
    expect(selected[0]).toMatchObject({
      id: N56,
      nostrCoord: `39738:${PK}:5-6`,
      relay: 'wss://r.example',
      labels: { de: 'Klasse 5/6' }
    });
    expect(selected[0].id.startsWith('nostr:naddr1')).toBe(true);
  });

  it('shows a stored legacy id as the matching concept and enriches it once with nostrCoord/relay, never swapping the concept', async () => {
    /** @type {any[][]} */ const emitted = [];
    const { container } = render(FormConceptPicker, {
      props: {
        field,
        multiple: true,
        value: [{ id: `nostr:39738:${PK}:5-6`, nostrCoord: '', relay: '', labels: {} }],
        onchange: (/** @type {any[]} */ v) => {
          emitted.push(v);
        }
      }
    });
    const trigger = await openTrigger(container);
    await new Promise((r) => setTimeout(r, 50));
    expect(trigger.textContent).toContain('Klasse 5/6');
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toHaveLength(1);
    expect(emitted[0][0]).toMatchObject({
      id: N56,
      nostrCoord: `39738:${PK}:5-6`,
      relay: 'wss://r.example',
      labels: { de: 'Klasse 5/6' }
    });
  });
  it('does not emit when a matching value already carries nostrCoord', async () => {
    let calls = 0;
    render(FormConceptPicker, {
      props: {
        field,
        multiple: true,
        value: [
          {
            id: `nostr:39738:${PK}:5-6`,
            nostrCoord: `39738:${PK}:5-6`,
            relay: 'wss://r.example',
            labels: { de: 'Klasse 5/6' }
          }
        ],
        onchange: () => {
          calls++;
        }
      }
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(calls).toBe(0);
  });

  it('a malformed nostr: id neither crashes nor is healed', async () => {
    let calls = 0;
    const { container } = render(FormConceptPicker, {
      props: {
        field,
        multiple: true,
        value: [{ id: 'nostr:39738:zz:x', nostrCoord: '', relay: '', labels: { de: 'Kaputt' } }],
        onchange: () => {
          calls++;
        }
      }
    });
    await openTrigger(container);
    await new Promise((r) => setTimeout(r, 50));
    expect(calls).toBe(0);
  });
});
