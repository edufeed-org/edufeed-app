// @ts-nocheck
/* eslint-disable no-undef -- $effect is a Svelte rune, available in .svelte.js/.svelte.test.js context */
/** @vitest-environment jsdom */
// Regression test for the carry-forward fix (Task 7 review): a channel key
// granted mid-session via a Direct Invite mutates `community.material.channels`
// directly with no observable emission on `state$`/`channels$`. Without a
// reactivity source keyed to that grant, `useConcordCommunity`'s `accessible`
// flag would stay stale until an unrelated re-render. The fix re-subscribes to
// the client's `directInviteWatcher$.invites$` as an additional tick source.
import { describe, it, expect, vi } from 'vitest';
import { BehaviorSubject } from 'rxjs';
import { flushSync } from 'svelte';

vi.mock('$lib/stores/config.svelte.js', () => ({
  runtimeConfig: { concord: { enabled: true } }
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
  it('re-derives `accessible` when a channel key is granted via directInviteWatcher$.invites$, with no channels$/state$ emission', async () => {
    const community = makeCommunity();
    const invites$ = new BehaviorSubject(/** @type {any[]} */ ([]));
    const directInviteWatcher$ = new BehaviorSubject({ invites$ });
    const client = {
      getCommunity: () => community,
      directInviteWatcher$
    };

    // Not hoisted (unlike vi.mock) — safe to reference the locals above.
    // Registered right before the dynamic import below, which resolves
    // `community.svelte.js`'s static `./client.svelte.js` import against it.
    vi.doMock('$lib/concord/client.svelte.js', () => ({
      getConcordState: () => ({ communities: [] }),
      getConcordClient: () => client
    }));

    const { useConcordCommunity } = await import('$lib/concord/community.svelte.js');
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
