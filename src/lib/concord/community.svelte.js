// Per-community Concord context: tab-visibility gating (pure, spec §7) plus a
// reactive hook bridging one ConcordCommunity's observables into runes. Only
// imports sibling concord/ submodules with no top-level package imports
// (pointer.js, client.svelte.js, bridge.svelte.js) so components can import
// this file directly (not the barrel) without pulling applesauce-core-concord
// / nostr-tools into SSR chunks — see storage.js, which the barrel reaches.
import { of } from 'rxjs';
import { switchMap } from 'rxjs/operators';
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
 * Which of a community's channels a member can see, and whether they can
 * currently read it. PUBLIC channels (`private: false`) are visible to
 * every member and always accessible — membership itself grants access,
 * because public channels derive their keys from `community_root` (CORD-03),
 * not from a per-channel key in `material.channels`. PRIVATE channels stay
 * gated on `heldChannelIds` as before: metadata for a private channel we're
 * not in still folds into `channels$` (its existence is public knowledge),
 * but we can't decrypt it without the key. Deleted channels are always
 * dropped, regardless of privacy.
 * @param {Array<{channel_id: string, private: boolean, deleted?: boolean}>} channels
 * @param {string[]} heldChannelIds
 * @returns {Array<any & {accessible: boolean}>}
 */
export function deriveVisibleChannels(channels, heldChannelIds) {
  return channels
    .filter((c) => !c.deleted)
    .map((c) => ({ ...c, accessible: !c.private || heldChannelIds.includes(c.channel_id) }));
}

/**
 * Reactive Concord context for one Concord community, keyed on a raw
 * community id rather than a Communikey pointer — the core `useConcordCommunity`
 * used to inline directly. Extracted (Concord follow-up 1) so a standalone
 * page can open an UNLINKED membership (no Communikey 10222 pointing at it)
 * with the exact same reactive plumbing. Call during component init; read
 * via the returned getter. Robust to the Concord client being absent (flag
 * off / logged out) or `getCommunityId()` returning undefined — every
 * accessor chain uses optional chaining and getters return safe defaults.
 * @param {() => string|undefined} getCommunityId Concord community id getter
 * @returns {() => { enabled: boolean, communityId: string|undefined, community: any, membership: 'none'|'member', channels: any[], phase: string, dissolved: boolean, signerHasNip44: boolean }}
 */
export function useConcordArea(getCommunityId) {
  const getChannels = useObservable(() => {
    const communityId = getCommunityId();
    const _tick = getConcordState().communities; // re-run when memberships change
    const community = communityId && getConcordClient()?.getCommunity(communityId);
    return community?.channels$;
  }, /** @type {any[]} */ ([]));
  const getPhase = useObservable(() => {
    const communityId = getCommunityId();
    const _tick = getConcordState().communities;
    return communityId && getConcordClient()?.getCommunity(communityId)?.phase$;
  }, 'idle');
  const getDissolved = useObservable(() => {
    const communityId = getCommunityId();
    const _tick = getConcordState().communities;
    return communityId && getConcordClient()?.getCommunity(communityId)?.dissolved$;
  }, false);
  // CARRY-FORWARD FIX (Task 7 review): `community.material.channels` is
  // mutated in place by `receiveChannelKeys()` when a Direct Invite grants a
  // channel key mid-session, but that path never touches `state$`/`channels$`
  // — so `accessible` below would stay stale until an unrelated re-render.
  // The client's own `onDirectInvite` handler (which calls
  // `receiveChannelKeys()`) runs synchronously inside its `invites$`
  // subscription callback (see applesauce-concord's ConcordClient
  // constructor), so re-subscribing to that same observable here — after
  // `receiveChannelKeys()` has already run — gives a tick exactly when a
  // grant lands, no polling required. `directInviteWatcher$` itself is a
  // BehaviorSubject the client fills in asynchronously after `start()`, so we
  // flatten through it with `switchMap` rather than reading `.invites$` once.
  const getInviteTick = useObservable(() => {
    const _tick = getConcordState().communities; // re-subscribe when the client (re)starts
    return getConcordClient()?.directInviteWatcher$?.pipe(
      switchMap((/** @type {any} */ watcher) => watcher?.invites$ ?? of(/** @type {any[]} */ ([])))
    );
  }, /** @type {any[]} */ ([]));

  return () => {
    const communityId = getCommunityId();
    const _tick = getConcordState().communities;
    const _inviteTick = getInviteTick(); // re-derive `accessible` when a channel key grant lands
    const community = communityId ? getConcordClient()?.getCommunity(communityId) : undefined;
    // A channel is "accessible" when we hold its key (material.channels) —
    // metadata for private channels we're not a member of still folds into
    // channels$ (it's public knowledge that they exist), but we can't
    // decrypt them without the key.
    const heldChannelIds = (community?.material?.channels ?? []).map(
      (/** @type {{id: string}} */ k) => k.id
    );
    return {
      enabled: !!runtimeConfig.concord?.enabled,
      communityId,
      community,
      membership: /** @type {'none'|'member'} */ (community ? 'member' : 'none'),
      channels: deriveVisibleChannels(getChannels(), heldChannelIds),
      phase: getPhase(),
      dissolved: getDissolved(),
      // Read via getConcordState() (a reassigned $state.raw), NOT the plain
      // module-level `currentClient` behind client.svelte.js's raw
      // signerHasNip44() helper — a template reading that helper carries no
      // rune dependency and never re-evaluates after mount, so a component
      // mounted before the async client setup finished would miss the
      // capability forever. state.client is set/cleared in the same
      // reassignments as the rest of the client lifecycle.
      signerHasNip44: !!getConcordState().client?.signer?.nip44
    };
  };
}

/**
 * Reactive Concord context for one Communikey community. Thin wrapper over
 * {@link useConcordArea}, keyed on the community id parsed from the kind
 * 10222 event's `concord` pointer tag; adds `pointer` to the returned shape
 * (needed by `shouldShowChannelsTab` callers — ContentNavSidebar/BottomTabBar
 * — which gate visibility on the pointer's mere existence, independent of
 * membership).
 * @param {() => any} getCommunikeyEvent kind 10222 event getter
 * @returns {() => { enabled: boolean, pointer: {communityId: string, relay: string|undefined}|undefined, community: any, membership: 'none'|'member', channels: any[], phase: string, dissolved: boolean, signerHasNip44: boolean }}
 */
export function useConcordCommunity(getCommunikeyEvent) {
  const getArea = useConcordArea(() => parseConcordPointer(getCommunikeyEvent())?.communityId);
  return () => ({
    ...getArea(),
    pointer: parseConcordPointer(getCommunikeyEvent())
  });
}
