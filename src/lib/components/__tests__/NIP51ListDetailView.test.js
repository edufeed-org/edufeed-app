/**
 * NIP51ListDetailView — the naddr detail page for NIP-51 lists.
 *
 * Regression (laoc, 2026-09-29): opening laoc's Listr-made follow set
 * (kind 30000, d=listr-459fc8ec-…) and its edit flow died with
 * `state_unsafe_mutation`. The component held the live EventStore copy of the
 * list in a deep `$state(null)`, so `event` became a Svelte proxy.
 * applesauce-common's list helpers (`getProfilePointersFromList` & co.) write
 * their Symbol-keyed memo onto the event on EVERY call (`Reflect.set`) —
 * through the proxy that is a state write, and inside the `profilePointers`
 * `$derived` Svelte throws. Same class as 279091c3 (personal-lists store).
 *
 * The fixture is the real event from wss://haven.laoc.xyz/ and runs through
 * the REAL applesauce EventStore, so the component sees exactly the object
 * the production store hands out.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/svelte';
import { flushSync } from 'svelte';

const OWNER = '1c5ff3caacd842c01dca8f378231b16617516d214da75c7aeabbe9e1efe9c0f6';

// Real kind 30000 follow set published by the Listr client (fetched with nak).
const LISTR_FOLLOW_SET = Object.freeze({
  kind: 30000,
  id: '0b99f2c5333c3bf0265f20cbab71e6a0c344352d1a4174c5993ad4351182fbcb',
  pubkey: OWNER,
  created_at: 1790071360,
  tags: [
    ['p', 'a01bd200e4cf622a60e34eb50cb16a4aa1bd82509d64dcb9c71e9d7221ce5b4b'],
    ['p', '7e818f2285c9ef8b2d74d82ef7b6fcc3a5eda54048fc2a79ece0cf7a4f352f82'],
    ['p', '6e7b7a3aae952d9ac6877e0359c62231eb18a32cc928661fe931849381c4fc61'],
    ['p', '0b6cb1afa1078cd7d2237a67778258d691d1cd9d01dab1e4cc8c2fbbe6e40ce4'],
    ['p', '7cdbb7d8328d6291526ab71ceba2c3855a17692fb66d8039e493301ca9e64e09'],
    ['p', '7d7da556c8a99e9a44b74e7c74151c6dd748ac3eb6500b7fc480e626144bb4c0'],
    ['p', '5c090631223f8ead4c5b4b5091a072d321452db4116684b349b1b72ad37fffec'],
    ['title', 'STIL-Finder'],
    ['description', 'Akteure für den STIL-Finder'],
    ['d', 'listr-459fc8ec-0c5d-4c7b-b947-76410d061745'],
    ['client', 'Listr']
  ],
  content: '',
  sig: 'bcbf792341578e97c1447f253ef094cc80317ee9112af6f97a20cdedad65d9d5bd5cc67891ee5be1a20eb8eeb3296ce8e4d0d1a649f0f4a0152d94af4f9cdb85'
});

/**
 * Fresh mutable copy — applesauce writes Symbol caches onto events.
 * @returns {import('nostr-tools').NostrEvent}
 */
const fixture = () => ({
  ...LISTR_FOLLOW_SET,
  tags: LISTR_FOLLOW_SET.tags.map((t) => [...t])
});

const doubles = vi.hoisted(() => ({
  /** @type {any} */ eventStore: null,
  /** @type {any} */ activeUser: null,
  actionRun: vi.fn()
}));

