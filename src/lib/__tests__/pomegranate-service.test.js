/** @vitest-environment node */
// @ts-nocheck
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateSecretKey, getPublicKey, nip19 } from 'nostr-tools';
import { bytesToHex } from '@noble/hashes/utils.js';
import { trustedKeyDeal, hexShard } from '@fiatjaf/promenade-trusted-dealer';
import {
  getPomegranateAccount,
  createPomegranateAccount,
  ensureProfile,
  aggregateNsec,
  KIND_ACCOUNT_REGISTRATION,
  KIND_OPERATOR_REGISTRATION
} from '../services/pomegranate.js';

const CENTRAL = 'https://central.test';
const token = { raw: 'raw-token', email: 'a@b.c', createdAt: Date.now() };

/** @type {ReturnType<typeof vi.fn>} */
let fetchMock;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

/** Minimal Response stand-in. */
function res(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: '',
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
    json: async () => body
  };
}

describe('getPomegranateAccount', () => {
  it('returns the account when registered', async () => {
    fetchMock.mockResolvedValueOnce(
      res(200, { email: 'a@b.c', pubkey: 'ab'.repeat(32), operators: [], threshold: 2 })
    );
    const account = await getPomegranateAccount(CENTRAL, token);
    expect(account?.pubkey).toBe('ab'.repeat(32));
    expect(fetchMock).toHaveBeenCalledWith(`${CENTRAL}/account`, {
      headers: { Authorization: `Token ${token.raw}` }
    });
  });

  it('returns null when no account exists', async () => {
    fetchMock.mockResolvedValueOnce(res(404, undefined));
    expect(await getPomegranateAccount(CENTRAL, token)).toBeNull();
  });

  it('throws on 401 (expired session)', async () => {
    fetchMock.mockResolvedValueOnce(res(401, undefined));
    await expect(getPomegranateAccount(CENTRAL, token)).rejects.toThrow(/expired/);
  });
});

describe('createPomegranateAccount', () => {
  const operators = ['https://op1.test', 'https://op2.test', 'https://op3.test'];

  it('registers kind 20445 at central and kind 20444 at each operator', async () => {
    fetchMock.mockResolvedValue(res(200, {}));
    const secretKey = generateSecretKey();
    await createPomegranateAccount(CENTRAL, token, { operators, threshold: 2, secretKey });

    // 1 central + 3 operator calls
    expect(fetchMock).toHaveBeenCalledTimes(4);

    const [centralUrl, centralInit] = fetchMock.mock.calls[0];
    expect(centralUrl).toBe(`${CENTRAL}/register`);
    const regEvent = JSON.parse(centralInit.body);
    expect(regEvent.kind).toBe(KIND_ACCOUNT_REGISTRATION);
    expect(regEvent.pubkey).toBe(getPublicKey(secretKey));
    expect(regEvent.tags.find((t) => t[0] === 'threshold')?.[1]).toBe('2');
    expect(regEvent.tags.filter((t) => t[0] === 'operator')).toHaveLength(3);
    expect(centralInit.headers['Authorization']).toBe(`Token ${token.raw}`);
    expect(centralInit.headers['X-Pomegranate-Session']).toEqual(expect.any(String));
    expect(centralInit.headers['X-Pomegranate-Session'].length).toBeGreaterThan(0);

    const [opUrl, opInit] = fetchMock.mock.calls[1];
    expect(opUrl).toBe('https://op1.test/po/register');
    const opEvent = JSON.parse(opInit.body);
    expect(opEvent.kind).toBe(KIND_OPERATOR_REGISTRATION);
    expect(opEvent.tags).toContainEqual(['central', CENTRAL]);
    expect(opEvent.tags).toContainEqual(['email', 'a@b.c']);
    expect(opEvent.content).toMatch(/^[0-9a-f]+$/);
    expect(opInit.headers['X-Pomegranate-Operator-Token']).toMatch(/^[0-9a-f]{64}$/);
  });

  it('tolerates operator failures down to the threshold', async () => {
    fetchMock.mockImplementation(async (url) => {
      if (url === `${CENTRAL}/register`) return res(200, {});
      if (url.startsWith('https://op3')) return res(500, undefined);
      return res(200, {});
    });
    await expect(
      createPomegranateAccount(CENTRAL, token, {
        operators,
        threshold: 2,
        secretKey: generateSecretKey()
      })
    ).resolves.toBeUndefined();
  });

  it('aborts when registered operators fall below the threshold', async () => {
    fetchMock.mockImplementation(async (url) => {
      if (url === `${CENTRAL}/register`) return res(200, {});
      if (url.startsWith('https://op1')) return res(200, {});
      return res(500, undefined);
    });
    await expect(
      createPomegranateAccount(CENTRAL, token, {
        operators,
        threshold: 2,
        secretKey: generateSecretKey()
      })
    ).rejects.toThrow(/enough operators/);
  });

  it('rejects fewer than 2 operators', async () => {
    await expect(
      createPomegranateAccount(CENTRAL, token, {
        operators: ['https://op1.test'],
        threshold: 1,
        secretKey: generateSecretKey()
      })
    ).rejects.toThrow(/At least 2 operators/);
  });
});

