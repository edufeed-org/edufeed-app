/** @vitest-environment node */
/**
 * The rail's layout model: one ordered list of everything the sidebar shows,
 * with Discord-style folders.
 *
 * Every test here drives the model through `normalizeLayout` the way the rail
 * does, because the live set is what makes a stored layout meaningful: a key
 * that no longer resolves must not hold a slot, and a container that appeared
 * since the last save must not be invisible.
 */
import { describe, it, expect } from 'vitest';
import {
  railKey,
  folderAnchor,
  normalizeLayout,
  flattenLayout,
  moveEntry,
  makeFolder,
  renameFolder,
  dissolveFolder,
  dropIntent,
  resolveDrop
} from '$lib/rail/rail-layout.js';

const PUBKEY = 'a'.repeat(64);

/**
 * shorthand: a top-level item node
 * @param {string} key
 * @returns {import('$lib/rail/rail-layout.js').RailNode}
 */
const item = (key) => ({ type: 'item', key });
/**
 * shorthand: a folder node
 * @param {string} id
 * @param {string} name
 * @param {string[]} keys
 * @returns {import('$lib/rail/rail-layout.js').RailNode}
 */
const folder = (id, name, keys) => ({ type: 'folder', id, name, keys });

describe('railKey', () => {
  it('gives each kind of container its own namespace', () => {
    expect(railKey({ kind: 'community', pubkey: PUBKEY })).toBe(`community:${PUBKEY}`);
    expect(railKey({ kind: 'area', communityId: 'abc' })).toBe('area:abc');
    expect(railKey({ kind: 'relay', relay: 'wss://r.example/' })).toBe('relay:wss://r.example/');
  });

  // A community pubkey and a Concord community id are both 64 hex chars, so
  // without the namespace the same string would name two different rooms.
  it('keeps a community and an area with the same id apart', () => {
    expect(railKey({ kind: 'community', pubkey: PUBKEY })).not.toBe(
      railKey({ kind: 'area', communityId: PUBKEY })
    );
  });

  it('refuses an entry it cannot address', () => {
    expect(railKey(/** @type {any} */ ({ kind: 'community' }))).toBeNull();
    expect(railKey(/** @type {any} */ ({ kind: 'nonsense', key: 'x' }))).toBeNull();
    expect(railKey(/** @type {any} */ (null))).toBeNull();
  });
});

describe('normalizeLayout', () => {
  it('is the live order itself when nothing has been arranged', () => {
    expect(flattenLayout(normalizeLayout([], ['a', 'b', 'c']))).toEqual(['a', 'b', 'c']);
  });

  // The whole point of storing a layout: a container the user moved stays
  // where they put it, even though the live list still arrives in its own
  // order.
  it('keeps the stored order over the live order', () => {
    const layout = normalizeLayout([item('c'), item('a')], ['a', 'b', 'c']);
    expect(flattenLayout(layout)).toEqual(['c', 'a', 'b']);
  });

  it('appends containers that appeared since the layout was stored', () => {
    const layout = normalizeLayout([item('b')], ['a', 'b']);
    expect(flattenLayout(layout)).toEqual(['b', 'a']);
  });

  // A key that no longer resolves must not hold a slot — otherwise leaving a
  // community would leave a gap nothing can fill.
  it('drops a key that is no longer live', () => {
    const layout = normalizeLayout([item('a'), item('gone'), item('b')], ['a', 'b']);
    expect(flattenLayout(layout)).toEqual(['a', 'b']);
  });

  it('drops a dead key from inside a folder too', () => {
    const layout = normalizeLayout([folder('f1', 'Schule', ['a', 'gone'])], ['a', 'b']);
    expect(layout).toEqual([
      { type: 'folder', id: 'f1', name: 'Schule', keys: ['a'] },
      { type: 'item', key: 'b' }
    ]);
  });

  // An empty folder is a slot the user cannot see into and cannot use.
  it('removes a folder whose last member went away', () => {
    const layout = normalizeLayout([folder('f1', 'Schule', ['gone']), item('a')], ['a']);
    expect(layout).toEqual([{ type: 'item', key: 'a' }]);
  });

  it('never lists the same key twice, even if the stored layout does', () => {
    const layout = normalizeLayout(
      [item('a'), folder('f1', 'F', ['a', 'b']), item('a')],
      ['a', 'b']
    );
    expect(flattenLayout(layout)).toEqual(['a', 'b']);
  });

  it('is stable: normalizing an already-normal layout changes nothing', () => {
    const once = normalizeLayout([item('c'), folder('f1', 'F', ['a'])], ['a', 'b', 'c']);
    expect(normalizeLayout(once, ['a', 'b', 'c'])).toEqual(once);
  });

  it('survives a stored value that is not a layout at all', () => {
    for (const junk of [null, undefined, 'nope', 42, [null], [{ type: 'item' }], [{}]]) {
      expect(flattenLayout(normalizeLayout(/** @type {any} */ (junk), ['a']))).toEqual(['a']);
    }
  });
});

