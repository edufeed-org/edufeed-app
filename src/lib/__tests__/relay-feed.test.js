/**
 * relay-feed helper tests — relay picker + relay feed logic.
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { addSeenRelay } from 'applesauce-core/helpers';
import {
  relayHostLabel,
  buildRelayOptions,
  filterEventsForRelay,
  resolveFeedRelaySources
} from '../helpers/relay-feed.js';

/** @param {Partial<any>} overrides */
function makeEvent(overrides = {}) {
  return {
    id: Math.random().toString(36).slice(2),
    kind: 1,
    pubkey: 'a'.repeat(64),
    created_at: 1000,
    content: '',
    tags: [],
    sig: '',
    ...overrides
  };
}

// normalizeRelayInput moved to helpers/relay-input.js — see relay-input.test.js

describe('relayHostLabel', () => {
  it('strips scheme and trailing slash', () => {
    expect(relayHostLabel('wss://relay.example.org/')).toBe('relay.example.org');
  });

  it('keeps port and non-root path', () => {
    expect(relayHostLabel('ws://localhost:7777/')).toBe('localhost:7777');
    expect(relayHostLabel('wss://relay.example.org/inbox')).toBe('relay.example.org/inbox');
  });

  it('falls back gracefully on unparseable input', () => {
    expect(relayHostLabel('wss://')).toBe('');
  });
});

describe('buildRelayOptions', () => {
  it('unions all three sources, normalized and deduped', () => {
    const options = buildRelayOptions(
      ['wss://a.example', 'wss://b.example/'],
      ['wss://b.example'], // dupe of NIP-65 entry, without trailing slash
      ['wss://c.example/']
    );
    expect(options.map((o) => o.url)).toEqual([
      'wss://a.example/',
      'wss://b.example/',
      'wss://c.example/'
    ]);
  });

  it('labels options with the host', () => {
    const options = buildRelayOptions(['wss://a.example/'], [], []);
    expect(options[0].label).toBe('a.example');
  });

  it('marks only custom relays as isCustom', () => {
    const options = buildRelayOptions(['wss://a.example/'], [], ['wss://c.example/']);
    expect(options.find((o) => o.url === 'wss://a.example/')?.isCustom).toBe(false);
    expect(options.find((o) => o.url === 'wss://c.example/')?.isCustom).toBe(true);
  });

  it('marks a custom relay duplicating a NIP-65 relay as custom (so it stays removable)', () => {
    const options = buildRelayOptions(['wss://a.example/'], [], ['wss://a.example']);
    expect(options).toHaveLength(1);
    expect(options[0].isCustom).toBe(true);
  });

  it('skips invalid relay URLs instead of throwing', () => {
    const options = buildRelayOptions(['not-a-url', 'wss://a.example/'], [], []);
    expect(options.map((o) => o.url)).toEqual(['wss://a.example/']);
  });

  it('returns [] for empty sources', () => {
    expect(buildRelayOptions([], [], [])).toEqual([]);
  });

  it('drops non-websocket schemes (e.g. a malformed https r-tag in a kind 10002)', () => {
    expect(buildRelayOptions(['https://not-a-relay.example/'], [], [])).toEqual([]);
  });
});

describe('filterEventsForRelay', () => {
  const RELAY = 'wss://feed.example/';

  it('keeps events seen on the relay, drops others', () => {
    const seen = makeEvent();
    addSeenRelay(seen, RELAY);
    const other = makeEvent();
    addSeenRelay(other, 'wss://elsewhere.example/');
    const never = makeEvent(); // no provenance at all

    const result = filterEventsForRelay([seen, other, never], RELAY);
    expect(result).toEqual([seen]);
  });

  it('matches provenance through URL normalization', () => {
    const event = makeEvent();
    addSeenRelay(event, 'wss://feed.example/'); // stored normalized
    // query with non-normalized variant
    expect(filterEventsForRelay([event], 'wss://Feed.Example')).toEqual([event]);
  });

  it('excludes kind-1 replies (NIP-10 root or reply e-tags)', () => {
    const root = makeEvent();
    addSeenRelay(root, RELAY);
    const reply = makeEvent({ tags: [['e', 'b'.repeat(64), '', 'root']] });
    addSeenRelay(reply, RELAY);

    const result = filterEventsForRelay([root, reply], RELAY);
    expect(result).toEqual([root]);
  });

  it('keeps non-kind-1 events regardless of e-tags', () => {
    const calendar = makeEvent({
      kind: 31923,
      tags: [
        ['d', 'evt'],
        ['e', 'b'.repeat(64)]
      ]
    });
    addSeenRelay(calendar, RELAY);
    expect(filterEventsForRelay([calendar], RELAY)).toEqual([calendar]);
  });

  it('returns [] for an invalid relay URL', () => {
    const event = makeEvent();
    addSeenRelay(event, RELAY);
    expect(filterEventsForRelay([event], 'garbage')).toEqual([]);
  });
});

describe('resolveFeedRelaySources', () => {
  it('defaults to config+custom when feed config is undefined', () => {
    expect(resolveFeedRelaySources(undefined)).toEqual(new Set(['config', 'custom']));
  });

  it('defaults to config+custom when relaySources is empty', () => {
    expect(resolveFeedRelaySources({ relaySources: [] })).toEqual(new Set(['config', 'custom']));
  });

  it('parses explicit tokens', () => {
    expect(
      resolveFeedRelaySources({ relaySources: ['config', 'custom', 'nip65', 'community'] })
    ).toEqual(new Set(['config', 'custom', 'nip65', 'community']));
  });

  it('supports a restricted single-source list', () => {
    expect(resolveFeedRelaySources({ relaySources: ['config'] })).toEqual(new Set(['config']));
  });

  it('drops unknown tokens', () => {
    expect(resolveFeedRelaySources({ relaySources: ['config', 'relaysets', 'bogus'] })).toEqual(
      new Set(['config'])
    );
  });

  it('falls back to the default when only unknown tokens are given', () => {
    expect(resolveFeedRelaySources({ relaySources: ['bogus'] })).toEqual(
      new Set(['config', 'custom'])
    );
  });
});
