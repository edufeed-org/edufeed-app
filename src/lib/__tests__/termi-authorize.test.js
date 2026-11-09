/** @vitest-environment node */
import { describe, it, expect, vi, afterEach } from 'vitest';

const URL_ = 'http://localhost/api/termi/extract';
const PUBKEY = 'a'.repeat(64);

/** @param {{ signer?: string | null, eligible?: boolean | null }} [opts] */
async function load({ signer = PUBKEY, eligible = true } = {}) {
  vi.resetModules();
  vi.doMock('$env/dynamic/private', () => ({ env: {} }));
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
});
