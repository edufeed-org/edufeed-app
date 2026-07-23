// Per-community Concord context: tab-visibility gating (pure, spec §7) plus a
// reactive hook bridging one ConcordCommunity's observables into runes. Only
// imports sibling concord/ submodules with no top-level package imports
// (pointer.js, client.svelte.js, bridge.svelte.js) so components can import
// this file directly (not the barrel) without pulling applesauce-core-concord
// / nostr-tools into SSR chunks — see storage.js, which the barrel reaches.
import { parseConcordPointer } from './pointer.js';
import { getConcordState, getConcordClient } from './client.svelte.js';
import { useObservable } from './bridge.svelte.js';
import { runtimeConfig } from '$lib/stores/config.svelte.js';

/**
 * Visibility rule for the community "channels" tab (spec §7):
 * flag on AND (member OR pointer exists OR owner).
 * @param {{enabled: boolean, pointer: object|undefined, isOwner: boolean, isMember: boolean}} args
 * @returns {boolean}
 */
export function shouldShowChannelsTab({ enabled, pointer, isOwner, isMember }) {
  if (!enabled) return false;
  return isMember || !!pointer || isOwner;
}

/**
 * Reactive Concord context for one Communikey community.
 * Call during component init; read via the returned getter. Robust to the
 * Concord client being absent (flag off / logged out) — every accessor
 * chain uses optional chaining and getters return safe defaults.
 * @param {() => any} getCommunikeyEvent kind 10222 event getter
 * @returns {() => { enabled: boolean, pointer: {communityId: string, relay: string|undefined}|undefined, community: any, membership: 'none'|'member', channels: any[], phase: string, dissolved: boolean }}
 */
export function useConcordCommunity(getCommunikeyEvent) {
  const getChannels = useObservable(() => {
    const pointer = parseConcordPointer(getCommunikeyEvent());
    const _tick = getConcordState().communities; // re-run when memberships change
    const community = pointer && getConcordClient()?.getCommunity(pointer.communityId);
    return community?.channels$;
  }, /** @type {any[]} */ ([]));
  const getPhase = useObservable(() => {
    const pointer = parseConcordPointer(getCommunikeyEvent());
    const _tick = getConcordState().communities;
    return pointer && getConcordClient()?.getCommunity(pointer.communityId)?.phase$;
  }, 'idle');
  const getDissolved = useObservable(() => {
    const pointer = parseConcordPointer(getCommunikeyEvent());
    const _tick = getConcordState().communities;
    return pointer && getConcordClient()?.getCommunity(pointer.communityId)?.dissolved$;
  }, false);

  return () => {
    const pointer = parseConcordPointer(getCommunikeyEvent());
    const _tick = getConcordState().communities;
    const community = pointer ? getConcordClient()?.getCommunity(pointer.communityId) : undefined;
    // A channel is "accessible" when we hold its key (material.channels) —
    // metadata for private channels we're not a member of still folds into
    // channels$ (it's public knowledge that they exist), but we can't
    // decrypt them without the key.
    const heldChannelIds = (community?.material?.channels ?? []).map(
      (/** @type {{id: string}} */ k) => k.id
    );
    return {
      enabled: !!runtimeConfig.concord?.enabled,
      pointer,
      community,
      membership: /** @type {'none'|'member'} */ (community ? 'member' : 'none'),
      channels: getChannels()
        .filter((c) => c.private && !c.deleted)
        .map((c) => ({ ...c, accessible: heldChannelIds.includes(c.channel_id) })),
      phase: getPhase(),
      dissolved: getDissolved()
    };
  };
}
