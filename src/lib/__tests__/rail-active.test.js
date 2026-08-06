/**
 * Which rail entry is the one you are looking at?
 *
 * The rail drew a ring for a joined community and for nothing else, so a
 * Concord area and a NIP-29 host — both of them containers you can be inside
 * of — left the rail looking as if you were nowhere (laoc 2026-08-06).
 *
 * The route is the only honest source: `currentCommunityId` is a prop the
 * community layout computes, but an area and a host are addressed by URL
 * alone. These tests pin the mapping from a path to a container, and the
 * comparison that decides whether an entry IS that container.
 */
import { describe, it, expect } from 'vitest';
import { activeRailTarget, hostRouteOf, isEntryActive } from '$lib/rail/rail-active.js';

const COMMUNITY = 'a'.repeat(64);

/** @type {import('$lib/rail/rail-entries.js').RailEntry} */
const communityEntry = { key: `community:${COMMUNITY}`, kind: 'community', pubkey: COMMUNITY };
/** @type {import('$lib/rail/rail-entries.js').RailEntry} */
const areaEntry = { key: 'area:area-1', kind: 'area', area: { communityId: 'area-1' } };
/**
 * @param {string} relay
 * @returns {import('$lib/rail/rail-entries.js').RailEntry}
 */
const relayEntry = (relay) => ({ key: `relay:${relay}`, kind: 'relay', relay, rows: [] });

describe('activeRailTarget', () => {
  it('is nothing on the dashboard, even inside a community route', () => {
    expect(
      activeRailTarget({ pathname: '/c', communityPubkey: COMMUNITY, isDashboardActive: true })
    ).toBeNull();
  });

  it('takes the community the layout already resolved', () => {
    expect(activeRailTarget({ pathname: '/c/npub1x', communityPubkey: COMMUNITY })).toEqual({
      kind: 'community',
      pubkey: COMMUNITY
    });
  });

  it('reads the host out of a relay directory route', () => {
    const path = `/relays/${encodeURIComponent('wss://edufeed.communities.buzz.xyz')}`;
    expect(activeRailTarget({ pathname: path })).toEqual({
      kind: 'relay',
      relay: 'wss://edufeed.communities.buzz.xyz'
    });
  });

  // A channel IS a group and a group lives on exactly one host, so reading one
  // of its channels is being inside that container — the rail must not go dark
  // the moment you open a channel from the host's own directory.
  it('reads the host out of a group chat route', () => {
    const path = `/groups/${encodeURIComponent("wss://relay.example.com'general")}`;
    // The pointer parser hands back a normalized URL (trailing slash), which
    // is exactly why isEntryActive compares hosts and not strings — the rail's
    // own key carries whatever the user's kind-10009 spelled.
    expect(activeRailTarget({ pathname: path })).toEqual({
      kind: 'relay',
      relay: 'wss://relay.example.com/'
    });
    expect(
      isEntryActive(relayEntry('wss://relay.example.com'), activeRailTarget({ pathname: path }))
    ).toBe(true);
  });

  it('reads a Concord area out of its route', () => {
    expect(activeRailTarget({ pathname: '/private/area-1' })).toEqual({
      kind: 'area',
      communityId: 'area-1'
    });
  });

  it('is nothing on a route that is inside no container', () => {
    expect(activeRailTarget({ pathname: '/discover' })).toBeNull();
    expect(activeRailTarget({ pathname: '/relays' })).toBeNull();
    expect(activeRailTarget({ pathname: '' })).toBeNull();
  });

  it('is nothing rather than a bad container when the route cannot be read', () => {
    expect(activeRailTarget({ pathname: '/groups/not%20a%20pointer' })).toBeNull();
    // A lone `%` is an invalid escape: decodeURIComponent throws on it, and a
    // throw here would take the whole rail down with it.
    expect(activeRailTarget({ pathname: '/relays/%' })).toBeNull();
  });
});