describe('aggregateNsec', () => {
  // Note: trustedKeyDeal normalizes the key to an even-y pubkey (BIP340), so
  // the recovered secret bytes may be the negation of the input — the x-only
  // pubkey is what round-trips. Compare via getPublicKey, not raw key bytes.
  it('round-trips 2-of-3 shards back to the account key', () => {
    const sk = generateSecretKey();
    const pubkey = getPublicKey(sk);
    const { shards } = trustedKeyDeal(BigInt('0x' + bytesToHex(sk)), 2, 3);
    const hexShards = shards.slice(0, 2).map(hexShard);

    const nsec = aggregateNsec(hexShards, pubkey);

    expect(nsec).toMatch(/^nsec1/);
    const decoded = nip19.decode(nsec);
    expect(decoded.type).toBe('nsec');
    expect(getPublicKey(/** @type {Uint8Array} */ (decoded.data))).toBe(pubkey);
  });

  it('aggregates any >=threshold subset (shards 2+3)', () => {
    const sk = generateSecretKey();
    const pubkey = getPublicKey(sk);
    const { shards } = trustedKeyDeal(BigInt('0x' + bytesToHex(sk)), 2, 3);
    const hexShards = shards.slice(1, 3).map(hexShard);
    expect(aggregateNsec(hexShards, pubkey)).toMatch(/^nsec1/);
  });

  it('rejects when the shards resolve to a different pubkey', () => {
    const sk = generateSecretKey();
    const { shards } = trustedKeyDeal(BigInt('0x' + bytesToHex(sk)), 2, 3);
    const hexShards = shards.slice(0, 2).map(hexShard);
    const otherPubkey = getPublicKey(generateSecretKey());
    expect(() => aggregateNsec(hexShards, otherPubkey)).toThrow(/does not match/);
  });
});

describe('ensureProfile', () => {
  it('returns the first existing profile', async () => {
    fetchMock.mockResolvedValueOnce(
      res(200, [{ handler_pubkey: 'cd'.repeat(32), name: 'default', email: 'a@b.c' }])
    );
    const profile = await ensureProfile(CENTRAL, token);
    expect(profile.handler_pubkey).toBe('cd'.repeat(32));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('creates a profile when none exists', async () => {
    fetchMock
      .mockResolvedValueOnce(res(200, []))
      .mockResolvedValueOnce(
        res(200, { handler_pubkey: 'cd'.repeat(32), name: 'default', email: 'a@b.c' })
      );
    const profile = await ensureProfile(CENTRAL, token);
    expect(profile.handler_pubkey).toBe('cd'.repeat(32));
    const [, createInit] = fetchMock.mock.calls[1];
    expect(createInit.method).toBe('POST');
  });
});
