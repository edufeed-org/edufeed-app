/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';

// Mock vocab-store so the component doesn't need a live relay
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
        ['i', 'https://w3id.org/kim/schulfaecher/s1017']
      ],
      content: ''
    }
  ]
}));

vi.mock('$lib/helpers/relay-helper.js', () => ({
  getAllLookupRelays: () => ['wss://r.example']
}));

import FormConceptPicker from '../forms/FormConceptPicker.svelte';

describe('FormConceptPicker', () => {
  it('renders concepts from the bound scheme and emits a SelectedConcept on choice', async () => {
    /** @type {any[]} */
    let selected = [];
    render(FormConceptPicker, {
      props: {
        field: {
          id: 'about',
          type: 'select',
          label: 'Fach',
          output: 'amb:about',
          vocab: { address: '39737:pub:schulfaecher', relay: 'wss://r.example' }
        },
        value: [],
        onchange: (/** @type {any[]} */ v) => {
          selected = v;
        }
      }
    });
    const option = await screen.findByText('Mathematik');
    await fireEvent.click(option);
    expect(selected[0]).toMatchObject({
      id: 'https://w3id.org/kim/schulfaecher/s1017',
      nostrCoord: '39737:pub:s1017',
      labels: { de: 'Mathematik' }
    });
  });
});
