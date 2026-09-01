/**
 * The point of deduping parseRelayListEvent is that its output feeds a keyed
 * {#each}. This asserts the end of that chain: a hostile kind 10002 renders
 * instead of taking the page down with each_key_duplicate.
 *
 * The first test pins the hazard itself — if Svelte ever stopped throwing on
 * duplicate keys, the dedup tests would still pass while guarding nothing.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/svelte';

vi.mock('$lib/services/publish-service.js', () => ({ publishEvent: vi.fn() }));
vi.mock('$lib/services/relay-service.svelte.js', () => ({
  invalidateRelayListCache: vi.fn(),
  getRelayListLookupRelays: () => []
}));
vi.mock('$lib/stores/accounts.svelte.js', () => ({ manager: { active: null } }));
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: { add: vi.fn(), getReplaceable: vi.fn() },
  pool: {}
}));

import { parseRelayListEvent } from '$lib/services/relay-settings-service.js';
import RelayListKeyedEachHost from './fixtures/RelayListKeyedEachHost.svelte';

const HOSTILE_EVENT = /** @type {any} */ ({
  kind: 10002,
  tags: [
    ['r', 'wss://dup.example'],
    ['r', 'wss://dup.example'],
    ['r', 'wss://split.example', 'read'],
    ['r', 'wss://split.example', 'write'],
    ['r'],
    ['r']
  ]
});

describe('parsed relay list in a keyed {#each}', () => {
  it('duplicate keys really do throw (guards the guard)', () => {
    expect(() =>
      render(RelayListKeyedEachHost, {
        props: {
          entries: [
            { url: 'wss://dup.example', read: true, write: true },
            { url: 'wss://dup.example', read: true, write: true }
          ]
        }
      })
    ).toThrow(/each_key_duplicate|Keyed each block/i);
  });

  it('renders a hostile kind 10002 without crashing', () => {
    const entries = parseRelayListEvent(HOSTILE_EVENT);

    const { getAllByTestId } = render(RelayListKeyedEachHost, { props: { entries } });

    const rows = getAllByTestId('relay-row').map((el) => el.textContent?.trim());
    expect(rows).toEqual(['wss://dup.example RW', 'wss://split.example RW']);
  });
});
