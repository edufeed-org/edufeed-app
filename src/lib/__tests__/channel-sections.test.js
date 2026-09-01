/** @vitest-environment node */
/**
 * Channels and direct messages, in the sidebar's two sections.
 *
 * NIP-29 has one object for both: a DM on a Buzz relay is a group like any
 * other. What separates them is the group's OWN self-description — the `t`
 * tag on its kind:39000 — so the split is read, never guessed. Measured
 * against wss://edufeed.communities.buzz.xyz (2026-08-06): 19 groups, exactly
 * one carries `t=dm` (with `private`, `closed` and `hidden` beside it); every
 * other one carries `t=stream`.
 *
 * A host that does not use the convention has no `t` at all, and then every
 * row belongs under Channels — an empty "Direct messages" heading would be a
 * section we invented.
 */
import { describe, it, expect } from 'vitest';
import { buildChannelRows } from '$lib/groups/community-channel-rows.js';
import { channelAccessLevel } from '$lib/groups/channel-access.js';
import { splitChannelSections, splitFavouriteRows } from '$lib/groups/channel-sections.js';

const R = 'wss://groups.example';
const meta = (/** @type {string} */ id, /** @type {string[][]} */ extra = []) => ({
  kind: 39000,
  tags: [['d', id], ...extra]
});

/** Rows through the REAL builder: a hand-written row could carry a category
 * the builder never produces. Feeds it the subtree-channel shape the builder
 * now consumes (id/relay/name/level/metadata). */
const rowsFor = (/** @type {Record<string, string[][]>} */ byId) => {
  const subtreeChannels = Object.entries(byId).map(([id, tags]) => {
    const metadata = meta(id, tags);
    return {
      id,
      relay: R,
      name: metadata.tags.find((t) => t[0] === 'name')?.[1],
      level: channelAccessLevel(metadata),
      metadata
    };
  });
  return buildChannelRows({ subtreeChannels });
};

describe('buildChannelRows — what a group says it is', () => {
  it("takes the group's own t tag", () => {
    const rows = rowsFor({
      allgemein: [
        ['name', 'allgemein'],
        ['t', 'stream']
      ],
      dm: [['name', 'DM'], ['t', 'dm'], ['private'], ['hidden']]
    });
    // Sorted by name, locale-aware — 'allgemein' before 'DM' under 'de'.
    expect(rows.map((r) => [r.name, /** @type {any} */ (r).category])).toEqual([
      ['allgemein', 'channel'],
      ['DM', 'dm']
    ]);
  });

  it('is a channel when the host announces no type at all', () => {
    const rows = rowsFor({ allgemein: [['name', 'allgemein']] });
    expect(/** @type {any} */ (rows[0]).category).toBe('channel');
  });

  // A `hidden` tag means the relay may keep the group out of its open listing.
  // Armada reads it as a second DM signal because early Buzz DMs carried no
  // `t`; the relay measured here writes BOTH, so the weaker signal buys
  // nothing and would misfile a hidden channel on any other host.
  it('does not read a hidden channel as a direct message', () => {
    const rows = rowsFor({ geheim: [['name', 'geheim'], ['private'], ['hidden']] });
    expect(/** @type {any} */ (rows[0]).category).toBe('channel');
  });

  it('leaves a Concord channel alone — Concord has no DM object', () => {
    const rows = buildChannelRows({
      concordChannels: [{ channel_id: 'c1', name: 'intern', accessible: true }]
    });
    expect(/** @type {any} */ (rows[0]).category).toBeUndefined();
  });
});

describe('splitChannelSections', () => {
  it('puts each row in exactly one section, order preserved', () => {
    const rows = rowsFor({
      allgemein: [
        ['name', 'allgemein'],
        ['t', 'stream']
      ],
      dm: [
        ['name', 'DM'],
        ['t', 'dm']
      ],
      zuletzt: [
        ['name', 'zuletzt'],
        ['t', 'stream']
      ]
    });
    const { channels, dms } = splitChannelSections(rows);
    expect(channels.map((r) => r.name)).toEqual(['allgemein', 'zuletzt']);
    expect(dms.map((r) => r.name)).toEqual(['DM']);
    expect(channels.length + dms.length).toBe(rows.length);
  });

  it('gives a Concord row to the channels section', () => {
    const rows = buildChannelRows({
      concordChannels: [{ channel_id: 'c1', name: 'intern', accessible: true }]
    });
    const { channels, dms } = splitChannelSections(rows);
    expect(channels).toHaveLength(1);
    expect(dms).toHaveLength(0);
  });

  it('has no direct-message section on a host that names none', () => {
    const { dms } = splitChannelSections(rowsFor({ allgemein: [['name', 'allgemein']] }));
    expect(dms).toEqual([]);
  });

  // The rows arrive from a network-fed builder through two call sites; a hole
  // in the list must not become a row in a section.
  it('drops a hole in the list rather than sectioning it', () => {
    const [row] = rowsFor({ allgemein: [['name', 'allgemein']] });
    const { channels, dms } = splitChannelSections(/** @type {any} */ ([null, row, undefined]));
    expect(channels).toEqual([row]);
    expect(dms).toEqual([]);
  });

  it('survives an empty list', () => {
    expect(splitChannelSections([])).toEqual({ channels: [], dms: [] });
    expect(splitChannelSections(/** @type {any} */ (undefined))).toEqual({ channels: [], dms: [] });
  });
});

describe('splitFavouriteRows', () => {
  const rows = () =>
    rowsFor({
      allgemein: [
        ['name', 'allgemein'],
        ['t', 'stream']
      ],
      mathe: [
        ['name', 'Mathe'],
        ['t', 'stream']
      ],
      physik: [
        ['name', 'Physik'],
        ['t', 'stream']
      ]
    });

  it('lifts starred rows into favourites, order preserved on both sides', () => {
    const all = rows();
    const starred = new Set([all[2].key, all[0].key]);
    const { favourites, rest } = splitFavouriteRows(all, starred);
    expect(favourites.map((r) => r.name)).toEqual(['allgemein', 'Physik']);
    expect(rest.map((r) => r.name)).toEqual(['Mathe']);
  });

  it('has no favourites section when nothing is starred', () => {
    const all = rows();
    const { favourites, rest } = splitFavouriteRows(all, new Set());
    expect(favourites).toEqual([]);
    expect(rest).toEqual(all);
  });

  it('ignores a stale favourite key with no matching row', () => {
    const all = rows();
    const { favourites, rest } = splitFavouriteRows(all, new Set(['group:gone@wss://x.example/']));
    expect(favourites).toEqual([]);
    expect(rest).toEqual(all);
  });

  it('drops a hole in the list rather than sectioning it', () => {
    const [row] = rows();
    const { favourites, rest } = splitFavouriteRows(
      /** @type {any} */ ([null, row, undefined]),
      new Set([row.key])
    );
    expect(favourites).toEqual([row]);
    expect(rest).toEqual([]);
  });

  it('survives an empty list and a missing set', () => {
    expect(splitFavouriteRows([], new Set())).toEqual({ favourites: [], rest: [] });
    expect(
      splitFavouriteRows(/** @type {any} */ (undefined), /** @type {any} */ (undefined))
    ).toEqual({
      favourites: [],
      rest: []
    });
  });
});
