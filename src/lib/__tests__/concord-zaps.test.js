/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { bolt11Info, verifyZapRumor, verifyOnchainZapRumor, tallyZaps } from '$lib/concord/zaps.js';

const PAYER = 'a'.repeat(64);
const PAYER2 = 'b'.repeat(64);

// Public BOLT-11 spec example invoice (also light-bolt11-decoder's own
// fixture): 1_000_000 msat, payment_hash below. No known preimage — used to
// pin the DECODER wiring and the negative verify path against real bytes.
const REAL_INVOICE =
  'lnbc10u1p3pj257pp5yztkwjcz5ftl5laxkav23zmzekaw37zk6kmv80pk4xaev5qhtz7qdpdwd3xger9wd5kwm36yprx7u3qd36kucmgyp282etnv3shjcqzpgxqyz5vqsp5usyc4lk9chsfp53kvcnvq456ganh60d89reykdngsmtj6yw3nhvq9qyyssqjcewm5cjwz4a6rfjx77c490yced6pemk0upkxhy89cmm7sct66k8gneanwykzgdrwrfje69h9u5u0w57rrcsysas7gadwmzxc8c6t0spjazup6';
const REAL_HASH = '2097674b02a257fa7fa6b758a88b62cdbae8f856d5b6c3bc36a9bb96501758bc';

/** sha256 hex via WebCrypto (node's global crypto). @param {string} hex */
async function sha256Hex(hex) {
  const bytes = new Uint8Array(hex.match(/../g)?.map((b) => parseInt(b, 16)) ?? []);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** @param {any} overrides */
function zapRumor(overrides = {}) {
  return {
    id: 'zap-1',
    kind: 9735,
    pubkey: PAYER,
    content: 'great post',
    created_at: 1000,
    tags: [
      ['e', 'msg-1'],
      ['amount', '1000000'],
      ['bolt11', REAL_INVOICE],
      ['preimage', 'c'.repeat(64)]
    ],
    ...overrides
  };
}

describe('bolt11Info', () => {
  it('extracts amount (msat) and payment hash from a real invoice', () => {
    expect(bolt11Info(REAL_INVOICE)).toEqual({
      amountMsats: 1000000,
      paymentHash: REAL_HASH
    });
  });

  it('returns nulls for garbage', () => {
    expect(bolt11Info('lnbc-not-an-invoice')).toEqual({ amountMsats: null, paymentHash: null });
  });
});

describe('verifyZapRumor', () => {
  it('accepts a receipt whose preimage hashes to the invoice payment hash (injected decoder)', async () => {
    const preimage = 'd'.repeat(64);
    const paymentHash = await sha256Hex(preimage);
    const rumor = zapRumor({
      tags: [
        ['e', 'msg-1'],
        ['amount', '21000'],
        ['bolt11', 'lnbc-fake'],
        ['preimage', preimage]
      ]
    });
    const verdict = await verifyZapRumor(rumor, {
      bolt11Info: () => ({ amountMsats: 21000, paymentHash })
    });
    expect(verdict).toBe(paymentHash);
  });

  it('rejects: wrong preimage (real invoice), amount mismatch, missing fields, wrong kind', async () => {
    // Real decoder path: the preimage cannot hash to the spec invoice's hash.
    expect(await verifyZapRumor(zapRumor())).toBeNull();

    const preimage = 'd'.repeat(64);
    const paymentHash = await sha256Hex(preimage);
    const inject = { bolt11Info: () => ({ amountMsats: 21000, paymentHash }) };

    const amountMismatch = zapRumor({
      tags: [
        ['e', 'msg-1'],
        ['amount', '999'],
        ['bolt11', 'x'],
        ['preimage', preimage]
      ]
    });
    expect(await verifyZapRumor(amountMismatch, inject)).toBeNull();

    expect(await verifyZapRumor(zapRumor({ kind: 9 }), inject)).toBeNull();
    expect(
      await verifyZapRumor(
        zapRumor({
          tags: [
            ['e', 'msg-1'],
            ['amount', '21000']
          ]
        }),
        inject
      )
    ).toBeNull();
  });
});

describe('verifyOnchainZapRumor', () => {
  it('accepts kind-8333 with a bitcoin:tx: i-tag and positive amount, returning the txid', () => {
    const txid = 'f'.repeat(64);
    expect(
      verifyOnchainZapRumor({
        kind: 8333,
        tags: [
          ['e', 'msg-1'],
          ['i', `bitcoin:tx:${txid}`],
          ['amount', '500']
        ]
      })
    ).toBe(txid);
  });

  it('rejects wrong kind, malformed txid, and non-positive amounts', () => {
    expect(
      verifyOnchainZapRumor({ kind: 9735, tags: [['i', `bitcoin:tx:${'f'.repeat(64)}`]] })
    ).toBeNull();
    expect(
      verifyOnchainZapRumor({
        kind: 8333,
        tags: [
          ['i', 'bitcoin:tx:nothex'],
          ['amount', '500']
        ]
      })
    ).toBeNull();
    expect(
      verifyOnchainZapRumor({
        kind: 8333,
        tags: [
          ['i', `bitcoin:tx:${'f'.repeat(64)}`],
          ['amount', '0']
        ]
      })
    ).toBeNull();
  });
});

describe('tallyZaps', () => {
  it('sums verified zaps per target, deduping by payment proof (one payment counts once)', () => {
    const zaps = [
      { target: 'msg-1', proof: 'hash-1', pubkey: PAYER, msats: 21000, ms: 1000 },
      { target: 'msg-1', proof: 'hash-1', pubkey: PAYER, msats: 21000, ms: 2000 }, // relay echo dupe
      { target: 'msg-1', proof: 'hash-2', pubkey: PAYER2, msats: 1000, ms: 1500 },
      { target: 'msg-2', proof: 'hash-3', pubkey: PAYER, msats: 5000, ms: 1600 }
    ];
    const tally = tallyZaps(zaps);
    expect(tally.get('msg-1')).toEqual({ totalMsats: 22000, count: 2 });
    expect(tally.get('msg-2')).toEqual({ totalMsats: 5000, count: 1 });
  });
});
