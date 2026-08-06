import { describe, it, expect } from 'vitest';
import {
  relayChannelIds,
  relayMetadataAuthors,
  groupsByRelay,
  relayLabel,
  relayHref
} from '$lib/groups/relay-directory.js';

const RELAY_KEY = '12f6870117eff1a6318bd38c82a65d51dd19879b7489f57247114d0ee8a96de3';
const OTHER_KEY = 'a'.repeat(64);

/** @param {string} d @param {string} [pubkey] */
const meta = (d, pubkey = RELAY_KEY) => ({ kind: 39000, pubkey, tags: [['d', d]] });
/** @param {string} h */
const putUser = (h) => ({
  kind: 9000,
  tags: [
    ['h', h],
    ['p', 'f'.repeat(64)]
  ]
});

describe('relayMetadataAuthors', () => {
  it('pins to the key the relay advertises as `self`', () => {
    expect(relayMetadataAuthors({ self: RELAY_KEY })).toEqual([RELAY_KEY]);
  });

  it('accepts `pubkey` as the other spelling of the same thing', () => {
    expect(relayMetadataAuthors({ pubkey: RELAY_KEY })).toEqual([RELAY_KEY]);
  });

  it('pins nothing when the relay names no key — an unfiltered list beats an empty one', () => {
    expect(relayMetadataAuthors({})).toEqual([]);
    expect(relayMetadataAuthors(null)).toEqual([]);
  });

  it('rejects a value that is not a 64-hex key rather than filtering on garbage', () => {
    expect(relayMetadataAuthors({ self: 'not-a-key' })).toEqual([]);
    expect(relayMetadataAuthors({ self: RELAY_KEY.slice(0, 60) })).toEqual([]);
  });
});

describe('relayChannelIds', () => {
  it('takes the ids out of the open listing', () => {
    const { ids } = relayChannelIds({ listed: [meta('general'), meta('random')] });
    expect(ids).toEqual(['general', 'random']);
  });

  it('adds a remembered id the listing does not carry — a private channel may be hidden', () => {
    const { ids, bySource } = relayChannelIds({
      listed: [meta('general')],
      remembered: ['leadership']
    });
    expect(ids).toEqual(['general', 'leadership']);
    expect(bySource.remembered).toEqual(['leadership']);
  });

  it('adds a membership-only id — a client may join without touching the 10009', () => {
    const { ids, bySource } = relayChannelIds({
      listed: [meta('general')],
      memberships: [putUser('flotilla-only')]
    });
    expect(ids).toEqual(['general', 'flotilla-only']);
    expect(bySource.memberships).toEqual(['flotilla-only']);
  });

  it('reads the group id of a moderation event from `h`, never from `d`', () => {
    const { ids } = relayChannelIds({
      memberships: [
        {
          kind: 9000,
          tags: [
            ['d', 'wrong'],
            ['h', 'right']
          ]
        }
      ]
    });
    expect(ids).toEqual(['right']);
  });

  it('records each id under the source that found it FIRST', () => {
    const { ids, bySource } = relayChannelIds({
      listed: [meta('general')],
      remembered: ['general'],
      memberships: [putUser('general')]
    });
    expect(ids).toEqual(['general']);
    expect(bySource).toEqual({ listed: ['general'], remembered: [], memberships: [] });
  });

  it('drops metadata signed by anyone other than the relay when a key is pinned', () => {
    const { ids } = relayChannelIds({
      listed: [meta('real'), meta('forged', OTHER_KEY)],
      authors: [RELAY_KEY]
    });
    expect(ids).toEqual(['real']);
  });

  it('keeps every listed id when no key is pinned', () => {
    const { ids } = relayChannelIds({
      listed: [meta('real'), meta('unknown-author', OTHER_KEY)],
      authors: []
    });
    expect(ids).toEqual(['real', 'unknown-author']);
  });

  it('ignores an event with no id tag instead of listing an empty channel', () => {
    const { ids } = relayChannelIds({
      listed: [{ kind: 39000, pubkey: RELAY_KEY, tags: [['name', 'no id']] }],
      remembered: ['', null],
      memberships: [{ kind: 9000, tags: [] }]
    });
    expect(ids).toEqual([]);
  });

  it('returns empty for empty input rather than throwing', () => {
    expect(relayChannelIds().ids).toEqual([]);
    expect(relayChannelIds({}).ids).toEqual([]);
  });
});

describe('groupsByRelay', () => {
  const row = (/** @type {string} */ key, /** @type {string} */ relay) => ({
    key,
    pointer: { id: key, relay }
  });

  it('makes one entry per host, keeping the rows under it', () => {
    const grouped = groupsByRelay([
      row('a', 'wss://one.example/'),
      row('b', 'wss://two.example/'),
      row('c', 'wss://one.example/')
    ]);
    expect(grouped.map((g) => g.relay)).toEqual(['wss://one.example/', 'wss://two.example/']);
    expect(grouped[0].rows.map((r) => r.key)).toEqual(['a', 'c']);
  });

  it('drops a row with no relay — it cannot be opened, so it cannot be grouped', () => {
    const grouped = groupsByRelay([row('a', 'wss://one.example/'), { key: 'b', pointer: {} }]);
    expect(grouped).toHaveLength(1);
    expect(grouped[0].rows.map((r) => r.key)).toEqual(['a']);
  });

  it('returns empty for no rows', () => {
    expect(groupsByRelay()).toEqual([]);
    expect(groupsByRelay([])).toEqual([]);
  });
});

describe('relayLabel', () => {
  it('is the host', () => {
    expect(relayLabel('wss://edufeed.communities.buzz.xyz/')).toBe('edufeed.communities.buzz.xyz');
  });

  it('keeps the port — a relay on another port is another relay', () => {
    expect(relayLabel('ws://127.0.0.1:17020')).toBe('127.0.0.1:17020');
  });

  it('falls back to the raw string when the URL will not parse', () => {
    expect(relayLabel('not a url')).toBe('not a url');
  });
});

describe('relayHref', () => {
  it('encodes the relay URL once, spelled out', () => {
    expect(relayHref('wss://edufeed.communities.buzz.xyz/')).toBe(
      '/relays/wss%3A%2F%2Fedufeed.communities.buzz.xyz%2F'
    );
  });

  it('keeps scheme and port, which a shortened pointer would drop', () => {
    const href = relayHref('ws://127.0.0.1:17020');
    expect(decodeURIComponent(href.replace('/relays/', ''))).toBe('ws://127.0.0.1:17020');
  });
});
