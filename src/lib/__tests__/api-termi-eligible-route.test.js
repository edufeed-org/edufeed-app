/** @vitest-environment node */
// GET /api/termi/eligible — the client's probe for the assistant's NIP-05
// gate (TERMI_ELIGIBLE_NIP05_DOMAINS), same shape as /api/blossom/eligible.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { nip19 } from 'nostr-tools';

const ALICE = 'a'.repeat(64);
const BOB = 'b'.repeat(64);

/** @param {Record<string, string>} env */
async function importRoute(env) {
  vi.resetModules();
  vi.doMock('$env/dynamic/private', () => ({ env }));
  const fetchSpy = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(
      async () => new Response(JSON.stringify({ names: { alice: ALICE } }), { status: 200 })
    );
  const mod = await import('../../routes/api/termi/eligible/+server.js');
  return { GET: mod.GET, fetchSpy };
}

/** @param {string} query @returns {any} */
const ev = (query) => ({ url: new URL(`http://localhost/api/termi/eligible${query}`) });

afterEach(() => {
  vi.doUnmock('$env/dynamic/private');
  vi.restoreAllMocks();
});

describe('GET /api/termi/eligible', () => {
  it('answers eligible for a listed pubkey (hex or npub), private cache, no CORS', async () => {
    const { GET, fetchSpy } = await importRoute({
      TERMI_ELIGIBLE_NIP05_DOMAINS: 'https://Edufeed.org/'
    });
    const res = await GET(ev(`?pubkey=${nip19.npubEncode(ALICE)}`));
    expect(await res.json()).toEqual({ eligible: true, gated: true });
    expect(res.headers.get('cache-control')).toBe('private, max-age=60');
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
    expect(String(fetchSpy.mock.calls[0][0])).toBe('https://edufeed.org/.well-known/nostr.json');
  });

  it('answers false for an unlisted pubkey', async () => {
    const { GET } = await importRoute({ TERMI_ELIGIBLE_NIP05_DOMAINS: 'edufeed.org' });
    expect(await (await GET(ev(`?pubkey=${BOB}`))).json()).toEqual({
      eligible: false,
      gated: true
    });
  });

  it('answers null while a directory cannot be loaded', async () => {
    const { GET, fetchSpy } = await importRoute({ TERMI_ELIGIBLE_NIP05_DOMAINS: 'edufeed.org' });
    fetchSpy.mockRejectedValue(new Error('down'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await (await GET(ev(`?pubkey=${ALICE}`))).json()).toEqual({
      eligible: null,
      gated: true
    });
  });

  it('never reads the Blossom domains; no Termi domain means nobody is eligible', async () => {
    const { GET, fetchSpy } = await importRoute({ BLOSSOM_ELIGIBLE_NIP05_DOMAINS: 'edufeed.org' });
    expect(await (await GET(ev(`?pubkey=${ALICE}`))).json()).toEqual({
      eligible: false,
      gated: true
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects a malformed pubkey with 400', async () => {
    const { GET } = await importRoute({ TERMI_ELIGIBLE_NIP05_DOMAINS: 'edufeed.org' });
    expect((await GET(ev('?pubkey=nope'))).status).toBe(400);
  });
});
