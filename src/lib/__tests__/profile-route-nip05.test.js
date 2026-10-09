/**
 * /p/<name@domain>: the profile route accepts a NIP-05 address and redirects
 * to the canonical /p/<npub> once the domain has resolved it — so the address
 * on a flyer or a school website works as a link into edufeed.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { npubEncode } from 'nostr-tools/nip19';

const ALPIKA = 'a'.repeat(64);
const lookup = vi.hoisted(() => ({ resolveNip05: vi.fn() }));

vi.mock('$lib/helpers/nip05-verify.js', async (importOriginal) => {
  const original = /** @type {any} */ (await importOriginal());
  return { ...original, resolveNip05: lookup.resolveNip05 };
});
// nostrUtils drags browser-only modules (app settings → localStorage) into
// this node test; the two helpers the route needs are trivial to stand in.
vi.mock('$lib/helpers/nostrUtils', async () => {
  const { npubEncode, decode } = await import('nostr-tools/nip19');
  return {
    hexToNpub: (/** @type {string} */ hex) => npubEncode(hex),
    normalizeToHex: (/** @type {string} */ id) => {
      if (/^[0-9a-f]{64}$/i.test(id)) return id.toLowerCase();
      try {
        const d = decode(id);
        return d.type === 'npub' ? d.data : null;
      } catch {
        return null;
      }
    }
  };
});
vi.mock('@sveltejs/kit', () => ({
  redirect: (/** @type {number} */ status, /** @type {string} */ location) => {
    const err = /** @type {any} */ (new Error('Redirect'));
    err.status = status;
    err.location = location;
    throw err;
  },
  error: (/** @type {number} */ status, /** @type {string} */ message) => {
    const err = /** @type {any} */ (new Error(message));
    err.status = status;
    throw err;
  }
}));

const { load } = await import('../../routes/p/[pubkey]/+page.js');

describe('/p/[pubkey] with a NIP-05 address', () => {
  beforeEach(() => lookup.resolveNip05.mockReset());

  it('redirects to /p/<npub> when the domain resolves the name', async () => {
    lookup.resolveNip05.mockResolvedValue(ALPIKA);
    await expect(
      load({ params: { pubkey: 'alpika-grundschule@edufeed.org' } })
    ).rejects.toMatchObject({
      status: 307,
      location: `/p/${npubEncode(ALPIKA)}`
    });
  });

  it('404s when the domain does not know the name', async () => {
    lookup.resolveNip05.mockResolvedValue(null);
    await expect(load({ params: { pubkey: 'nobody@edufeed.org' } })).rejects.toMatchObject({
      status: 404
    });
  });

  it('still loads npubs directly without a lookup', async () => {
    const data = await load({ params: { pubkey: npubEncode(ALPIKA) } });
    expect(data.pubkey).toBe(ALPIKA);
    expect(lookup.resolveNip05).not.toHaveBeenCalled();
  });
});