vi.mock('$lib/stores/nostr-infrastructure.svelte', async () => {
  const { EventStore } = await import('applesauce-core');
  await import('applesauce-common'); // registers models, same as the real module
  const eventStore = new EventStore();
  // applesauce's bundled verifier does an `instanceof Uint8Array` that fails
  // cross-realm under jsdom; the fixture is really signed, skip re-verification.
  eventStore.verifyEvent = () => true;
  doubles.eventStore = eventStore;
  // Module-level loaders (FeedCard's import graph) build on the pool at import
  // time; nothing in these tests reaches the network.
  const { EMPTY } = await import('rxjs');
  const pool = {
    request: () => EMPTY,
    subscription: () => EMPTY,
    group: () => ({ request: () => EMPTY, subscription: () => EMPTY }),
    relay: () => ({ request: () => EMPTY, subscription: () => EMPTY })
  };
  return { eventStore, pool };
});
vi.mock('$lib/stores/accounts.svelte.js', () => ({
  useActiveUser: () => () => doubles.activeUser
}));
vi.mock('$lib/stores/profile-map.svelte.js', () => ({
  useProfileMap: () => () => new Map()
}));
vi.mock('$lib/stores/personal-bookmarks.svelte.js', () => ({
  reorderBookmarkSetItem: vi.fn(),
  removeItemFromList: vi.fn()
}));
vi.mock('$lib/stores/action-runner.svelte.js', () => ({
  actionRunner: { run: doubles.actionRun }
}));
vi.mock('$lib/helpers/eventDeletion.js', () => ({ deleteEvent: vi.fn() }));
vi.mock('$lib/helpers/relay-helper.js', async (importOriginal) => ({
  .../** @type {object} */ (await importOriginal()),
  getAllLookupRelays: () => []
}));
vi.mock('$lib/loaders/base.js', () => ({ timedPool: vi.fn() }));
vi.mock('$lib/helpers/toast.js', () => ({ showToast: vi.fn() }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$app/paths', () => ({ resolve: (/** @type {string} */ path) => path }));
vi.mock('../shared/ProfileCard.svelte', async () => ({
  default: (await import('./fixtures/ProfileCardStub.svelte')).default
}));
vi.mock('../shared/FeedCard.svelte', async () => ({
  default: (await import('./fixtures/StubComponent.svelte')).default
}));
vi.mock('../lists/AddProfileRow.svelte', async () => ({
  default: (await import('./fixtures/StubComponent.svelte')).default
}));

import * as m from '$lib/paraglide/messages';
import NIP51ListDetailView from '../shared/NIP51ListDetailView.svelte';

describe('NIP51ListDetailView — Listr follow set (kind 30000)', () => {
  /** @type {any[]} */
  let errors = [];
  /** @param {any} e */
  const onError = (e) => {
    errors.push(e.error ?? e.reason ?? e);
    e.preventDefault?.();
  };

  beforeEach(() => {
    errors = [];
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onError);
    doubles.activeUser = { pubkey: OWNER };
    doubles.actionRun.mockReset();
  });

  afterEach(() => {
    cleanup();
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onError);
  });

  it('renders the list from the live EventStore copy without state_unsafe_mutation', () => {
    const stored = doubles.eventStore.add(fixture());
    expect(() => {
      render(NIP51ListDetailView, { event: stored });
      flushSync();
    }).not.toThrow();
    expect(errors).toEqual([]);

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('STIL-Finder');
    expect(screen.getAllByTestId('profile-card-stub')).toHaveLength(7);
  });

  it('opens the edit modal prefilled with title and description', async () => {
    const stored = doubles.eventStore.add(fixture());
    render(NIP51ListDetailView, { event: stored });
    flushSync();

    await fireEvent.click(screen.getByTitle(m.list_detail_edit()));
    flushSync();

    expect(errors).toEqual([]);
    expect(/** @type {HTMLInputElement} */ (document.getElementById('edit-title')).value).toBe(
      'STIL-Finder'
    );
    expect(
      /** @type {HTMLTextAreaElement} */ (document.getElementById('edit-description')).value
    ).toBe('Akteure für den STIL-Finder');
  });

  it('survives the store emitting the saved (replaced) list', () => {
    const stored = doubles.eventStore.add(fixture());
    render(NIP51ListDetailView, { event: stored });
    flushSync();

    // What SetListMetadata + actionRunner do after "Save": a newer version of
    // the same address lands in the EventStore and the replaceable() stream
    // re-emits.
    const edited = fixture();
    edited.id = 'f'.repeat(64);
    edited.created_at += 10;
    edited.tags = edited.tags.map((t) => (t[0] === 'title' ? ['title', 'STIL-Finder 2'] : t));
    expect(() => {
      doubles.eventStore.add(edited);
      flushSync();
    }).not.toThrow();
    expect(errors).toEqual([]);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('STIL-Finder 2');
    expect(screen.getAllByTestId('profile-card-stub')).toHaveLength(7);
  });
});
