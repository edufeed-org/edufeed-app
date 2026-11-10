/** @vitest-environment node */
import { describe, it, expect, vi, afterEach } from 'vitest';

const URL_ = 'http://localhost/api/termi/extract';
const PUBKEY = 'a'.repeat(64);

/** @param {{ signer?: string | null, eligible?: boolean | null, env?: Record<string, string> }} [opts] */
async function load({ signer = PUBKEY, eligible = true, env = {} } = {}) {
  vi.resetModules();
  vi.doMock('$env/dynamic/private', () => ({ env }));
  const verify = vi.fn(async () => signer);
  vi.doMock('$lib/server/nip98-verify.js', () => ({ verifyNip98Header: verify }));
  vi.doMock('$lib/server/termi/eligibility.js', () => ({
    getTermiEligibilityChecker: () => ({ isEligible: async () => eligible })
  }));
  const mod = await import('$lib/server/termi/authorize.js');
  return { ...mod, verify };
}

const req = () =>
  new Request(URL_, { method: 'POST', headers: { authorization: 'Nostr x' }, body: '{}' });

afterEach(() => {
  vi.doUnmock('$env/dynamic/private');
  vi.doUnmock('$lib/server/nip98-verify.js');
  vi.doUnmock('$lib/server/termi/eligibility.js');
});

describe('authorizeTermiRequest', () => {
  it('returns { pubkey } for a valid, eligible signer with quota left', async () => {
    const { authorizeTermiRequest, verify } = await load();
    expect(await authorizeTermiRequest(req(), '{}')).toEqual({ pubkey: PUBKEY });
    expect(verify).toHaveBeenCalledWith('Nostr x', URL_, 'POST', '{}');
  });

  it('401 on a bad NIP-98 header', async () => {
    const { authorizeTermiRequest } = await load({ signer: null });
    const res = /** @type {Response} */ (await authorizeTermiRequest(req(), '{}'));
    expect(res.status).toBe(401);
  });

  it('403 not_eligible', async () => {
    const { authorizeTermiRequest } = await load({ eligible: false });
    const res = /** @type {Response} */ (await authorizeTermiRequest(req(), '{}'));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'not_eligible' });
  });

  it('503 eligibility_unknown', async () => {
    const { authorizeTermiRequest } = await load({ eligible: null });
    const res = /** @type {Response} */ (await authorizeTermiRequest(req(), '{}'));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'eligibility_unknown' });
  });

  it('429 quota once the per-user steps are used up', async () => {
    const { authorizeTermiRequest, termiQuota } = await load();
    for (let i = 0; i < 40; i++) termiQuota.charge(PUBKEY);
    const res = /** @type {Response} */ (await authorizeTermiRequest(req(), '{}'));
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: 'quota', scope: 'user' });
  });

  it('TERMI_QUOTA_DAILY/TERMI_QUOTA_MONTHLY override the 40/2800 defaults', async () => {
    const { termiQuota } = await load({ env: { TERMI_QUOTA_DAILY: '2' } });
    termiQuota.charge(PUBKEY);
    expect(termiQuota.check(PUBKEY)).toBe('ok');
    termiQuota.charge(PUBKEY);
    expect(termiQuota.check(PUBKEY)).toBe('user');
  });

  it('ignores a non-positive TERMI_QUOTA_DAILY and falls back to the default', async () => {
    const { termiQuota } = await load({ env: { TERMI_QUOTA_DAILY: '0' } });
    for (let i = 0; i < 39; i++) termiQuota.charge(PUBKEY);
    expect(termiQuota.check(PUBKEY)).toBe('ok');
    termiQuota.charge(PUBKEY);
    expect(termiQuota.check(PUBKEY)).toBe('user');
  });
});

describe('acquireChatLock', () => {
  it('returns a release function, then null for a second concurrent acquire by the same pubkey', async () => {
    const { acquireChatLock } = await load();
    const release = acquireChatLock(PUBKEY);
    expect(typeof release).toBe('function');
    expect(acquireChatLock(PUBKEY)).toBeNull();
    // A different pubkey is never blocked by another one's lock.
    expect(typeof acquireChatLock('b'.repeat(64))).toBe('function');
  });

  it('frees the pubkey for a new acquire once released', async () => {
    const { acquireChatLock } = await load();
    const release = acquireChatLock(PUBKEY);
    expect(acquireChatLock(PUBKEY)).toBeNull();
    release?.();
    expect(typeof acquireChatLock(PUBKEY)).toBe('function');
  });

  it('release is idempotent: calling it twice does not double-free another holder', async () => {
    const { acquireChatLock } = await load();
    const release = acquireChatLock(PUBKEY);
    release?.();
    release?.(); // must be a no-op, not throw, not affect anything else
    const release2 = acquireChatLock(PUBKEY);
    expect(typeof release2).toBe('function');
    // Releasing the stale first release again must not free the second holder's lock.
    release?.();
    expect(acquireChatLock(PUBKEY)).toBeNull();
  });
});
