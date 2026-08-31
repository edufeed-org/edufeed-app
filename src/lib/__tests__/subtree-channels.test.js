/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { buildSubtreeChannels, parentOf, dTagOf, nameOf } from '$lib/groups/subtree-channels.js';

const ROOT = 'root123';
const R = 'wss://groups.example/c/root123';

let seq = 0;
/**
 * @param {string} id
 * @param {string[][]} [extra]
 * @param {number} [created_at]
 */
const meta = (id, extra = [], created_at = 1000) => ({
  kind: 39000,
  pubkey: '9'.repeat(64),
  created_at,
  id: `ev-${id}-${created_at}-${seq++}`,
  sig: 'x',
  content: '',
  tags: [['d', id], ...extra]
});

describe('tag helpers', () => {
  it('read d, parent and name tags', () => {
    const e = meta('kanal', [
      ['parent', ROOT],
      ['name', 'Kanal']
    ]);
    expect(dTagOf(e)).toBe('kanal');
    expect(parentOf(e)).toBe(ROOT);
    expect(nameOf(e)).toBe('Kanal');
    expect(parentOf(meta('x'))).toBeUndefined();
  });
});

describe('buildSubtreeChannels', () => {
  it('surfaces the root as its own row and lists the parent==root children', () => {
    const events = [
      meta(ROOT, [['name', 'Community']]),
      meta('allgemein', [
        ['parent', ROOT],
        ['name', 'Allgemein']
      ]),
      meta('leitung', [['parent', ROOT], ['name', 'Leitung'], ['private']])
    ];
    const { root, channels } = buildSubtreeChannels(events, ROOT, R);
    expect(root?.id).toBe(ROOT);
    expect(root?.name).toBe('Community');
    expect(channels.map((c) => c.id)).toEqual(['allgemein', 'leitung']);
    expect(channels.map((c) => c.relay)).toEqual([R, R]);
    // world (no private) vs invited (private) — the relay-observable split.
    expect(channels.find((c) => c.id === 'allgemein')?.level).toBe('world');
    expect(channels.find((c) => c.id === 'leitung')?.level).toBe('invited');
  });

  it('ignores a 39000 whose parent is a DIFFERENT community', () => {
    const events = [
      meta(ROOT, [['name', 'Community']]),
      meta('foreign', [
        ['parent', 'someOtherRoot'],
        ['name', 'Foreign']
      ])
    ];
    const { channels } = buildSubtreeChannels(events, ROOT, R);
    expect(channels).toEqual([]);
  });

  it('ignores a parent-less 39000 that is not this root (it is another root)', () => {
    const events = [meta(ROOT), meta('otherRoot', [['name', 'Other']])];
    const { channels } = buildSubtreeChannels(events, ROOT, R);
    expect(channels).toEqual([]);
  });

  it('keeps the NEWEST 39000 per child id (dedup, newest-wins)', () => {
    const events = [
      meta(ROOT),
      meta(
        'allgemein',
        [
          ['parent', ROOT],
          ['name', 'Alt']
        ],
        1000
      ),
      meta(
        'allgemein',
        [
          ['parent', ROOT],
          ['name', 'Neu']
        ],
        2000
      )
    ];
    const { channels } = buildSubtreeChannels(events, ROOT, R);
    expect(channels).toHaveLength(1);
    expect(channels[0].name).toBe('Neu');
  });

  it('ignores non-39000 events and returns empty for bad input', () => {
    const events = [{ kind: 9, tags: [['h', 'allgemein']] }, meta(ROOT)];
    expect(buildSubtreeChannels(events, ROOT, R).channels).toEqual([]);
    expect(buildSubtreeChannels(events, ROOT, R).root?.id).toBe(ROOT);
    expect(buildSubtreeChannels([], ROOT, R)).toEqual({ root: null, channels: [] });
    expect(buildSubtreeChannels(/** @type {any} */ (null), ROOT, R)).toEqual({
      root: null,
      channels: []
    });
    expect(buildSubtreeChannels([meta(ROOT)], '', R)).toEqual({ root: null, channels: [] });
  });

  it('does not write a cache symbol onto the metadata events', () => {
    const child = meta('allgemein', [['parent', ROOT], ['private']]);
    buildSubtreeChannels([meta(ROOT), child], ROOT, R);
    expect(Object.getOwnPropertySymbols(child)).toEqual([]);
  });
});
