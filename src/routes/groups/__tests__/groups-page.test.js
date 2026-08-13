/**
 * /groups page — renders the public entries of the user's kind-10009 list.
 *
 * Regression: getPublicGroups() memoizes by writing a Symbol-keyed cache onto
 * the event object. With the list held in deep-proxying $state, that write
 * happens on a reactive proxy inside the `groups` $derived and Svelte throws
 * `state_unsafe_mutation`, killing the whole route render — so a user WITH
 * groups saw a broken page while a user with none saw a healthy empty state.
 * The event array must be held in $state.raw (events are external store
 * objects; proxying them also breaks applesauce's identity/cache contracts).
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/svelte';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools';
import { groupHref } from '$lib/groups/groups.js';

// Real signature: the page pipes the relay response through the REAL
// applesauce EventStore, which drops unverifiable events — a fake would
// vanish and the assertions would pass vacuously on an empty timeline.
const MY_SK = generateSecretKey();
const ME = getPublicKey(MY_SK);

const listEvent = finalizeEvent(
  {
    kind: 10009,
    content: '',
    created_at: 1700000000,
    tags: [
      ['group', 'beechat', 'wss://groups.example.com'],
      ['group', 'e23891', 'wss://groups.hzrd149.com']
    ]
  },
  MY_SK
);

const groupCalls = vi.hoisted(() => /** @type {any[]} */ ([]));

vi.mock('$lib/stores/nostr-infrastructure.svelte', async () => {
  const { EventStore } = await import('applesauce-core');
  await import('applesauce-common'); // registers models, same as the real module
  const { of: rxOf } = await import('rxjs');
  const eventStore = new EventStore();
  // applesauce's bundled verifier does an `instanceof Uint8Array` that fails
  // cross-realm under jsdom; the fixture is really signed, skip re-verification.
  eventStore.verifyEvent = () => true;
  const pool = {
    group: (/** @type {string[]} */ relays) => {
      groupCalls.push(relays);
      return { request: () => rxOf(listEvent) };
    }
  };
  return { eventStore, pool };
});

vi.mock('$lib/stores/accounts.svelte', () => ({
  useActiveUser: () => () => ({ pubkey: ME })
}));
vi.mock('$lib/stores/config.svelte.js', () => ({
  runtimeConfig: { fallbackRelays: ['wss://fallback.example.com'] }
}));
vi.mock('$lib/helpers/toast', () => ({ showToast: vi.fn() }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$app/paths', () => ({ resolve: (/** @type {string} */ path) => path }));
vi.mock('$lib/paraglide/messages', () => ({
  groups_title: () => 'Relay groups',
  groups_join_placeholder: () => "groups.example.com'id",
  groups_add: () => 'Open',
  groups_empty: () => 'No groups yet — paste a group address to join one.',
  groups_invalid_pointer: () => 'Not a valid group address'
}));

import Page from '../+page.svelte';
import { goto } from '$app/navigation';

describe('/groups page', () => {
  it('renders the public groups of my kind-10009 list', async () => {
    render(Page);

    await waitFor(() => {
      expect(screen.getByText('beechat')).toBeTruthy();
      expect(screen.getByText('e23891')).toBeTruthy();
    });
    // relay hostname shown per row
    expect(screen.getByText('groups.hzrd149.com')).toBeTruthy();
    // the fetch went to the configured fallback relays
    expect(groupCalls).toContainEqual(['wss://fallback.example.com']);
  });

  // Handoff #7: the join field used to require strict `host'id` (parseGroupInput)
  // while the attach modal already accepted `https://host'id` via the forgiving
  // parseGroupAddress — unify on the forgiving parser here too.
  it('accepts a pasted https:// group URL in the join field, same as the attach modal', async () => {
    render(Page);
    await waitFor(() => expect(screen.getByText('beechat')).toBeTruthy());

    await fireEvent.input(screen.getByTestId('group-join-input'), {
      target: { value: "https://groups.example.com'newroom" }
    });
    await fireEvent.click(screen.getByText('Open'));

    expect(goto).toHaveBeenCalledWith(
      groupHref({ id: 'newroom', relay: 'wss://groups.example.com/' })
    );
  });
});
