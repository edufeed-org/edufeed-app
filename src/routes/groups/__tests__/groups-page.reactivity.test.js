/**
 * Update-propagation guard for the $state.raw fix (adopted from TestOER's verification probe, 2026-08-04).
 *
 * Question: does $state.raw cost the page the reactivity it needs?
 * Raw state compares by reference, so if TimelineModel ever re-emitted the
 * SAME array instance, a later update would silently not render.
 * This drives a SECOND, newer kind-10009 through the real EventStore and
 * asserts the UI switches to the new group set.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/svelte';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools';

const MY_SK = generateSecretKey();
const ME = getPublicKey(MY_SK);

const first = finalizeEvent(
  {
    kind: 10009,
    content: '',
    created_at: 1700000000,
    tags: [['group', 'beechat', 'wss://groups.example.com']]
  },
  MY_SK
);

// newer replaceable version with a DIFFERENT group set
const second = finalizeEvent(
  {
    kind: 10009,
    content: '',
    created_at: 1700000500,
    tags: [['group', 'latearrival', 'wss://groups.example.com']]
  },
  MY_SK
);

const subject = vi.hoisted(() => ({ current: /** @type {any} */ (null) }));

vi.mock('$lib/stores/nostr-infrastructure.svelte', async () => {
  const { EventStore } = await import('applesauce-core');
  await import('applesauce-common');
  const { Subject } = await import('rxjs');
  const eventStore = new EventStore();
  eventStore.verifyEvent = () => true;
  const s = new Subject();
  subject.current = s;
  return { eventStore, pool: { group: () => ({ request: () => s }) } };
});

vi.mock('$lib/stores/accounts.svelte', () => ({ useActiveUser: () => () => ({ pubkey: ME }) }));
vi.mock('$lib/stores/config.svelte.js', () => ({
  runtimeConfig: { fallbackRelays: ['wss://fallback.example.com'] }
}));
vi.mock('$lib/helpers/toast', () => ({ showToast: vi.fn() }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$app/paths', () => ({ resolve: (/** @type {string} */ p) => p }));
vi.mock('$lib/paraglide/messages', () => ({
  groups_title: () => 'Relay groups',
  groups_join_placeholder: () => "groups.example.com'id",
  groups_add: () => 'Open',
  groups_empty: () => 'No groups yet',
  groups_invalid_pointer: () => 'Not a valid group address'
}));

import Page from '../+page.svelte';

describe('/groups page reactivity under $state.raw', () => {
  it('re-renders when a NEWER 10009 arrives after first paint', async () => {
    render(Page);

    subject.current.next(first);
    await waitFor(() => expect(screen.getByText('beechat')).toBeTruthy());

    // second emission — this is the assertion the single-render test cannot make
    subject.current.next(second);
    await waitFor(() => expect(screen.getByText('latearrival')).toBeTruthy());
    expect(screen.queryByText('beechat')).toBeNull();
  });
});
