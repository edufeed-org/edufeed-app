/** @vitest-environment node */
import { describe, it, expect, vi } from 'vitest';
import { generateSecretKey, getPublicKey, finalizeEvent, nip19 } from 'nostr-tools';

vi.mock('$env/dynamic/private', () => ({ env: {} }));
import { createExternalAccess, getExternalAccess } from '../termi/external-access.js';

const owner = generateSecretKey();
const ownerPk = getPublicKey(owner);
const member = getPublicKey(generateSecretKey());
const other = getPublicKey(generateSecretKey());
const naddr = nip19.naddrEncode({ kind: 30000, pubkey: ownerPk, identifier: 'ext' });

/** @param {Partial<{kind:number,sk:Uint8Array,d:string,ps:string[],at:number}>} o */
const list = ({ kind = 30000, sk = owner, d = 'ext', ps = [member], at = 100 } = {}) =>
  finalizeEvent(
    { kind, created_at: at, content: '', tags: [['d', d], ...ps.map((p) => ['p', p])] },
    sk
  );

describe('external access', () => {
  it('lists plain npub and hex entries, not others', async () => {
    const a = createExternalAccess({ entries: [nip19.npubEncode(member), other] });
    expect(await a.isListed(member)).toBe(true);
    expect(await a.isListed(other)).toBe(true);
    expect(await a.isListed(ownerPk)).toBe(false);
  });

  it('an naddr entry admits its p tags', async () => {
    const a = createExternalAccess({ entries: [naddr], fetchList: async () => list() });
    expect(await a.isListed(member)).toBe(true);
    expect(await a.isListed(other)).toBe(false);
  });

  it('a rejecting fetchList means not listed, plain entries still work', async () => {
    const a = createExternalAccess({
      entries: [naddr, other],
      fetchList: async () => {
        throw new Error('down');
      }
    });
    expect(await a.isListed(member)).toBe(false);
    expect(await a.isListed(other)).toBe(true);
  });

  it('a failing refresh keeps the last members', async () => {
    let t = 0;
    let fail = false;
    const a = createExternalAccess({
      entries: [naddr],
      now: () => t,
      ttlMs: 10,
      fetchList: async () => {
        if (fail) throw new Error('down');
        return list();
      }
    });
    expect(await a.isListed(member)).toBe(true);
    fail = true;
    t = 100;
    expect(await a.isListed(member)).toBe(true);
    await new Promise((r) => setTimeout(r, 5));
    expect(await a.isListed(member)).toBe(true);
  });

  it('ignores wrong author, kind, d tag, bad signature', async () => {
    const forged = {
      ...list(),
      tags: [
        ['d', 'ext'],
        ['p', other]
      ]
    };
    for (const ev of [
      list({ sk: generateSecretKey() }),
      list({ kind: 30001 }),
      list({ d: 'x' }),
      forged
    ]) {
      const a = createExternalAccess({ entries: [naddr], fetchList: async () => ev });
      expect(await a.isListed(member)).toBe(false);
      expect(await a.isListed(other)).toBe(false);
    }
  });

  it('ignores garbage and non-30000 naddr entries', async () => {
    const other30023 = nip19.naddrEncode({ kind: 30023, pubkey: ownerPk, identifier: 'ext' });
    const fetchList = vi.fn(async () => list());
    const a = createExternalAccess({ entries: ['junk', other30023], fetchList });
    expect(await a.isListed(member)).toBe(false);
    expect(fetchList).not.toHaveBeenCalled();
  });

  it('unset env admits nobody', async () => {
    expect(await getExternalAccess().isListed(member)).toBe(false);
  });
});