describe('isEntryActive', () => {
  it('matches the container it names, and only that one', () => {
    const target = activeRailTarget({ pathname: '/c/x', communityPubkey: COMMUNITY });
    expect(isEntryActive(communityEntry, target)).toBe(true);
    expect(isEntryActive({ ...communityEntry, pubkey: 'b'.repeat(64) }, target)).toBe(false);
    expect(isEntryActive(areaEntry, target)).toBe(false);
  });

  it('matches an area by its id', () => {
    const target = activeRailTarget({ pathname: '/private/area-1' });
    expect(isEntryActive(areaEntry, target)).toBe(true);
    expect(isEntryActive({ ...areaEntry, area: { communityId: 'area-2' } }, target)).toBe(false);
  });

  // The rail's key carries the relay exactly as the user's kind-10009 spelled
  // it, and the route carries what relayHref encoded — a trailing slash apart,
  // those are the same host, and a string compare would say they are not.
  it('matches a host across spellings of the same URL', () => {
    const target = activeRailTarget({
      pathname: `/relays/${encodeURIComponent('wss://relay.example.com/')}`
    });
    expect(isEntryActive(relayEntry('wss://relay.example.com'), target)).toBe(true);
    expect(isEntryActive(relayEntry('wss://other.example.com'), target)).toBe(false);
  });

  // Same host, different port is a DIFFERENT relay — the reason relayLabel
  // uses `host` and not `hostname`.
  it('does not match a different port on the same host', () => {
    const target = activeRailTarget({
      pathname: `/relays/${encodeURIComponent('wss://relay.example.com:8443')}`
    });
    expect(isEntryActive(relayEntry('wss://relay.example.com'), target)).toBe(false);
  });

  it('is false for every entry when nothing is active', () => {
    expect(isEntryActive(communityEntry, null)).toBe(false);
    expect(isEntryActive(areaEntry, null)).toBe(false);
    expect(isEntryActive(relayEntry('wss://relay.example.com'), null)).toBe(false);
  });
});

// The rail only ever needed the HOST out of a route. A channel sidebar needs
// the channel too — which row to mark, and whether there is one at all (a
// relay directory is inside the host with no channel open). One decoder
// answers both questions, so the two surfaces can never disagree about which
// host you are looking at.
describe('hostRouteOf', () => {
  it('reads a channel and its host out of a group route', () => {
    const path = `/groups/${encodeURIComponent("wss://relay.example.com'general")}`;
    expect(hostRouteOf(path)).toEqual({ relay: 'wss://relay.example.com/', channelId: 'general' });
  });

  it('reads the host out of a directory route, with no channel open', () => {
    const path = `/relays/${encodeURIComponent('wss://relay.example.com')}`;
    expect(hostRouteOf(path)).toEqual({ relay: 'wss://relay.example.com', channelId: null });
  });

  it('is nothing outside a host route, and never throws on a broken one', () => {
    expect(hostRouteOf('/discover')).toBeNull();
    expect(hostRouteOf('/private/area-1')).toBeNull();
    expect(hostRouteOf('/relays')).toBeNull();
    expect(hostRouteOf('/relays/%')).toBeNull();
    expect(hostRouteOf('/groups/not%20a%20pointer')).toBeNull();
    expect(hostRouteOf('')).toBeNull();
  });

  // The rail's answer has to stay derived from this one, or the sidebar could
  // mark a host the rail does not.
  it('agrees with the rail about which host a route is inside', () => {
    for (const path of [
      `/groups/${encodeURIComponent("wss://relay.example.com'general")}`,
      `/relays/${encodeURIComponent('wss://edufeed.communities.buzz.xyz')}`
    ]) {
      expect(activeRailTarget({ pathname: path })).toEqual({
        kind: 'relay',
        relay: /** @type {any} */ (hostRouteOf(path)).relay
      });
    }
  });
});
