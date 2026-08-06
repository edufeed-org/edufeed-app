// The community rail as one arrangeable list.
//
// The rail shows three kinds of container — joined communities, unlinked
// Concord areas, and unlinked NIP-29 groups — and until now each had its own
// section. Armada puts all of its containers in ONE rail the user orders
// freely, with Discord-style folders; that is the parity laoc asked for
// (2026-08-06), so the sections become one list here.
//
// Everything is pure. Where the arrangement is STORED is the caller's problem
// (rail-layout-store.svelte.js) — deliberately, because the rail names private
// Concord areas and privately-held groups, so it must not be published as a
// plain nostr event, and an encrypted one should be able to replace the local
// store without touching a line of this file.
//
// The live set is always passed in alongside the stored layout: a stored key
// that no longer resolves must not hold a slot, and a container that appeared
// since the last save must not be invisible. `normalizeLayout` is the only
// place that reconciles the two, and every other function here assumes it ran.

/**
 * @typedef {{type: 'item', key: string}} RailItemNode
 * @typedef {{type: 'folder', id: string, name: string, keys: string[]}} RailFolderNode
 * @typedef {RailItemNode | RailFolderNode} RailNode
 */

/**
 * A drop target: before or after another entry at the top level, or inside a
 * folder. Exactly one field is honoured, checked in this order.
 * @typedef {{beforeKey?: string, afterKey?: string, intoFolder?: string}} RailDrop
 */

/** A folder is addressed in a move by this prefix; item keys never carry it. */
const FOLDER_PREFIX = 'folder:';

/**
 * The stable key of a rail entry.
 *
 * Namespaced by kind on purpose: a community's pubkey and a Concord community
 * id are both 64 hex characters, so the bare id would name two different rooms
 * with one string.
 *
 * @param {{kind: 'community', pubkey: string}
 *   | {kind: 'area', communityId: string}
 *   | {kind: 'group', key: string}} entry
 * @returns {string | null} null when the entry cannot be addressed
 */
export function railKey(entry) {
  if (!entry) return null;
  if (entry.kind === 'community') return entry.pubkey ? `community:${entry.pubkey}` : null;
  if (entry.kind === 'area') return entry.communityId ? `area:${entry.communityId}` : null;
  if (entry.kind === 'group') return entry.key ? `group:${entry.key}` : null;
  return null;
}

/** @param {string} id */
export function folderAnchor(id) {
  return `${FOLDER_PREFIX}${id}`;
}

/** @param {string} anchor @returns {string | null} */
export function folderIdOf(anchor) {
  return typeof anchor === 'string' && anchor.startsWith(FOLDER_PREFIX)
    ? anchor.slice(FOLDER_PREFIX.length)
    : null;
}

/**
 * Reconcile a stored layout with the containers that actually exist.
 *
 * Stored order wins; live keys the layout has never seen are appended in live
 * order; keys that no longer resolve are dropped, and a folder that loses its
 * last member goes with them. Idempotent — normalizing a normal layout returns
 * an equal one, which is what lets the store save the normalized value back
 * without a write loop.
 *
 * Every input is untrusted: it comes off disk (and, one day, off a relay).
 *
 * @param {unknown} stored
 * @param {string[]} liveKeys in the order the rail would show them by default
 * @returns {RailNode[]}
 */
export function normalizeLayout(stored, liveKeys) {
  const live = new Set(Array.isArray(liveKeys) ? liveKeys : []);
  const placed = new Set();
  /** @type {RailNode[]} */
  const out = [];

  for (const node of Array.isArray(stored) ? stored : []) {
    if (!node || typeof node !== 'object') continue;
    if (/** @type {any} */ (node).type === 'item') {
      const key = /** @type {any} */ (node).key;
      if (typeof key !== 'string' || !live.has(key) || placed.has(key)) continue;
      placed.add(key);
      out.push({ type: 'item', key });
      continue;
    }
    if (/** @type {any} */ (node).type !== 'folder') continue;
    const { id, name, keys } = /** @type {any} */ (node);
    if (typeof id !== 'string' || !id) continue;
    const members = (Array.isArray(keys) ? keys : []).filter(
      (/** @type {any} */ k) => typeof k === 'string' && live.has(k) && !placed.has(k)
    );
    // A folder nobody can see into is a slot the user cannot use.
    if (members.length === 0) continue;
    for (const key of members) placed.add(key);
    out.push({ type: 'folder', id, name: typeof name === 'string' ? name : '', keys: members });
  }

  for (const key of live) {
    if (!placed.has(key)) out.push({ type: 'item', key });
  }
  return out;
}

