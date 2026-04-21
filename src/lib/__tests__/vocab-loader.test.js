/** @vitest-environment node */
import { describe, it, expect, vi } from 'vitest';

vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: { add: vi.fn(), model: vi.fn() },
  pool: {}
}));
vi.mock('$lib/loaders/base.js', () => ({
  timedPool: vi.fn()
}));
vi.mock('applesauce-loaders/loaders', () => ({
  createAddressLoader: vi.fn(() => () => ({ subscribe: () => ({ unsubscribe: () => {} }) })),
  createTimelineLoader: vi.fn(() => () => ({ subscribe: () => ({ unsubscribe: () => {} }) }))
}));

import { loadConceptScheme, loadSchemeConcepts } from '../loaders/vocab-loader.js';
import { createAddressLoader, createTimelineLoader } from 'applesauce-loaders/loaders';
import { VOCAB_KIND, CONCEPT_KIND } from 'nostr-vocab-core/constants';

describe('vocab-loader', () => {
  it('loadConceptScheme calls addressLoader with scheme kind + pubkey + d', () => {
    loadConceptScheme({ address: `${VOCAB_KIND}:abc:schulfaecher`, relay: 'wss://r.example' });
    expect(createAddressLoader).toHaveBeenCalled();
  });

  it('loadSchemeConcepts queries CONCEPT_KIND timeline with #a filter on scheme coord', () => {
    const schemeCoord = `${VOCAB_KIND}:abc:schulfaecher`;
    const sub = loadSchemeConcepts(schemeCoord, ['wss://r.example']);
    expect(createTimelineLoader).toHaveBeenCalledWith(
      expect.anything(),
      ['wss://r.example'],
      expect.objectContaining({ kinds: [CONCEPT_KIND], '#a': [schemeCoord] }),
      expect.anything()
    );
    sub?.unsubscribe?.();
  });
});
