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
import { useActiveUser } from '$lib/stores/accounts.svelte';
import { memberTier } from './roles.js';

/**
 * Visibility rule for the community "channels" tab (spec §7):
 * flag on AND (member OR pointer exists).
 *
 * NIP-29 channels are a SECOND source for the same tab and are not Concord:
 * a community extended by groups has no Concord pointer, no Concord
 * membership and need not have the Concord flag on, so every Concord input
 * here is false for it. Its channels open the tab on their own — otherwise
 * the only list they have would be unreachable. Likewise a moderated
 * community's membership pointer opens it for EVERYONE.
 * @param {{enabled: boolean, pointer: object|undefined, isMember: boolean, hasGroupChannels?: boolean, hasMembershipPointer?: boolean}} args
 * @returns {boolean}
 */
export function shouldShowChannelsTab({
  enabled,
  pointer,
  isMember,
  hasGroupChannels,
  hasMembershipPointer
}) {
  if (hasGroupChannels) return true;
  // A moderated community's membership pointer opens the view for everyone:
  // subtree channels are pointer-free (no 10222 `group` tags), so this is
  // the only signal they exist, and the root group doubles as the "General"
  // channel, so there is always ≥1 row. The old owner-only carve-out made
  // every member's channel click bounce back to home (laoc, 2026-08-21).
  // Per-channel access stays with the chat pane / relay, per-row visibility
  // with buildSidebarZones. Before the Concord gate — NIP-29 doesn't depend
  // on that flag.
  if (hasMembershipPointer) return true;
  if (!enabled) return false;
  // No bare-owner clause: founding an area is the settings type card's
  // deliberate flow ("Privaten Bereich erstellen"), not a side effect of a
  // channels tab that appears before any type decision (laoc, 2026-08-18).
  return isMember || !!pointer;
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
 * @returns {() => { enabled: boolean, communityId: string|undefined, community: any, membership: 'none'|'member', channels: any[], phase: string, dissolved: boolean, signerHasNip44: boolean, myTier: 'owner'|'admin'|'moderator'|null, canManageChannels: boolean, canCreateInvite: boolean, canModerate: boolean, canManageRoles: boolean, canPromoteAdmin: boolean }}
 */
export function useConcordArea(getCommunityId) {
  const getActiveUser = useActiveUser();
  const getRoles = useObservable(() => {
    const communityId = getCommunityId();
    const _tick = getConcordState().communities;
    return communityId ? getConcordClient()?.getCommunity(communityId)?.roles$ : undefined;
  }, /** @type {any[]} */ ([]));
  const getGrants = useObservable(() => {
    const communityId = getCommunityId();
    const _tick = getConcordState().communities;
    return communityId ? getConcordClient()?.getCommunity(communityId)?.grants$ : undefined;
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- initial value only, useObservable wraps it in $state.raw()
  }, /** @type {Map<string,string[]>} */ (new Map()));
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
    const myTier = memberTier(
      getRoles(),
      getGrants(),
      community?.material?.owner,
      getActiveUser()?.pubkey
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
      signerHasNip44: !!getConcordState().client?.signer?.nip44,
      // Owner-inclusive capability booleans (CORD-04 tiers). `myTier` is null
      // for roleless members / before roles$+grants$ have loaded, which
      // correctly yields false for every capability below.
      myTier,
      canManageChannels: myTier === 'owner' || myTier === 'admin',
      canCreateInvite: myTier === 'owner' || myTier === 'admin' || myTier === 'moderator',
      canModerate: myTier === 'owner' || myTier === 'admin' || myTier === 'moderator',
      canManageRoles: myTier === 'owner' || myTier === 'admin',
      canPromoteAdmin: myTier === 'owner'
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
 * @returns {() => { enabled: boolean, pointer: {communityId: string, relay: string|undefined}|undefined, community: any, membership: 'none'|'member', channels: any[], phase: string, dissolved: boolean, signerHasNip44: boolean, myTier: 'owner'|'admin'|'moderator'|null, canManageChannels: boolean, canCreateInvite: boolean, canModerate: boolean, canManageRoles: boolean, canPromoteAdmin: boolean }}
 */
export function useConcordCommunity(getCommunikeyEvent) {
  const getArea = useConcordArea(() => parseConcordPointer(getCommunikeyEvent())?.communityId);
  return () => ({
    ...getArea(),
    pointer: parseConcordPointer(getCommunikeyEvent())
  });
}
