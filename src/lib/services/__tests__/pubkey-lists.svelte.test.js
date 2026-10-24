// @ts-nocheck

/**
 * Deployment pubkey lists (BLOCKED_PUBKEYS, CALENDAR_HIDDEN_PUBKEYS): entries
 * are npub / hex pubkeys or NIP-51 kind 30000 list naddrs, resolved from the
 * relays with a localStorage copy that is served first and refreshed.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { of, throwError } from 'rxjs';
import { nip19 } from 'nostr-tools';

const requestSpy = vi.fn();
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  pool: { request: (...a) => requestSpy(...a) }
}));
vi.mock('$lib/helpers/relay-helper.js', () => ({
  getAllLookupRelays: () => ['wss://lookup.example/']
}));

const { parseListEntries, createPubkeyList } = await import('../pubkey-lists.svelte.js');

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const OWNER = 'c'.repeat(64);
const npubA = nip19.npubEncode(A);
const listNaddr = nip19.naddrEncode({
  kind: 30000,
  pubkey: OWNER,
  identifier: 'blocked',
  relays: ['wss://hint.example/']
});
const listEvent = {
  id: 'e'.repeat(64),
  kind: 30000,
  pubkey: OWNER,
  created_at: 1,
  content: '',
  tags: [
    ['d', 'blocked'],
    ['p', B],
    ['p', B],
    ['e', 'not a pubkey']
  ]
};

describe('parseListEntries', () => {
  it('sorts npub, hex and kind 30000 naddr entries, skipping the rest', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const parsed = parseListEntries([npubA, ` ${B} `, listNaddr, 'nevent1garbage', 'nope', '']);
    expect(parsed.direct).toEqual([A, B]);
    expect(parsed.sets).toEqual([
      { pubkey: OWNER, identifier: 'blocked', relays: ['wss://hint.example/'] }
    ]);
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });
});

describe('createPubkeyList', () => {
  beforeEach(() => {
    localStorage.clear();
    requestSpy.mockReset();
  });

  it('knows direct pubkeys at once and adds list members when the relays answer', async () => {
    requestSpy.mockReturnValue(of(listEvent));
    const list = createPubkeyList('test', [npubA, listNaddr]);
    expect(list.has(A)).toBe(true);
    expect(list.has(B)).toBe(false);
    await list.ready;
    expect(list.has(B)).toBe(true);
    expect(list.pubkeys.sort()).toEqual([A, B]);
    // The list was asked on its hint relay, not the lookup relays
    expect(requestSpy.mock.calls[0][0]).toEqual(['wss://hint.example/']);
    expect(requestSpy.mock.calls[0][1]).toEqual({
      kinds: [30000],
      authors: [OWNER],
      '#d': ['blocked']
    });
  });

  it('serves the remembered members before the relays answer and keeps them when they do not', async () => {
    requestSpy.mockReturnValue(of(listEvent));
    await createPubkeyList('test', [listNaddr]).ready;
    requestSpy.mockReturnValue(throwError(() => new Error('offline')));
    const again = createPubkeyList('test', [listNaddr]);
    expect(again.has(B)).toBe(true);
    await again.ready;
    expect(again.has(B)).toBe(true);
  });

  it('bumps its version when the members change so deriveds re-run', async () => {
    requestSpy.mockReturnValue(of(listEvent));
    const list = createPubkeyList('test', [listNaddr]);
    const before = list.version;
    await list.ready;
    expect(list.version).toBeGreaterThan(before);
  });

  it('is empty and settled without entries', async () => {
    const list = createPubkeyList('test', []);
    await list.ready;
    expect(list.pubkeys).toEqual([]);
    expect(requestSpy).not.toHaveBeenCalled();
  });
});
