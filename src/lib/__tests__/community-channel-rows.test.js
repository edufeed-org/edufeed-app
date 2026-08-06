/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { buildChannelRows } from '$lib/groups/community-channel-rows.js';
import { channelKey } from '$lib/groups/community-pointer.js';

const R = 'wss://groups.example';

// channelKey() is string|null by contract; every pointer in these fixtures is
// addressable, so narrow once here rather than at each computed key.
const key = (/** @type {any} */ p) => /** @type {string} */ (channelKey(p));

const ptr = (/** @type {string} */ id, /** @type {any} */ extra = {}) => ({
  id,
  relay: R,
  ...extra
});

/** kind:39000 as a spec-current relay emits it. */
const meta = (/** @type {string} */ id, /** @type {string[][]} */ extra = []) => ({
  kind: 39000,
  tags: [['d', id], ...extra]
});

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
    expect(rows[0]).toMatchObject({ name: 'allgemein', symbol: '#', source: 'concord' });
  });

  it('carries the concord private flag into the lock', () => {
    const [row] = buildChannelRows({ concordChannels: [concord('leitung', { private: true })] });
    expect(row.symbol).toBe('\u{1F512}');
  });

  // Concord encrypts every channel, so no concord row is ever world-readable —
  // even the one it calls "public" only means "everyone in the area".
  it('never marks a concord channel world-readable', () => {
    const rows = buildChannelRows({
      concordChannels: [concord('allgemein'), concord('leitung', { private: true })]
    });
    expect(rows.every((r) => r.worldReadable === false)).toBe(true);
  });

  it('renders a group channel from its pointer and metadata', () => {
    const p = ptr('allgemein');
    const rows = buildChannelRows({
      groupPointers: [p],
      metadataByKey: { [key(p)]: meta('allgemein', [['private']]) }
    });
    expect(rows[0]).toMatchObject({ name: 'allgemein', symbol: '\u{1F512}', source: 'group' });
  });

  it('shows the globe for a group channel the relay leaves open', () => {
    const p = ptr('ankuendigungen');
    const rows = buildChannelRows({
      groupPointers: [p],
      metadataByKey: { [key(p)]: meta('ankuendigungen', [['restricted']]) }
    });
    expect(rows[0]).toMatchObject({ symbol: '#', worldReadable: true });
  });

  it('honours the community access marker for a private group channel', () => {
    const open = ptr('allgemein', { access: 'members' });
    const shut = ptr('leitung', { access: 'invited' });
    const rows = buildChannelRows({
      groupPointers: [open, shut],
      metadataByKey: {
        [key(open)]: meta('allgemein', [['private']]),
        [key(shut)]: meta('leitung', [['private']])
      }
    });
    expect(rows.find((r) => r.name === 'allgemein')?.symbol).toBe('#');
    expect(rows.find((r) => r.name === 'leitung')?.symbol).toBe('\u{1F512}');
  });

  // A channel whose metadata has not arrived must not be guessed open.
  it('locks a group channel whose metadata has not loaded', () => {
    const rows = buildChannelRows({ groupPointers: [ptr('allgemein', { access: 'members' })] });
    expect(rows[0]).toMatchObject({ symbol: '\u{1F512}', worldReadable: false, pending: true });
  });

  it('names a group channel from the pointer, then metadata, then the id', () => {
    const named = ptr('a', { name: 'Aus dem Zeiger' });
    const fromMeta = ptr('b');
    const bare = ptr('c');
    const rows = buildChannelRows({
      groupPointers: [named, fromMeta, bare],
      metadataByKey: {
        [key(named)]: meta('a', [['name', 'Aus den Metadaten']]),
        [key(fromMeta)]: meta('b', [['name', 'Aus den Metadaten']])
      }
    });
    expect(rows.map((r) => r.name).sort()).toEqual(['Aus dem Zeiger', 'Aus den Metadaten', 'c']);
  });

  it('sorts both sources together by name, not source', () => {
    const b = ptr('b-gruppe');
    const rows = buildChannelRows({
      concordChannels: [concord('a-concord'), concord('c-concord')],
      groupPointers: [b],
      metadataByKey: { [key(b)]: meta('b-gruppe', [['private']]) }
    });
    expect(rows.map((r) => r.name)).toEqual(['a-concord', 'b-gruppe', 'c-concord']);
  });

  it('gives every row a distinct key, across sources', () => {
    const p = ptr('allgemein');
    const rows = buildChannelRows({
      concordChannels: [concord('allgemein')],
      groupPointers: [p],
      metadataByKey: { [key(p)]: meta('allgemein', [['private']]) }
    });
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.key)).size).toBe(2);
    // Distinctness above holds by accident here — a concord channel_id and a
    // group key are unrelated id-spaces that happen not to collide in this
    // fixture. The namespace is what actually guarantees it, so assert THAT.
    expect(rows.every((r) => r.key.startsWith(`${r.source}:`))).toBe(true);
  });

  it('drops a pointer that is not addressable rather than rendering a broken row', () => {
    const rows = buildChannelRows({
      groupPointers: [/** @type {any} */ ({ id: 'x', relay: 'not a url' }), ptr('ok')]
    });
    expect(rows.map((r) => r.name)).toEqual(['ok']);
  });

  // The card grid says in words what the rail says with a glyph, so the level
  // has to survive as data — a card cannot re-derive it from the symbol, which
  // is '#' for two different levels.
  it('carries the access level, not just the glyph', () => {
    const open = ptr('ankuendigungen');
    const members = ptr('allgemein', { access: 'members' });
    const invited = ptr('leitung', { access: 'invited' });
    const rows = buildChannelRows({
      groupPointers: [open, members, invited, ptr('neu')],
      metadataByKey: {
        [key(open)]: meta('ankuendigungen', [['restricted']]),
        [key(members)]: meta('allgemein', [['private']]),
        [key(invited)]: meta('leitung', [['private']])
      }
    });
    // The union narrows on `source`; these fixtures are all group rows.
    const groupRows = /** @type {any[]} */ (rows);
    const level = (/** @type {string} */ name) => groupRows.find((r) => r.name === name)?.level;
    expect(level('ankuendigungen')).toBe('world');
    expect(level('allgemein')).toBe('members');
    expect(level('leitung')).toBe('invited');
    expect(level('neu')).toBe('unknown');
    // 'members' and 'world' share the '#' glyph, so the glyph alone could not
    // have told them apart.
    expect(rows.find((r) => r.name === 'ankuendigungen')?.symbol).toBe(
      rows.find((r) => r.name === 'allgemein')?.symbol
    );
  });

  it('carries the group topic so a card can show it', () => {
    const p = ptr('allgemein');
    const rows = buildChannelRows({
      groupPointers: [p],
      metadataByKey: { [key(p)]: meta('allgemein', [['private'], ['about', 'Alles Weitere']]) }
    });
    expect(/** @type {any} */ (rows[0]).about).toBe('Alles Weitere');
  });

  // Written with a channel that HAS a topic in the same fixture: without it
  // this test passes on an implementation that never reads `about` at all.
  it('leaves the topic absent when the group states none or only blanks', () => {
    const has = ptr('a');
    const none = ptr('b');
    const blank = ptr('c');
    const rows = buildChannelRows({
      groupPointers: [has, none, blank],
      metadataByKey: {
        [key(has)]: meta('a', [['private'], ['about', 'Alles Weitere']]),
        [key(none)]: meta('b', [['private']]),
        [key(blank)]: meta('c', [['private'], ['about', '   ']])
      }
    });
    const groupRows = /** @type {any[]} */ (rows);
    const about = (/** @type {string} */ name) => groupRows.find((r) => r.name === name)?.about;
    expect(about('a')).toBe('Alles Weitere');
    expect(about('b')).toBeUndefined();
    expect(about('c')).toBeUndefined();
  });

  it('does not write a cache symbol onto any metadata event', () => {
    const p = ptr('allgemein');
    const event = meta('allgemein', [['private']]);
    buildChannelRows({ groupPointers: [p], metadataByKey: { [key(p)]: event } });
    expect(Object.getOwnPropertySymbols(event)).toEqual([]);
  });
});
