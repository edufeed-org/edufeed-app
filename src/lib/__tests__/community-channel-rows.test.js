/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { buildChannelRows } from '$lib/groups/community-channel-rows.js';
import { channelKey } from '$lib/groups/community-pointer.js';
import { channelAccessLevel } from '$lib/groups/channel-access.js';

const R = 'wss://groups.example/c/root0';

// channelKey() is string|null by contract; every fixture here is addressable.
const key = (/** @type {any} */ p) => /** @type {string} */ (channelKey(p));

// A subtree channel, exactly as useCommunityChannels/buildSubtreeChannels
// produce it: id + relay + name + the level ALREADY computed from the relay's
// `private` flag + the kind:39000 metadata. buildChannelRows no longer resolves
// level or metadata itself.
const chan = (
  /** @type {string} */ id,
  /** @type {string[][]} */ tags = [],
  /** @type {{relay?: string, hostRequiresAuth?: boolean}} */ {
    relay = R,
    hostRequiresAuth = false
  } = {}
) => {
  const metadata = { kind: 39000, tags: [['d', id], ...tags] };
  return {
    id,
    relay,
    name: metadata.tags.find((t) => t[0] === 'name')?.[1],
    level: channelAccessLevel(metadata, undefined, hostRequiresAuth),
    metadata
  };
};

/** the shape PrivateChannelsView already renders */
const concord = (/** @type {string} */ name, /** @type {any} */ extra = {}) => ({
  channel_id: `c-${name}`,
  name,
  private: false,
  accessible: true,
  ...extra
});

describe('buildChannelRows', () => {
  it('is empty when there is nothing to show', () => {
    expect(buildChannelRows({})).toEqual([]);
  });

  it('keeps the concord rail working on its own', () => {
    const rows = buildChannelRows({ concordChannels: [concord('allgemein')] });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: 'allgemein',
      symbol: '#',
      locked: false,
      source: 'concord'
    });
  });

  it('carries the concord private flag into the lock', () => {
    const [row] = buildChannelRows({ concordChannels: [concord('leitung', { private: true })] });
    expect(row.symbol).toBe('#');
    expect(row.locked).toBe(true);
  });

  // Concord encrypts every channel, so no concord row is ever world-readable —
  // even the one it calls "public" only means "everyone in the area".
  it('never marks a concord channel world-readable', () => {
    const rows = buildChannelRows({
      concordChannels: [concord('allgemein'), concord('leitung', { private: true })]
    });
    expect(rows.every((r) => r.worldReadable === false)).toBe(true);
  });

  it('renders a subtree channel from its precomputed level and metadata', () => {
    const rows = buildChannelRows({ subtreeChannels: [chan('allgemein', [['private']])] });
    expect(rows[0]).toMatchObject({
      name: 'allgemein',
      symbol: '#',
      locked: true,
      source: 'group'
    });
  });

  it('shows the globe for a subtree channel the relay leaves open', () => {
    const rows = buildChannelRows({ subtreeChannels: [chan('ankuendigungen', [['restricted']])] });
    expect(rows[0]).toMatchObject({ symbol: '#', worldReadable: true, locked: false });
  });

  it('locks every private subtree channel (the members/invited marker is retired)', () => {
    const rows = buildChannelRows({
      subtreeChannels: [chan('allgemein', [['private']]), chan('leitung', [['private']])]
    });
    expect(rows.find((r) => r.name === 'allgemein')?.locked).toBe(true);
    expect(rows.find((r) => r.name === 'leitung')?.locked).toBe(true);
  });

  it('names a subtree channel from its 39000 name, else its id', () => {
    const rows = buildChannelRows({
      subtreeChannels: [chan('a', [['name', 'Aus den Metadaten']]), chan('c')]
    });
    expect(rows.map((r) => r.name).sort()).toEqual(['Aus den Metadaten', 'c']);
  });

  it('pins the root membership group first, labeled General (not its own name)', () => {
    const rows = buildChannelRows({
      // the root's own 39000 name is the community name — must be overridden.
      rootChannel: chan('root0', [['name', 'laoc42']]),
      rootLabel: 'Allgemein',
      subtreeChannels: [chan('willkommen', [['name', 'Willkommen'], ['private']])]
    });
    expect(rows[0].name).toBe('Allgemein');
    expect(rows[0].source).toBe('group');
    expect(rows[0].key).toBe(`group:${key({ id: 'root0', relay: R })}`);
    // @ts-expect-error narrowed by source above
    expect(rows[0].pointer.id).toBe('root0');
    // The real channel follows, sorted as usual.
    expect(rows[1].name).toBe('Willkommen');
  });

  it('sorts both sources together by name, not source', () => {
    const rows = buildChannelRows({
      concordChannels: [concord('a-concord'), concord('c-concord')],
      subtreeChannels: [chan('b-gruppe', [['private']])]
    });
    expect(rows.map((r) => r.name)).toEqual(['a-concord', 'b-gruppe', 'c-concord']);
  });

  it('gives every row a distinct key, across sources', () => {
    const rows = buildChannelRows({
      concordChannels: [concord('allgemein')],
      subtreeChannels: [chan('allgemein', [['private']])]
    });
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.key)).size).toBe(2);
    expect(rows.every((r) => r.key.startsWith(`${r.source}:`))).toBe(true);
  });

  it('drops a channel that is not addressable rather than rendering a broken row', () => {
    const rows = buildChannelRows({
      subtreeChannels: [
        /** @type {any} */ ({ id: 'x', relay: 'not a url', level: 'invited', metadata: null }),
        chan('ok')
      ]
    });
    expect(rows.map((r) => r.name)).toEqual(['ok']);
  });

  // The card grid says in words what the rail says with a glyph, so the level
  // has to survive as data — a card cannot re-derive it from the '#' symbol.
  it('carries the access level, not just the glyph', () => {
    const rows = buildChannelRows({
      subtreeChannels: [chan('ankuendigungen', [['restricted']]), chan('leitung', [['private']])]
    });
    const groupRows = /** @type {any[]} */ (rows);
    const level = (/** @type {string} */ name) => groupRows.find((r) => r.name === name)?.level;
    expect(level('ankuendigungen')).toBe('world');
    expect(level('leitung')).toBe('invited');
    // 'world' and 'invited' share the '#' glyph symbol — only `level` tells apart.
    expect(rows.find((r) => r.name === 'ankuendigungen')?.symbol).toBe(
      rows.find((r) => r.name === 'leitung')?.symbol
    );
  });

  it('carries the group topic so a card can show it', () => {
    const rows = buildChannelRows({
      subtreeChannels: [chan('allgemein', [['private'], ['about', 'Alles Weitere']])]
    });
    expect(/** @type {any} */ (rows[0]).about).toBe('Alles Weitere');
  });

  it('leaves the topic absent when the group states none or only blanks', () => {
    const rows = buildChannelRows({
      subtreeChannels: [
        chan('a', [['private'], ['about', 'Alles Weitere']]),
        chan('b', [['private']]),
        chan('c', [['private'], ['about', '   ']])
      ]
    });
    const groupRows = /** @type {any[]} */ (rows);
    const about = (/** @type {string} */ name) => groupRows.find((r) => r.name === name)?.about;
    expect(about('a')).toBe('Alles Weitere');
    expect(about('b')).toBeUndefined();
    expect(about('c')).toBeUndefined();
  });

  it('does not write a cache symbol onto any metadata event', () => {
    const c = chan('allgemein', [['private']]);
    buildChannelRows({ subtreeChannels: [c] });
    expect(Object.getOwnPropertySymbols(c.metadata)).toEqual([]);
  });
});

