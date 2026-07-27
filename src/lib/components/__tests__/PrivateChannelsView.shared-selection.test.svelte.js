/** @vitest-environment jsdom */
/**
 * Shared channel selection across double-mounted instances (final review,
 * IMPORTANT). The community layout mounts 2-3 responsive instances of
 * PrivateChannelsView simultaneously (see community-layout-double-mount in
 * project memory) — hidden instances never receive row clicks. With
 * component-local `selectedChannelId` state, a hidden instance stayed stuck
 * at its default `channels[0]`; any `channels$` re-emission (e.g. a rename
 * tick) then re-ran EVERY instance's mirror-to-store `$effect`, and the
 * hidden instance's effect would overwrite the shared active-channel store
 * back to its stale default — losing unread truth for the channel actually
 * on screen and disabling auto-mark-read for it.
 *
 * Fix: `selectedChannelId` is now a `$derived` read of a shared per-community
 * selection map in `active-channel.svelte.js` (`selectConcordChannel` /
 * `getSelectedConcordChannel`), so every mounted instance agrees.
 *
 * This file is deliberately named `*.test.svelte.js` so it is both picked up
 * by vitest's `src/**\/*.test.svelte.js` include glob AND compiled with rune
 * support by
 * the svelte vite plugin (matches `image-license-hook.test.svelte.js`'s
 * convention), which lets the mocked `useConcordArea` return value be a
 * genuine `$state.raw` — required so PrivateChannelsView's own
 * `$derived(getConcord())` actually re-runs when the test simulates a
 * channels$ re-emission (a plain mutable object, as the sibling
 * PrivateChannelsView.test.js uses, is read once and never invalidates).
 *
 * `concord.community` is deliberately left `undefined` throughout: the
 * mirror-to-store effect being tested runs unconditionally in the component's
 * `<script>` block (it is not gated by the template's `{#if concord.community}`
 * branches), so this avoids mounting the much heavier `ChannelChat` subtree
 * while still exercising the exact effect responsible for the bug.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { cleanup, fireEvent, render } from '@testing-library/svelte';

const CID = 'c'.repeat(64);
const CH1 = 'd'.repeat(64); // sorts first ('alpha' < 'beta', 'de' locale)
const CH2 = 'e'.repeat(64);

// vi.hoisted's factory runs before module-scope `const`s below are
// initialized, so the owner pubkey is inlined here rather than reusing a
// shared `OWNER` constant.
const mockManager = vi.hoisted(() => ({ active: { pubkey: 'a'.repeat(64), signer: {} } }));
vi.mock('$lib/stores/accounts.svelte', () => ({
  manager: mockManager,
  useActiveUser: () => () => mockManager.active
}));

vi.mock('$lib/stores/config.svelte.js', () => ({
  runtimeConfig: { concord: { enabled: true } }
}));

vi.mock('$lib/helpers/toast', () => ({ showToast: vi.fn() }));

const markChannelRead = vi.fn();
vi.mock('$lib/concord/notifications.svelte.js', () => ({
  channelUnreadState: () => ({ unread: false, mentioned: false }),
  markChannelRead: (/** @type {any[]} */ ...args) => markChannelRead(...args),
  getToastsEnabled: () => false,
  setToastsEnabled: vi.fn()
}));

// Reactive fixture backing the mocked useConcordArea — a real $state.raw
// (see file-header note on why this file can use runes directly).
let concordFixture = $state.raw(/** @type {any} */ (null));
vi.mock('$lib/concord/community.svelte.js', () => ({
  useConcordArea: () => () => concordFixture
}));

/** @param {Array<{channel_id: string, name: string, private: boolean, accessible: boolean}>} channels */
function makeConcord(channels) {
  return {
    enabled: true,
    communityId: CID,
    community: undefined,
    membership: /** @type {'none'} */ ('none'),
    channels,
    phase: 'idle',
    dissolved: false,
    signerHasNip44: false
  };
}

function freshChannels() {
  return [
    { channel_id: CH1, name: 'alpha', private: false, accessible: true },
    { channel_id: CH2, name: 'beta', private: false, accessible: true }
  ];
}

const { default: PrivateChannelsView } = await import(
  '$lib/components/community/channels/PrivateChannelsView.svelte'
);
const { getActiveConcordChannel, clearActiveConcordChannel } = await import(
  '$lib/concord/active-channel.svelte.js'
);

describe('PrivateChannelsView — shared channel selection across double-mounted instances', () => {
  beforeEach(() => {
    clearActiveConcordChannel();
    concordFixture = makeConcord(freshChannels());
  });

  afterEach(() => {
    cleanup();
  });

  it('a click in one instance is not reverted by a hidden instance on a channels$ re-emission', async () => {
    // Two instances mounted simultaneously, mirroring the community layout's
    // responsive double-mount — `second` never receives any click, exactly
    // like a hidden responsive variant.
    const first = render(PrivateChannelsView, { props: { communityId: CID } });
    render(PrivateChannelsView, { props: { communityId: CID } });
    flushSync();

    // Both default to channels[0] (alphabetically first = alpha/CH1).
    expect(getActiveConcordChannel()).toEqual({ communityId: CID, channelId: CH1 });

    // Click 'beta' (CH2) — only in the FIRST instance.
    const betaButton = first.getAllByText('beta')[0];
    await fireEvent.click(betaButton);
    flushSync();
    expect(getActiveConcordChannel()).toEqual({ communityId: CID, channelId: CH2 });

    // Simulate a channels$ re-emission: a NEW array/object reference with
    // the same two channels (e.g. a rename tick unrelated to selection).
    concordFixture = makeConcord(freshChannels());
    flushSync();

    // Pre-fix: the never-clicked second instance's local `selectedChannelId`
    // was still '', so its effect re-derived `activeChannel` as channels[0]
    // (CH1) off the new array and overwrote the shared store back to CH1.
    expect(getActiveConcordChannel()).toEqual({ communityId: CID, channelId: CH2 });
  });
});