/**
 * Every key in the order a reader meets it, folders read out in place.
 * @param {RailNode[]} layout
 * @returns {string[]}
 */
export function flattenLayout(layout) {
  /** @type {string[]} */
  const keys = [];
  for (const node of layout ?? []) {
    if (node.type === 'item') keys.push(node.key);
    else keys.push(...node.keys);
  }
  return keys;
}

/**
 * Move one entry — an item key, or `folder:<id>` for a folder — to a drop
 * target. Returns a NEW layout; the given one is never touched.
 *
 * A move that would lose the entry (onto itself, a folder into its own belly,
 * an unknown source or target) is a no-op: silently dropping a container from
 * the rail is far worse than a drag that does nothing.
 *
 * @param {RailNode[]} layout
 * @param {string} anchor
 * @param {RailDrop} drop
 * @returns {RailNode[]}
 */
export function moveEntry(layout, anchor, drop) {
  const folderId = folderIdOf(anchor);
  const detached = detach(layout, anchor);
  if (!detached) return layout;
  const { rest, node } = detached;

  if (drop?.intoFolder) {
    // Only items go into folders — a folder inside a folder is a tree the rail
    // cannot draw, and putting a folder into itself would lose everything.
    if (node.type !== 'item') return layout;
    let found = false;
    const next = rest.map((n) => {
      if (n.type !== 'folder' || n.id !== drop.intoFolder) return n;
      found = true;
      return { ...n, keys: [...n.keys, node.key] };
    });
    return found ? prune(next) : layout;
  }

  const targetKey = drop?.beforeKey ?? drop?.afterKey;
  if (typeof targetKey !== 'string') return layout;
  // Dropping a folder onto its own anchor, or an item onto itself.
  if (targetKey === anchor || (folderId && targetKey === anchor)) return layout;

  const index = rest.findIndex((n) =>
    n.type === 'item' ? n.key === targetKey : folderAnchor(n.id) === targetKey
  );
  if (index === -1) return layout;

  const at = drop.beforeKey !== undefined ? index : index + 1;
  const next = [...rest.slice(0, at), node, ...rest.slice(at)];
  return prune(next);
}

/**
 * Fold `sourceKey` onto `targetKey`: the target's slot becomes a folder
 * holding both, target first — the Discord/Armada gesture. If the target
 * already sits in a folder, the source joins that one instead and the new name
 * is ignored: the user dropped onto a folder that already has a name.
 *
 * `newId` is injected rather than generated here so the model stays pure and a
 * test can pin the id.
 *
 * @param {RailNode[]} layout
 * @param {string} sourceKey
 * @param {string} targetKey
 * @param {string} name
 * @param {() => string} newId
 * @returns {RailNode[]}
 */
export function makeFolder(layout, sourceKey, targetKey, name, newId) {
  if (!sourceKey || sourceKey === targetKey) return layout;

  const host = (layout ?? []).find((n) => n.type === 'folder' && n.keys.includes(targetKey));
  if (host && host.type === 'folder') return moveEntry(layout, sourceKey, { intoFolder: host.id });

  const detached = detach(layout, sourceKey);
  if (!detached || detached.node.type !== 'item') return layout;
  const { rest, node } = detached;

  const index = rest.findIndex((n) => n.type === 'item' && n.key === targetKey);
  if (index === -1) return layout;

  /** @type {RailFolderNode} */
  const created = { type: 'folder', id: newId(), name, keys: [targetKey, node.key] };
  return [...rest.slice(0, index), created, ...rest.slice(index + 1)];
}

/**
 * @param {RailNode[]} layout
 * @param {string} id
 * @param {string} name a blank name is ignored — a nameless folder is unusable
 * @returns {RailNode[]}
 */
export function renameFolder(layout, id, name) {
  const trimmed = typeof name === 'string' ? name.trim() : '';
  if (!trimmed) return layout;
  let found = false;
  const next = (layout ?? []).map((n) => {
    if (n.type !== 'folder' || n.id !== id) return n;
    found = true;
    return { ...n, name: trimmed };
  });
  return found ? next : layout;
}

