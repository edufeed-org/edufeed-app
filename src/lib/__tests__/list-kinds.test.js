/**
 * Tests for the LIST_KINDS metadata table — the single source of truth
 * driving dashboard rendering, loader filters, and the edit UI.
 *
 * These tests run before the table exists (TDD). Once `list-kinds.js`
 * is implemented they should all pass without further changes.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import * as kinds from 'nostr-tools/kinds';
import {
  LIST_KINDS,
  STANDARD_LIST_KINDS,
  PARAMETERIZED_LIST_KINDS,
  getListKindSpec
} from '../helpers/list-kinds.js';

// Kinds the user confirmed should be surfaced on the Lists tab.
const EXPECTED_KINDS = [
  kinds.Contacts, // 3
  kinds.Mutelist, // 10000
  kinds.Pinlist, // 10001
  kinds.RelayList, // 10002
  kinds.BookmarkList, // 10003
  kinds.CommunitiesList, // 10004
  kinds.PublicChatsList, // 10005
  kinds.BlockedRelaysList, // 10006
  kinds.SearchRelaysList, // 10007
  kinds.InterestsList, // 10015
  kinds.UserEmojiList, // 10030
  kinds.DirectMessageRelaysList, // 10050
  kinds.Followsets, // 30000
  kinds.Relaysets, // 30002
  kinds.Bookmarksets, // 30003
  kinds.Curationsets, // 30004
  kinds.Interestsets, // 30015
  kinds.Emojisets, // 30030
  39089 // Starter pack (no constant in nostr-tools)
];

const VALID_RENDER_MODES = new Set([
  'people',
  'events',
  'addresses',
  'relays',
  'relays-rw',
  'tags',
  'emoji',
  'mute'
]);

describe('LIST_KINDS — entries', () => {
  it('contains an entry for every expected kind', () => {
    for (const kind of EXPECTED_KINDS) {
      expect(LIST_KINDS[kind], `missing LIST_KINDS[${kind}]`).toBeDefined();
    }
  });

  it('every entry has a unique non-empty string "key"', () => {
    const seenKeys = new Set();
    for (const [kind, spec] of Object.entries(LIST_KINDS)) {
      expect(typeof spec.key, `kind ${kind} key type`).toBe('string');
      expect(spec.key.length, `kind ${kind} key empty`).toBeGreaterThan(0);
      expect(seenKeys.has(spec.key), `duplicate key ${spec.key}`).toBe(false);
      seenKeys.add(spec.key);
    }
  });

  it('every entry has a boolean "singleton" flag', () => {
    for (const [kind, spec] of Object.entries(LIST_KINDS)) {
      expect(typeof spec.singleton, `kind ${kind} singleton`).toBe('boolean');
    }
  });

  it('every entry declares itemTag (string) or itemTags (string[])', () => {
    for (const [kind, spec] of Object.entries(LIST_KINDS)) {
      const hasSingle = typeof spec.itemTag === 'string' && spec.itemTag.length > 0;
      const hasMany =
        Array.isArray(spec.itemTags) &&
        spec.itemTags.length > 0 &&
        spec.itemTags.every((t) => typeof t === 'string' && t.length > 0);
      expect(hasSingle || hasMany, `kind ${kind} needs itemTag or itemTags`).toBe(true);
    }
  });

  it('every entry has a recognised "render" mode', () => {
    for (const [kind, spec] of Object.entries(LIST_KINDS)) {
      expect(VALID_RENDER_MODES.has(spec.render), `kind ${kind} render ${spec.render}`).toBe(true);
    }
  });

  it('every entry has a boolean "hidden" flag (supports encrypted tags)', () => {
    for (const [kind, spec] of Object.entries(LIST_KINDS)) {
      expect(typeof spec.hidden, `kind ${kind} hidden`).toBe('boolean');
    }
  });
});

describe('LIST_KINDS — derived arrays', () => {
  it('STANDARD_LIST_KINDS contains only non-addressable list kinds (< 20000)', () => {
    for (const kind of STANDARD_LIST_KINDS) {
      expect(kind, `STANDARD kind ${kind}`).toBeLessThan(20000);
      expect(LIST_KINDS[kind]).toBeDefined();
      expect(LIST_KINDS[kind].singleton).toBe(true);
    }
  });

  it('PARAMETERIZED_LIST_KINDS contains only addressable set kinds (>= 30000)', () => {
    for (const kind of PARAMETERIZED_LIST_KINDS) {
      expect(kind, `PARAM kind ${kind}`).toBeGreaterThanOrEqual(30000);
      expect(LIST_KINDS[kind]).toBeDefined();
      expect(LIST_KINDS[kind].singleton).toBe(false);
    }
  });

  it('STANDARD and PARAMETERIZED are disjoint', () => {
    const standard = new Set(STANDARD_LIST_KINDS);
    for (const kind of PARAMETERIZED_LIST_KINDS) {
      expect(standard.has(kind), `${kind} should not be in both`).toBe(false);
    }
  });

  it('union of STANDARD + PARAMETERIZED equals LIST_KINDS keys', () => {
    const union = new Set([...STANDARD_LIST_KINDS, ...PARAMETERIZED_LIST_KINDS]);
    const table = new Set(Object.keys(LIST_KINDS).map(Number));
    expect(union.size).toBe(table.size);
    for (const k of table) expect(union.has(k), `${k} missing from union`).toBe(true);
  });
});

describe('LIST_KINDS — domain invariants', () => {
  it('contacts (3) is a people-render singleton without hidden tags', () => {
    const spec = LIST_KINDS[kinds.Contacts];
    expect(spec.singleton).toBe(true);
    expect(spec.render).toBe('people');
    expect(spec.hidden).toBe(false);
  });

  it('mute list (10000) uses the mute render mode and supports hidden tags', () => {
    const spec = LIST_KINDS[kinds.Mutelist];
    expect(spec.render).toBe('mute');
    expect(spec.hidden).toBe(true);
  });

  it('relay list (10002) uses relays-rw (read/write markers)', () => {
    expect(LIST_KINDS[kinds.RelayList].render).toBe('relays-rw');
  });

  it('follow sets (30000) are non-singleton and render as people', () => {
    const spec = LIST_KINDS[kinds.Followsets];
    expect(spec.singleton).toBe(false);
    expect(spec.render).toBe('people');
  });

  it('starter pack (39089) is a people-render set', () => {
    const spec = LIST_KINDS[39089];
    expect(spec.singleton).toBe(false);
    expect(spec.render).toBe('people');
  });
});

describe('getListKindSpec', () => {
  it('returns the spec for a known kind', () => {
    const spec = getListKindSpec(kinds.BookmarkList);
    expect(spec).toBeDefined();
    expect(spec?.key).toBe('bookmarks');
  });

  it('returns undefined for an unknown kind', () => {
    expect(getListKindSpec(99999)).toBeUndefined();
  });
});