describe('flattenLayout', () => {
  it('reads a folder out in place, in its own order', () => {
    const layout = [item('a'), folder('f1', 'F', ['b', 'c']), item('d')];
    expect(flattenLayout(layout)).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('moveEntry', () => {
  const live = ['a', 'b', 'c'];

  it('drops an item before another one', () => {
    const layout = normalizeLayout([], live);
    expect(flattenLayout(moveEntry(layout, 'c', { beforeKey: 'a' }))).toEqual(['c', 'a', 'b']);
  });

  it('drops an item after another one', () => {
    const layout = normalizeLayout([], live);
    expect(flattenLayout(moveEntry(layout, 'a', { afterKey: 'c' }))).toEqual(['b', 'c', 'a']);
  });

  it('moves an item into a folder', () => {
    const layout = normalizeLayout([folder('f1', 'F', ['a']), item('b'), item('c')], live);
    const next = moveEntry(layout, 'c', { intoFolder: 'f1' });
    expect(next).toEqual([
      { type: 'folder', id: 'f1', name: 'F', keys: ['a', 'c'] },
      { type: 'item', key: 'b' }
    ]);
  });

  it('moves an item out of a folder back to the top level', () => {
    const layout = normalizeLayout([folder('f1', 'F', ['a', 'b']), item('c')], live);
    const next = moveEntry(layout, 'b', { afterKey: 'c' });
    expect(next).toEqual([
      { type: 'folder', id: 'f1', name: 'F', keys: ['a'] },
      { type: 'item', key: 'c' },
      { type: 'item', key: 'b' }
    ]);
  });

  it('dissolves the folder the last member just left', () => {
    const layout = normalizeLayout([folder('f1', 'F', ['a']), item('b')], live);
    expect(moveEntry(layout, 'a', { beforeKey: 'b' })).toEqual([
      { type: 'item', key: 'a' },
      { type: 'item', key: 'b' },
      // `live` also holds 'c', which normalizeLayout appended.
      { type: 'item', key: 'c' }
    ]);
  });

  it('reorders a folder itself', () => {
    const layout = normalizeLayout([item('a'), folder('f1', 'F', ['b'])], live);
    const next = moveEntry(layout, 'folder:f1', { beforeKey: 'a' });
    expect(next[0]).toMatchObject({ type: 'folder', id: 'f1' });
  });

  // Dropping something on itself, or a folder into its own belly, must be a
  // no-op rather than a lost entry.
  it('is a no-op for a move that would lose the entry', () => {
    const layout = normalizeLayout([item('a'), folder('f1', 'F', ['b'])], live);
    expect(moveEntry(layout, 'a', { beforeKey: 'a' })).toEqual(layout);
    expect(moveEntry(layout, 'folder:f1', { intoFolder: 'f1' })).toEqual(layout);
    expect(moveEntry(layout, 'a', { intoFolder: 'nope' })).toEqual(layout);
    expect(moveEntry(layout, 'nothing', { beforeKey: 'a' })).toEqual(layout);
  });

  // Found by mutation: returning the layout with the dragged entry already
  // lifted out broke no test. A drop onto a row that is not in the layout —
  // a container that left while the drag was in flight — would then take the
  // dragged one off the rail with it.
  it('keeps the entry when the drop target is not in the layout', () => {
    const layout = normalizeLayout([item('a'), folder('f1', 'F', ['b'])], live);
    expect(moveEntry(layout, 'a', { beforeKey: 'left-the-rail' })).toEqual(layout);
    expect(moveEntry(layout, 'a', { afterKey: 'left-the-rail' })).toEqual(layout);
    expect(moveEntry(layout, folderAnchor('f1'), { beforeKey: 'left-the-rail' })).toEqual(layout);
    expect(flattenLayout(moveEntry(layout, 'a', { beforeKey: 'left-the-rail' }))).toContain('a');
  });

  it('leaves the layout it was given untouched', () => {
    const layout = normalizeLayout([], live);
    const before = JSON.stringify(layout);
    moveEntry(layout, 'c', { beforeKey: 'a' });
    expect(JSON.stringify(layout)).toBe(before);
  });
});

describe('makeFolder', () => {
  const live = ['a', 'b', 'c'];

  it('makes a folder where the target sat, holding both', () => {
    const layout = normalizeLayout([], live);
    const next = makeFolder(layout, 'c', 'a', 'Schule', () => 'f1');
    expect(next).toEqual([
      { type: 'folder', id: 'f1', name: 'Schule', keys: ['a', 'c'] },
      { type: 'item', key: 'b' }
    ]);
  });

  it('refuses to fold an item into itself', () => {
    const layout = normalizeLayout([], live);
    expect(makeFolder(layout, 'a', 'a', 'F', () => 'f1')).toEqual(layout);
  });

  it('adds to the existing folder when the target is already in one', () => {
    const layout = normalizeLayout([folder('f1', 'Schule', ['a']), item('b'), item('c')], live);
    const next = makeFolder(layout, 'c', 'a', 'Neu', () => 'f2');
    expect(next).toEqual([
      { type: 'folder', id: 'f1', name: 'Schule', keys: ['a', 'c'] },
      { type: 'item', key: 'b' }
    ]);
  });
});

describe('renameFolder / dissolveFolder', () => {
  const live = ['a', 'b'];

  it('renames one folder and leaves the rest alone', () => {
    const layout = normalizeLayout([folder('f1', 'Alt', ['a']), item('b')], live);
    const next = renameFolder(layout, 'f1', '  Neu  ');
    expect(next[0]).toMatchObject({ name: 'Neu' });
    expect(next[1]).toEqual({ type: 'item', key: 'b' });
  });

  it('ignores a rename to nothing rather than leaving a nameless folder', () => {
    const layout = normalizeLayout([folder('f1', 'Alt', ['a'])], live);
    expect(renameFolder(layout, 'f1', '   ')).toEqual(layout);
    expect(renameFolder(layout, 'nope', 'Neu')).toEqual(layout);
  });

  it('spills a dissolved folder back in place, in its own order', () => {
    const layout = normalizeLayout([item('b'), folder('f1', 'F', ['a'])], live);
    expect(dissolveFolder(layout, 'f1')).toEqual([
      { type: 'item', key: 'b' },
      { type: 'item', key: 'a' }
    ]);
  });
});

describe('dropIntent', () => {
  it('reads the outer quarters as reorder and the middle as fold', () => {
    expect(dropIntent(0, 48)).toBe('before');
    expect(dropIntent(11, 48)).toBe('before');
    expect(dropIntent(24, 48)).toBe('into');
    expect(dropIntent(37, 48)).toBe('after');
    expect(dropIntent(48, 48)).toBe('after');
  });

  // The boundaries themselves belong to the fold, so a slow drag across a row
  // reads before -> into -> after with no gap that means nothing.
  it('puts the boundaries on the folding side', () => {
    expect(dropIntent(12, 48)).toBe('into');
    expect(dropIntent(36, 48)).toBe('into');
  });

  // A row with no measured height would otherwise divide by zero and read as
  // 'before' for every drop — the one reading that silently reorders.
  it('falls back to fold when the row has no height to measure', () => {
    expect(dropIntent(10, 0)).toBe('into');
    expect(dropIntent(/** @type {any} */ (undefined), 48)).toBe('into');
    expect(dropIntent(Number.NaN, 48)).toBe('into');
  });
});

describe('resolveDrop', () => {
  const live = ['a', 'b', 'c'];
  const id = () => 'f9';

  it('reorders on before and after', () => {
    const layout = normalizeLayout([], live);
    expect(flattenLayout(resolveDrop(layout, 'c', 'a', 'before', 'F', id))).toEqual([
      'c',
      'a',
      'b'
    ]);
    expect(flattenLayout(resolveDrop(layout, 'a', 'c', 'after', 'F', id))).toEqual(['b', 'c', 'a']);
  });

  it('folds two items into a new folder', () => {
    const layout = normalizeLayout([], live);
    expect(resolveDrop(layout, 'c', 'a', 'into', 'Schule', id)).toEqual([
      { type: 'folder', id: 'f9', name: 'Schule', keys: ['a', 'c'] },
      { type: 'item', key: 'b' }
    ]);
  });

  it('drops into an existing folder instead of nesting a new one', () => {
    const layout = normalizeLayout(
      [
        { type: 'folder', id: 'f1', name: 'Schule', keys: ['a'] },
        { type: 'item', key: 'b' }
      ],
      live
    );
    const next = resolveDrop(layout, 'b', folderAnchor('f1'), 'into', 'Neu', id);
    expect(next[0]).toEqual({ type: 'folder', id: 'f1', name: 'Schule', keys: ['a', 'b'] });
    expect(next.some((n) => n.type === 'folder' && n.id === 'f9')).toBe(false);
  });

  // There is no second level in this rail, so a folder dropped on an item has
  // to do nothing rather than half-happen.
  // Both target shapes are covered because they take DIFFERENT branches: a
  // bare item goes through makeFolder, an item already inside a folder goes
  // through moveEntry. resolveDrop repeats neither refusal itself.
  it('refuses to fold a folder into an item', () => {
    const layout = normalizeLayout([folder('f1', 'Schule', ['a']), item('b')], live);
    expect(resolveDrop(layout, folderAnchor('f1'), 'b', 'into', 'Neu', id)).toEqual(layout);
  });

  it('refuses to fold a folder onto an item that is inside another folder', () => {
    const layout = normalizeLayout(
      [folder('f1', 'Schule', ['a']), folder('f2', 'Arbeit', ['b']), item('c')],
      live
    );
    expect(resolveDrop(layout, folderAnchor('f1'), 'b', 'into', 'Neu', id)).toEqual(layout);
  });

  it('is a no-op when a row is dropped on itself', () => {
    const layout = normalizeLayout([], live);
    for (const intent of /** @type {const} */ (['before', 'into', 'after'])) {
      expect(resolveDrop(layout, 'a', 'a', intent, 'F', id)).toEqual(layout);
    }
  });
});

// CommunitySidebar keys its {#each} by folderAnchor(node.id); a stored/synced
// layout carrying two folders with the same id (corrupt localStorage, another
// client) must not crash the /c chrome with each_key_duplicate. normalizeLayout
// is the single reconciliation point, so it enforces id uniqueness: the first
// folder keeps the id, later ones are dropped and their members fall through
// to the trailing live-append as loose items.
describe('normalizeLayout — duplicate folder ids', () => {
  it('drops a second folder with the same id, keeping its members visible', () => {
    const stored = [
      { type: 'folder', id: 'f1', name: 'One', keys: ['a'] },
      { type: 'folder', id: 'f1', name: 'Two', keys: ['b'] }
    ];
    const out = normalizeLayout(stored, ['a', 'b']);
    expect(out).toEqual([
      { type: 'folder', id: 'f1', name: 'One', keys: ['a'] },
      { type: 'item', key: 'b' }
    ]);
  });
});