describe('channel pictures', () => {
  const withPicture = (/** @type {string[][]} */ tags) =>
    /** @type {import('$lib/groups/subtree-channels.js').SubtreeChannel} */ ({
      id: 'general',
      relay: 'wss://r.example/',
      name: undefined,
      level: 'invited',
      metadata: { kind: 39000, tags: [['d', 'general'], ...tags] }
    });

  it('carries the picture a kind:39000 publishes', () => {
    const [row] = buildChannelRows({
      subtreeChannels: [withPicture([['picture', 'https://example.test/a.png']])]
    });
    expect(/** @type {any} */ (row).picture).toBe('https://example.test/a.png');
  });

  it('omits the key when there is no picture', () => {
    const [row] = buildChannelRows({ subtreeChannels: [withPicture([])] });
    expect('picture' in /** @type {any} */ (row)).toBe(false);
  });

  it('drops a picture that is not an http(s) URL', () => {
    const [row] = buildChannelRows({
      subtreeChannels: [withPicture([['picture', 'javascript:alert(1)']])]
    });
    expect('picture' in /** @type {any} */ (row)).toBe(false);
  });
});

// The level is computed upstream (buildSubtreeChannels), so an auth-required
// host still caps a not-private channel down to 'members' there; buildChannelRows
// just renders whatever level it is handed.
describe('buildChannelRows renders a host-capped members channel', () => {
  it('never shows the globe for a members-level channel', () => {
    const rows = buildChannelRows({
      subtreeChannels: [chan('offen', [], { hostRequiresAuth: true })]
    });
    expect(rows[0]).toMatchObject({ worldReadable: false, level: 'members', locked: false });
  });

  it('shows the globe for a plain open channel', () => {
    const rows = buildChannelRows({ subtreeChannels: [chan('offen')] });
    expect(rows[0].worldReadable).toBe(true);
  });
});
