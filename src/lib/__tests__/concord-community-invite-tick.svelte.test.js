// @ts-nocheck
/* eslint-disable no-undef -- $effect/$state/$derived are Svelte runes, available in .svelte.js/.svelte.test.js context */
/** @vitest-environment jsdom */
// Regression tests for the Task 7/8 review fixes on useConcordCommunity:
// 1. A channel key granted mid-session via a Direct Invite mutates
//    `community.material.channels` directly with no observable emission on
//    `state$`/`channels$`. Without a reactivity source keyed to that grant,
//    the `accessible` flag would stay stale until an unrelated re-render.
//    The fix re-subscribes to the client's `directInviteWatcher$.invites$`
//    as an additional tick source.
// 2. `signerHasNip44` must come reactively from the hook (derived from the
//    reassigned $state.raw in client.svelte.js), not the raw module-level
//    helper — a template reading the raw helper evaluates once at mount and
//    misses a client whose async setup finishes afterwards.
import { describe, it, expect, vi } from 'vitest';
import { BehaviorSubject } from 'rxjs';
import { flushSync } from 'svelte';
import { useConcordCommunity } from '$lib/concord/community.svelte.js';

vi.mock('$lib/stores/config.svelte.js', () => ({
  runtimeConfig: { concord: { enabled: true } }
}));

// Mutable holders so each test can swap the mocked client/state without
// vi.resetModules() (which would spawn a second svelte reactivity runtime).
const holders = vi.hoisted(() => ({
  getState: /** @type {() => any} */ (() => ({ communities: [] })),
  getClient: /** @type {() => any} */ (() => undefined)
}));

vi.mock('$lib/concord/client.svelte.js', () => ({
  getConcordState: () => holders.getState(),
  getConcordClient: () => holders.getClient()
}));

const communityId = 'a'.repeat(64);
const channelId = 'channel-1';

/** Builds a fake ConcordCommunity with mutable material + the observables the hook reads. */
function makeCommunity() {
  const material = { channels: /** @type {{id: string}[]} */ ([]) };
  return {
    material,
    channels$: new BehaviorSubject([
      { channel_id: channelId, name: 'General', private: true, deleted: false }
    ]),
    phase$: new BehaviorSubject('live'),
    dissolved$: new BehaviorSubject(false)
  };
}

describe('useConcordCommunity — invite-tick reactivity (carry-forward fix)', () => {
  it('re-derives `accessible` when a channel key is granted via directInviteWatcher$.invites$, with no channels$/state$ emission', () => {
    const community = makeCommunity();
    const invites$ = new BehaviorSubject(/** @type {any[]} */ ([]));
    const directInviteWatcher$ = new BehaviorSubject({ invites$ });
    const client = {
      getCommunity: () => community,
      directInviteWatcher$
    };
    holders.getState = () => ({ communities: [] });
    holders.getClient = () => client;

    const event = { tags: [['concord', communityId]] };

    // Mirror how a component consumes the hook — `const concord = $derived(getConcord())`
    // (see PrivateChannelsView.svelte) — because the staleness bug only shows up
    // through Svelte's dependency-tracking cache. Calling `getConcord()` directly
    // (bypassing $derived) always recomputes fresh and would mask the bug.
    let getSnapshot;
    const cleanup = $effect.root(() => {
      const getConcord = useConcordCommunity(() => event);
      const concord = $derived(getConcord());
      getSnapshot = () => concord;
    });
    flushSync();

    // Before the grant: channel is visible (public metadata) but not accessible.
    expect(getSnapshot().channels).toEqual([
      { channel_id: channelId, name: 'General', private: true, deleted: false, accessible: false }
    ]);

    // Simulate the package granting the key mid-session: `receiveChannelKeys()`
    // mutates `material.channels` directly (no state$/channels$ emission), then
    // fires the same `invites$` emission its caller (the client's `onDirectInvite`
    // subscription) reacted to synchronously beforehand — reproduce that ordering.
    community.material.channels.push({ id: channelId });
    invites$.next([{ id: 'invite-1' }]);
    flushSync();

    // Without the fix, `$derived` never reruns here (nothing it tracked changed)
    // and this would still read `accessible: false` from the cached value above.
    expect(getSnapshot().channels).toEqual([
      { channel_id: channelId, name: 'General', private: true, deleted: false, accessible: true }
    ]);

    cleanup();
  });
});

describe('useConcordCommunity — signerHasNip44 reactivity', () => {
  it('flips through $derived when the client (with a NIP-44 signer) lands in state after mount', () => {
    // Mirror client.svelte.js: a $state.raw snapshot object, REASSIGNED (not
    // mutated) when the async client setup finishes — reads through
    // getConcordState() are rune-tracked.
    let state = $state.raw({ communities: [], client: undefined });
    holders.getState = () => state;
    holders.getClient = () => undefined;

    const event = { tags: [['concord', communityId]] };
    let getSnapshot;
    const cleanup = $effect.root(() => {
      const getConcord = useConcordCommunity(() => event);
      const concord = $derived(getConcord());
      getSnapshot = () => concord;
    });
    flushSync();

    // Mounted before the async client setup finished: capability not yet known.
    expect(getSnapshot().signerHasNip44).toBe(false);

    // Client setup completes (client.svelte.js: `state = { ...state, client }`).
    state = { communities: [], client: { signer: { nip44: {} } } };
    flushSync();
    expect(getSnapshot().signerHasNip44).toBe(true);

    // Teardown (logout) clears it again.
    state = { communities: [], client: undefined };
    flushSync();
    expect(getSnapshot().signerHasNip44).toBe(false);

    cleanup();
  });

  it('is false for a client whose signer lacks nip44', () => {
    const state = $state.raw({ communities: [], client: { signer: {} } });
    holders.getState = () => state;
    holders.getClient = () => undefined;

    let getSnapshot;
    const cleanup = $effect.root(() => {
      const getConcord = useConcordCommunity(() => undefined);
      const concord = $derived(getConcord());
      getSnapshot = () => concord;
    });
    flushSync();
    expect(getSnapshot().signerHasNip44).toBe(false);
    cleanup();
  });
});
