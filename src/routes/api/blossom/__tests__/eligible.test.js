// @ts-nocheck
/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { nip19 } from 'nostr-tools';

const ALICE = 'a'.repeat(64);
const CAROL = 'c'.repeat(64);

/** @param {Record<string, string | undefined>} env */
async function loadRoute(env) {
  vi.resetModules();
  vi.doMock('$env/dynamic/private', () => ({ env }));
  const { _resetEligibilityForTests } = await import('$lib/server/blossom-eligibility.js');
  _resetEligibilityForTests();
  return import('../eligible/+server.js');
}

/** @param {string} query */
function call(handler, query) {
  return handler({ url: new URL(`http://localhost/api/blossom/eligible${query}`) });
}

describe('GET /api/blossom/eligible', () => {
  /** @type {ReturnType<typeof vi.spyOn>} */
  let fetchSpy;
  beforeEach(() => {
    fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify({ names: { alice: ALICE } }), { status: 200 })
      );
  });
  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('400 on a missing or malformed pubkey', async () => {
    const { GET } = await loadRoute({ BLOSSOM_ELIGIBLE_NIP05_DOMAINS: 'edufeed.org' });
    expect((await call(GET, '')).status).toBe(400);
    expect((await call(GET, '?pubkey=zzz')).status).toBe(400);
  });

  it('answers eligible/ineligible from the domain map, npub accepted', async () => {
    const { GET } = await loadRoute({ BLOSSOM_ELIGIBLE_NIP05_DOMAINS: 'edufeed.org' });
    const yes = await call(GET, `?pubkey=${nip19.npubEncode(ALICE)}`);
    expect(yes.status).toBe(200);
    expect(yes.headers.get('access-control-allow-origin')).toBe('*');
    await expect(yes.json()).resolves.toEqual({ eligible: true, gated: true });
    const no = await call(GET, `?pubkey=${CAROL}`);
    await expect(no.json()).resolves.toEqual({ eligible: false, gated: true });
  });

  it('gate off → eligible without touching the network', async () => {
    const { GET } = await loadRoute({});
    const res = await call(GET, `?pubkey=${CAROL}`);
    await expect(res.json()).resolves.toEqual({ eligible: true, gated: false });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('OPTIONS answers the CORS preflight', async () => {
    const { OPTIONS } = await loadRoute({});
    const res = await OPTIONS();
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(res.headers.get('access-control-allow-methods')).toContain('GET');
  });
});
