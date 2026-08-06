/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { buildRailEntries, entriesOf } from '$lib/rail/rail-entries.js';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);

describe('buildRailEntries', () => {
  it('is empty when the rail is', () => {
    expect(buildRailEntries({})).toEqual([]);
  });

  // The default order is what the rail showed before it became arrangeable,
  // so nobody's sidebar rearranges itself the day this ships.
  it('keeps the order the rail had: communities, areas, hosts', () => {
    const entries = buildRailEntries({
      communityPubkeys: [A],
      areas: [{ communityId: 'area-1' }],
      groups: [
        {
          key: 'allgemein@wss://r.example/',
          pointer: { id: 'allgemein', relay: 'wss://r.example/' }
        }
      ]
    });
    expect(entries.map((e) => e.kind)).toEqual(['community', 'area', 'relay']);
    expect(entries.map((e) => e.key)).toEqual([
      `community:${A}`,
      'area:area-1',
      'relay:wss://r.example/'
    ]);
  });

  // The point of grouping by host: several channels on one relay are ONE
  // container, and the entry carries all of them.
  it('folds every channel on a host into a single entry', () => {
    const rows = [
      { key: 'a@wss://one/', pointer: { id: 'a', relay: 'wss://one/' } },
      { key: 'b@wss://two/', pointer: { id: 'b', relay: 'wss://two/' } },
      { key: 'c@wss://one/', pointer: { id: 'c', relay: 'wss://one/' } }
    ];
    const entries = buildRailEntries({ groups: rows });
    expect(entries.map((e) => e.key)).toEqual(['relay:wss://one/', 'relay:wss://two/']);
    expect(/** @type {any} */ (entries[0]).rows.map((/** @type {any} */ r) => r.key)).toEqual([
      'a@wss://one/',
      'c@wss://one/'
    ]);
  });

  it('carries the row each kind needs to draw itself', () => {
    const area = { communityId: 'area-1', name: 'Leitung' };
    const row = { key: 'g@wss://r/', name: 'Allgemein', pointer: { id: 'g', relay: 'wss://r/' } };
    const entries = buildRailEntries({ communityPubkeys: [A], areas: [area], groups: [row] });
    expect(entries[0]).toMatchObject({ kind: 'community', pubkey: A });
    expect(entries[1]).toMatchObject({ kind: 'area', area });
    expect(entries[2]).toMatchObject({ kind: 'relay', relay: 'wss://r/', rows: [row] });
  });

  // A key that cannot be built cannot be stored in a layout either, so such an
  // entry could never be moved — absent beats pinned forever.
  it('drops an entry it cannot address', () => {
    const entries = buildRailEntries({
      communityPubkeys: [/** @type {any} */ (''), A],
      areas: [/** @type {any} */ ({}), { communityId: 'ok' }],
      groups: [
        /** @type {any} */ ({}),
        { key: 'g@wss://r/', pointer: { id: 'g', relay: 'wss://r/' } }
      ]
    });
    expect(entries.map((e) => e.key)).toEqual([`community:${A}`, 'area:ok', 'relay:wss://r/']);
  });

  it('never lists the same container twice', () => {
    const entries = buildRailEntries({ communityPubkeys: [A, A, B] });
    expect(entries.map((e) => e.key)).toEqual([`community:${A}`, `community:${B}`]);
  });

  // The namespaces exist for exactly this: a Concord area whose id happens to
  // equal a community's pubkey is still its own row.
  it('keeps a community and an area that share an id apart', () => {
    const entries = buildRailEntries({ communityPubkeys: [A], areas: [{ communityId: A }] });
    expect(entries).toHaveLength(2);
  });
});

describe('entriesOf', () => {
  it('resolves a folder to its rows, in the folder order', () => {
    const entries = buildRailEntries({ communityPubkeys: [A, B] });
    const byKey = new Map(entries.map((e) => [e.key, e]));
    expect(entriesOf([`community:${B}`, `community:${A}`], byKey).map((e) => e.key)).toEqual([
      `community:${B}`,
      `community:${A}`
    ]);
  });

  it('skips a member whose container has gone away', () => {
    const entries = buildRailEntries({ communityPubkeys: [A] });
    const byKey = new Map(entries.map((e) => [e.key, e]));
    expect(entriesOf([`community:${A}`, 'community:gone'], byKey)).toHaveLength(1);
  });
});
