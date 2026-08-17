/** @vitest-environment node */
/**
 * Which of the user's NIP-29 groups still need a place in the sidebar —
 * the ones no community they follow has claimed as a channel.
 *
 * Mirrors the Concord rule in concord/unlinked-areas.js: a membership that
 * IS reachable through a community page must not also sit loose in the
 * sidebar, or the same room appears twice under two different names.
 */
import { describe, it, expect } from 'vitest';
import { linkedChannelKeys, unlinkedGroups } from '$lib/groups/unlinked-groups.js';

const R = 'wss://groups.example';
const R2 = 'wss://other.example';

/** @param {string[][]} groupTags */
const community = (groupTags) => ({ kind: 10222, tags: [['d', 'relilab'], ...groupTags] });
const meta = (/** @type {string} */ name) => ({ kind: 39000, tags: [['name', name]] });

describe('linkedChannelKeys', () => {
  it('collects every channel pointer across every community', () => {
    const keys = linkedChannelKeys([
      community([['group', 'allgemein', R]]),
      community([
        ['group', 'leitung', R],
        ['group', 'projekt', R2]
      ])
    ]);
    expect(keys.size).toBe(3);
    expect(keys.has(`allgemein@${R}/`)).toBe(true);
    expect(keys.has(`projekt@${R2}/`)).toBe(true);
  });

  // The same group on two relays is two channels; the same channel written
  // with and without a trailing slash is one.
  it('compares after URL normalisation', () => {
    const keys = linkedChannelKeys([
      community([
        ['group', 'allgemein', 'wss://Groups.example'],
        ['group', 'allgemein', `${R}/`]
      ])
    ]);
    expect(keys.size).toBe(1);
  });

  it('ignores tags that carry no usable pointer', () => {
    expect(linkedChannelKeys([community([['group', 'allgemein', 'not a url']])]).size).toBe(0);
  });

  it('survives no communities at all', () => {
    expect(linkedChannelKeys(null).size).toBe(0);
  });
});

describe('unlinkedGroups', () => {
  const groups = [
    { id: 'allgemein', relay: R },
    { id: 'leitung', relay: R },
    { id: 'projekt', relay: R2 }
  ];

  it('drops the groups a followed community already shows as channels', () => {
    const linkedKeys = linkedChannelKeys([community([['group', 'leitung', R]])]);
    const rows = unlinkedGroups({ groups, linkedKeys });
    expect(rows.map((r) => r.pointer.id)).toEqual(['allgemein', 'projekt']);
  });

  it('keeps everything when no community claims anything', () => {
    expect(unlinkedGroups({ groups, linkedKeys: new Set() })).toHaveLength(3);
  });

  // The 10009 list carries only id and relay — the readable name lives in
  // the group's own kind:39000, which the community rail already fetches.
  it('names a row from its metadata when that has arrived', () => {
    const rows = unlinkedGroups({
      groups: [{ id: 'allgemein', relay: R }],
      linkedKeys: new Set(),
      metadataByKey: { [`allgemein@${R}/`]: meta('Allgemein') }
    });
    expect(rows[0].name).toBe('Allgemein');
  });

  it('falls back to the group id while the metadata is missing', () => {
    const rows = unlinkedGroups({ groups: [{ id: 'allgemein', relay: R }], linkedKeys: new Set() });
    expect(rows[0].name).toBe('allgemein');
  });

  it('sorts by the name a reader actually sees', () => {
    const rows = unlinkedGroups({
      groups,
      linkedKeys: new Set(),
      metadataByKey: { [`projekt@${R2}/`]: meta('Aaa-Projekt') }
    });
    expect(rows.map((r) => r.name)).toEqual(['Aaa-Projekt', 'allgemein', 'leitung']);
  });

  // The row shows the SAME glyph as the community rail, from the same rule.
  // An unlinked group carries no community intent, so a private one is drawn
  // with the lock and only the relay can make it world-readable.
  it('draws a group the relay leaves open as # with the globe', () => {
    const [row] = unlinkedGroups({
      groups: [{ id: 'ankuendigungen', relay: R }],
      linkedKeys: new Set(),
      metadataByKey: { [`ankuendigungen@${R}/`]: { kind: 39000, tags: [['restricted']] } }
    });
    expect(row.symbol).toBe('#');
    expect(row.locked).toBe(false);
    expect(row.worldReadable).toBe(true);
  });

  it('draws a private group with the lock', () => {
    const [row] = unlinkedGroups({
      groups: [{ id: 'leitung', relay: R }],
      linkedKeys: new Set(),
      metadataByKey: { [`leitung@${R}/`]: { kind: 39000, tags: [['private']] } }
    });
    expect(row.locked).toBe(true);
    expect(row.worldReadable).toBe(false);
  });

  it('draws a group whose metadata has not arrived as locked, not open', () => {
    const [row] = unlinkedGroups({ groups: [{ id: 'x', relay: R }], linkedKeys: new Set() });
    expect(row.locked).toBe(true);
    expect(row.worldReadable).toBe(false);
  });

  it('carries the pointer through so the row can link to the group', () => {
    const [row] = unlinkedGroups({
      groups: [{ id: 'allgemein', relay: R }],
      linkedKeys: new Set()
    });
    expect(row.pointer).toEqual({ id: 'allgemein', relay: R });
  });

  it('lists the same channel once even if the 10009 repeats it', () => {
    const rows = unlinkedGroups({
      groups: [
        { id: 'allgemein', relay: R },
        { id: 'allgemein', relay: `${R}/` }
      ],
      linkedKeys: new Set()
    });
    expect(rows).toHaveLength(1);
  });

  it('drops an entry that is not addressable rather than rendering a dead row', () => {
    const rows = unlinkedGroups({
      groups: [{ id: 'allgemein', relay: 'not a url' }],
      linkedKeys: new Set()
    });
    expect(rows).toHaveLength(0);
  });

  it('survives a missing list', () => {
    expect(unlinkedGroups({ groups: null, linkedKeys: new Set() })).toEqual([]);
  });
});