/**
 * Spill a folder's members back into its own slot, in their own order.
 * @param {RailNode[]} layout
 * @param {string} id
 * @returns {RailNode[]}
 */
export function dissolveFolder(layout, id) {
  let found = false;
  /** @type {RailNode[]} */
  const next = [];
  for (const node of layout ?? []) {
    if (node.type === 'folder' && node.id === id) {
      found = true;
      for (const key of node.keys) next.push({ type: 'item', key });
    } else next.push(node);
  }
  return found ? next : layout;
}

/**
 * What a drop at this height over a rail row means.
 *
 * The rail is one narrow column, so there is no room for separate "reorder"
 * and "into folder" targets: the row itself is both, split by where the
 * pointer sits. Outer quarters reorder, the middle half folds — the same
 * gesture Discord and Armada use, and the same reason (dropping ONTO a thing
 * means "these belong together", dropping at its edge means "put it here").
 *
 * @param {number} offsetY pointer position inside the row
 * @param {number} height the row's height
 * @returns {'before' | 'into' | 'after'}
 */
export function dropIntent(offsetY, height) {
  if (!(height > 0) || typeof offsetY !== 'number' || Number.isNaN(offsetY)) return 'into';
  const ratio = offsetY / height;
  if (ratio < 0.25) return 'before';
  if (ratio > 0.75) return 'after';
  return 'into';
}

/**
 * Apply a dragged entry to a row under one of {@link dropIntent}'s readings.
 *
 * 'into' is the only one that branches on what the target IS: an existing
 * folder swallows the entry, a bare item becomes a new folder holding both.
 *
 * @param {RailNode[]} layout
 * @param {string} anchor the dragged entry (item key or `folder:<id>`)
 * @param {string} targetAnchor the row it was dropped on
 * @param {'before' | 'into' | 'after'} intent
 * @param {string} newFolderName used only when a new folder is created
 * @param {() => string} newId
 * @returns {RailNode[]}
 */
export function resolveDrop(layout, anchor, targetAnchor, intent, newFolderName, newId) {
  if (!anchor || !targetAnchor || anchor === targetAnchor) return layout;
  if (intent === 'before') return moveEntry(layout, anchor, { beforeKey: targetAnchor });
  if (intent === 'after') return moveEntry(layout, anchor, { afterKey: targetAnchor });

  const targetFolderId = folderIdOf(targetAnchor);
  if (targetFolderId) return moveEntry(layout, anchor, { intoFolder: targetFolderId });
  // There is no second level, so a FOLDER dropped on an item has to do
  // nothing. That refusal is not repeated here: makeFolder already returns the
  // layout unchanged for a source that is not an item, and so does moveEntry
  // on the branch makeFolder takes when the target already sits in a folder.
  // A guard here as well was measured and found dead — mutation-tested 2026-08-06.
  return makeFolder(layout, anchor, targetAnchor, newFolderName, newId);
}

/**
 * Lift one entry out of the layout. Returns the remaining nodes and the node
 * that came out, or null when the anchor names nothing.
 * @param {RailNode[]} layout
 * @param {string} anchor
 * @returns {{rest: RailNode[], node: RailNode} | null}
 */
function detach(layout, anchor) {
  const folderId = folderIdOf(anchor);
  /** @type {RailNode | null} */
  let node = null;
  /** @type {RailNode[]} */
  const rest = [];

  for (const current of layout ?? []) {
    if (folderId) {
      if (current.type === 'folder' && current.id === folderId) {
        node = current;
        continue;
      }
      rest.push(current);
      continue;
    }
    if (current.type === 'item') {
      if (current.key === anchor) {
        node = current;
        continue;
      }
      rest.push(current);
      continue;
    }
    if (current.keys.includes(anchor)) {
      node = { type: 'item', key: anchor };
      rest.push({ ...current, keys: current.keys.filter((k) => k !== anchor) });
      continue;
    }
    rest.push(current);
  }

  return node ? { rest, node } : null;
}

/** Drop folders left empty by a move. */
function prune(/** @type {RailNode[]} */ layout) {
  return layout.filter((n) => n.type === 'item' || n.keys.length > 0);
}
