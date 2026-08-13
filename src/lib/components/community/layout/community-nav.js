/**
 * Pure community-navigation logic shared by ContentNavSidebar (desktop) and
 * BottomTabBar (mobile). Both components used to carry a byte-identical copy
 * of "compute the tab list, then splice in a 'channels' tab" — extracted here
 * so there is exactly one place that decides the tab order. Label/icon maps
 * stay in the components; this module only ever deals in tab id strings.
 */
import { getCommunityTabs } from '$lib/helpers/contentTypes.js';
import { shouldShowChannelsTab } from '$lib/concord/community.svelte.js';
import { uniqueBy } from '$lib/helpers/unique.js';

/**
 * Ordered tab ids for a community's nav (sidebar rail or bottom dock),
 * including the spliced-in 'channels' tab when `shouldShowChannelsTab` says
 * it belongs. Insert position: right after 'chat' so it sits next to the
 * public channels — but a strict-content community may have no 'chat' tab
 * at all (`getCommunityTabs` can omit it), in which case it goes right
 * before the trailing 'settings' tab instead, so 'home' always stays first.
 *
 * @param {{
 *   communityEvent: any,
 *   concordEnabled: boolean,
 *   pointer: object | undefined,
 *   isOwner: boolean,
 *   isMember: boolean,
 *   hasGroupChannels: boolean
 * }} args
 * @returns {string[]}
 */
export function communityNavTabIds({
  communityEvent,
  concordEnabled,
  pointer,
  isOwner,
  isMember,
  hasGroupChannels
}) {
  const base = getCommunityTabs(communityEvent);
  const showChannels = shouldShowChannelsTab({
    enabled: concordEnabled,
    pointer,
    isOwner,
    isMember,
    hasGroupChannels
  });
  if (!showChannels) return base;

  const ids = [...base];
  const chatIndex = ids.indexOf('chat');
  const insertAt = chatIndex === -1 ? ids.length - 1 : chatIndex + 1;
  ids.splice(insertAt, 0, 'channels');
  return ids;
}

/**
 * Splits a community's tab ids + channel rows into the desktop sidebar's two
 * zones (design: `docs/superpowers/specs/2026-08-12-groups-architecture-design.md`
 * "one sidebar, two zones"). Pure — the component wires this to real inputs
 * and renders the result; no rendering decisions live here.
 *
 * Visitor filtering: a member or the owner sees every channel row; anyone
 * else sees only `worldReadable` rows (mirrors `shouldShowChannelsTab`'s own
 * owner/member carve-out for the tab itself). `showLockHint` is true only
 * when that filtering actually hid something — a visitor community with
 * nothing but world-readable channels gets no hint.
 *
 * @param {{
 *   tabs: string[],
 *   channelRows: Array<{key: string, worldReadable: boolean}>,
 *   isMember: boolean,
 *   isOwner: boolean
 * }} args
 * @returns {{inhalte: string[], kanaele: any[], footer: string[], showLockHint: boolean}}
 */
export function buildSidebarZones({ tabs, channelRows, isMember, isOwner }) {
  const excluded = new Set(['home', 'channels', 'settings', 'members']);
  const inhalte = (tabs ?? []).filter((id) => !excluded.has(id));

  const deduped = uniqueBy(channelRows ?? [], (row) => row.key);
  const canSeeAll = isMember || isOwner;
  const kanaele = canSeeAll ? deduped : deduped.filter((row) => row.worldReadable);
  const showLockHint = !canSeeAll && kanaele.length < deduped.length;

  return {
    inhalte,
    kanaele,
    footer: ['members', 'settings'],
    showLockHint
  };
}
