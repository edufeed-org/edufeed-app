/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { nip19, nip44, generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools';
import {
  parseConnectionString,
  parseTipEvent,
  unsealDocument,
  sealDocumentForTest,
  planReconcile
} from '$lib/cordn/multidevice-sync.js';

const ownerSecret = generateSecretKey();
const ownerPubkey = getPublicKey(ownerSecret);
const ephemeralSecret = generateSecretKey();
const ephemeralPubkey = getPublicKey(ephemeralSecret);
const dekSecret = generateSecretKey();
const dekHex = Array.from(dekSecret, (b) => b.toString(16).padStart(2, '0')).join('');
const D_TAG = 'ab'.repeat(16);

/**
 * Owner nip44 self-seal decrypt, as an applesauce-style signer would expose it.
 * @param {string} pubkey
 * @param {string} ciphertext
 */
const ownerNip44Decrypt = async (pubkey, ciphertext) =>
  nip44.v2.decrypt(ciphertext, nip44.v2.utils.getConversationKey(ownerSecret, pubkey));

function buildConnectionString() {
  const naddr = nip19.naddrEncode({
    kind: 30078,
    pubkey: ephemeralPubkey,
    identifier: D_TAG,
    relays: ['wss://relay.nostr.net']
  });
  const ephemeralPrivateKey = Array.from(ephemeralSecret, (b) =>
    b.toString(16).padStart(2, '0')
  ).join('');
  return btoa(JSON.stringify({ naddr, ephemeralPrivateKey }));
}

/** @param {{groupSha: string, metaSha: string}} params */
function buildTipOuter({ groupSha, metaSha }) {
  const inner = finalizeEvent(
    {
      kind: 178,
      created_at: 1785000000,
      content: '',
      tags: [
        ['x', groupSha, 'group', 'gid-1'],
        ['x', metaSha, 'meta'],
        ['dek', dekHex],
        ['server', 'https://blossom.primal.net'],
        ['server', 'https://cdn.hzrd149.com']
      ]
    },
    ownerSecret
  );
  const conversationKey = nip44.v2.utils.getConversationKey(ownerSecret, ownerPubkey);
  const content = nip44.v2.encrypt(JSON.stringify(inner), conversationKey);
  return finalizeEvent(
    { kind: 30078, created_at: 1785000001, content, tags: [['d', D_TAG]] },
    ephemeralSecret
  );
}

describe('parseConnectionString (cordn-web format)', () => {
  it('parses base64 JSON with naddr + ephemeral key', () => {
    const parsed = parseConnectionString(buildConnectionString());
    expect(parsed).toEqual({
      ephemeralPubkey,
      dTag: D_TAG,
      relays: ['wss://relay.nostr.net'],
      ephemeralPrivateKey: expect.stringMatching(/^[0-9a-f]{64}$/)
    });
  });

  it('rejects wrong kinds and malformed strings', () => {
    const badNaddr = nip19.naddrEncode({ kind: 30023, pubkey: ephemeralPubkey, identifier: 'x' });
    expect(() =>
      parseConnectionString(btoa(JSON.stringify({ naddr: badNaddr, ephemeralPrivateKey: 'ff' })))
    ).toThrow(/kind/i);
    expect(() => parseConnectionString('notbase64!!!')).toThrow();
  });
});

describe('parseTipEvent', () => {
  it('decrypts, verifies the inner owner event, and extracts docs/dek/servers', async () => {
    const outer = buildTipOuter({ groupSha: '1'.repeat(64), metaSha: '2'.repeat(64) });
    const tip = await parseTipEvent(outer, { ownerPubkey, nip44Decrypt: ownerNip44Decrypt });
    expect(tip.dek).toBe(dekHex);
    expect(tip.servers).toEqual(['https://blossom.primal.net', 'https://cdn.hzrd149.com']);
    expect(tip.groupDocs).toEqual([{ address: '1'.repeat(64), gid: 'gid-1' }]);
    expect(tip.metaDoc).toBe('2'.repeat(64));
  });

  it('rejects an inner event signed by the wrong identity', async () => {
    const mallory = generateSecretKey();
    const inner = finalizeEvent(
      { kind: 178, created_at: 1785000000, content: '', tags: [['dek', dekHex]] },
      mallory
    );
    const conversationKey = nip44.v2.utils.getConversationKey(ownerSecret, ownerPubkey);
    const outer = finalizeEvent(
      {
        kind: 30078,
        created_at: 1785000001,
        content: nip44.v2.encrypt(JSON.stringify(inner), conversationKey),
        tags: [['d', D_TAG]]
      },
      ephemeralSecret
    );
    await expect(
      parseTipEvent(outer, { ownerPubkey, nip44Decrypt: ownerNip44Decrypt })
    ).rejects.toThrow(/owner/i);
  });
});

describe('document seal/unseal (DEK self-seal)', () => {
  it('round-trips a group document and validates schema', async () => {
    const doc = {
      schemaVersion: 1,
      type: 'group',
      gid: 'gid-1',
      coordinator: 'c'.repeat(64),
      issuedAt: 1785000000000,
      clientState: 'AAECAw==',
      cursor: 42
    };
    const { sealedText, address } = await sealDocumentForTest(doc, dekHex);
    const opened = await unsealDocument({ sealedText, dekHex, expectedAddress: address });
    expect(opened).toEqual(doc);
  });

  it('rejects address mismatches and unknown schema versions', async () => {
    const { sealedText } = await sealDocumentForTest(
      { schemaVersion: 1, type: 'meta', issuedAt: 1, removed: [] },
      dekHex
    );
    await expect(
      unsealDocument({ sealedText, dekHex, expectedAddress: 'f'.repeat(64) })
    ).rejects.toThrow(/address/i);
    const { sealedText: badVersion, address } = await sealDocumentForTest(
      { schemaVersion: 2, type: 'meta', issuedAt: 1 },
      dekHex
    );
    await expect(
      unsealDocument({ sealedText: badVersion, dekHex, expectedAddress: address })
    ).rejects.toThrow(/schema/i);
  });
});

describe('planReconcile (spec §8: forward-only LWW by epoch)', () => {
  const local = [
    { gid: 'a', epoch: 5n },
    { gid: 'b', epoch: 7n }
  ];

  it('seeds unknown groups, fast-forwards ahead docs, skips behind/equal docs', () => {
    const plan = planReconcile({
      localGroups: local,
      docs: [
        { gid: 'a', epoch: 6n, address: 'x1' },
        { gid: 'b', epoch: 7n, address: 'x2' },
        { gid: 'c', epoch: 1n, address: 'x3' }
      ],
      tombstones: []
    });
    expect(plan).toEqual([
      { action: 'fastForward', gid: 'a', address: 'x1' },
      { action: 'skip', gid: 'b' },
      { action: 'seed', gid: 'c', address: 'x3' }
    ]);
  });

  it('drops local groups only when the tombstone epoch is >= local epoch', () => {
    const plan = planReconcile({
      localGroups: local,
      docs: [],
      tombstones: [
        { gid: 'a', epoch: 5 },
        { gid: 'b', epoch: 3 }
      ]
    });
    expect(plan).toEqual([{ action: 'drop', gid: 'a' }]);
  });

  it('tombstoned docs in the same tip are not seeded', () => {
    const plan = planReconcile({
      localGroups: [],
      docs: [{ gid: 'z', epoch: 4n, address: 'x9' }],
      tombstones: [{ gid: 'z', epoch: 9 }]
    });
    expect(plan).toEqual([]);
  });
});

describe('buildChainRanges (spec §8.5)', async () => {
  const { buildChainRanges } = await import('$lib/cordn/multidevice-sync.js');
  it('pairs each chain point with its half-open decrypt range', () => {
    expect(buildChainRanges([{ cursor: 10 }, { cursor: 25 }, { cursor: 40 }], 60)).toEqual([
      { index: 0, lo: 10, hi: 25 },
      { index: 1, lo: 25, hi: 40 },
      { index: 2, lo: 40, hi: 60 }
    ]);
  });
  it('drops empty ranges (chain point at the seed cursor)', () => {
    expect(buildChainRanges([{ cursor: 60 }], 60)).toEqual([]);
    expect(buildChainRanges([], 60)).toEqual([]);
  });
});
