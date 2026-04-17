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

describe('vocab-loader', () => {
  it('loadConceptScheme calls addressLoader with kind 39737 + pubkey + d', () => {
    loadConceptScheme({ address: '39737:abc:schulfaecher', relay: 'wss://r.example' });
    expect(createAddressLoader).toHaveBeenCalled();
  });

  it('loadSchemeConcepts queries kind 39737 timeline with #a filter on scheme coord', () => {
    const sub = loadSchemeConcepts('39737:abc:schulfaecher', ['wss://r.example']);
    expect(createTimelineLoader).toHaveBeenCalledWith(
      expect.anything(),
      ['wss://r.example'],
      expect.objectContaining({ kinds: [39737], '#a': ['39737:abc:schulfaecher'] }),
      expect.anything()
    );
    sub?.unsubscribe?.();
  });
});
