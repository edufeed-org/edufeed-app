/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/svelte';
import { CONCEPT_KIND } from 'nostr-vocab-core/constants';
import { identifierFromAddress } from 'nostr-vocab-core/identifiers';

const PK = 'd2689e2f41dabfba953da26655a94ce2aa4e029c383ee921c6a4deafab99a612';
vi.mock('$lib/paraglide/runtime.js', () => ({ getLocale: () => 'de' }));
vi.mock('$lib/stores/vocab-store.svelte.js', () => ({
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
    }
  ]
}));
vi.mock('$lib/helpers/relay-helper.js', () => ({ getAllLookupRelays: () => [] }));

import ExtFacetField from '../ExtFacetField.svelte';

const field = {
  id: 'zeitstruktur',
  type: 'select',
  label: 'Zeit',
  output: 'ext',
  vocab: { address: `39737:${PK}:zeit`, relay: '' }
};
const N56 = identifierFromAddress(`39738:${PK}:5-6`);

beforeEach(cleanup);

describe('ExtFacetField — canonical naddr identifiers', () => {
  it('marks a chip selected when the value carries the legacy id of that concept', () => {
    const { container } = render(ExtFacetField, {
      props: { field, value: [{ id: `nostr:39738:${PK}:5-6` }], onchange: () => {} }
    });
    const chip = /** @type {HTMLElement} */ (container.querySelector('button.badge'));
    expect(chip.classList.contains('badge-primary')).toBe(true);
  });
  it('toggling a chip emits the canonical nostr:naddr id and removes a legacy-form duplicate', async () => {
    /** @type {any[]} */ let out = [];
    const { container } = render(ExtFacetField, {
      props: {
        field,
        value: [],
        onchange: (/** @type {any[]} */ v) => {
          out = v;
        }
      }
    });
    await fireEvent.click(/** @type {HTMLElement} */ (container.querySelector('button.badge')));
    expect(out).toEqual([{ id: N56 }]);
    cleanup();
    const second = render(ExtFacetField, {
      props: {
        field,
        value: [{ id: `nostr:39738:${PK}:5-6` }],
        onchange: (/** @type {any[]} */ v) => {
          out = v;
        }
      }
    });
    await fireEvent.click(
      /** @type {HTMLElement} */ (second.container.querySelector('button.badge'))
    );
    expect(out).toEqual([]);
  });
});
