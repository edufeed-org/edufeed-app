/**
 * Community layout load() tests.
 *
 * The layout load validates the [pubkey] route param and exposes hex +
 * npub forms to child routes. npub is canonical; a raw hex pubkey must be
 * gracefully redirected to its npub URL (preserving sub-path and query)
 * rather than throwing a 400.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { load } from '../+layout.js';
import { hexToNpub } from '$lib/helpers/pubkey.js';

const HEX = 'ae6199bb435d70a0ecce61324ac80e7c24dedf2b0680cbd3e94983e7557746a2';
const NPUB = /** @type {string} */ (hexToNpub(HEX));

/**
 * @param {string} pubkey
 * @param {string} [pathname]
 * @param {string} [search]
 */
function callLoad(pubkey, pathname = `/c/${pubkey}`, search = '') {
  const url = new URL(`https://example.com${pathname}${search}`);
  return /** @type {any} */ (load(/** @type {any} */ ({ params: { pubkey }, url })));
}

describe('community +layout.js load', () => {
  it('passes through a valid npub, exposing hex + npub', async () => {
    const data = await callLoad(NPUB);
    expect(data.pubkey).toBe(HEX);
    expect(data.npub).toBe(NPUB);
  });

  it('redirects a raw hex pubkey to its npub URL', async () => {
    /** @type {any} */
    let thrown;
    try {
      await callLoad(HEX);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeDefined();
    expect(thrown.status).toBe(308);
    expect(thrown.location).toBe(`/c/${NPUB}`);
  });

  it('preserves sub-path and query when redirecting hex to npub', async () => {
    /** @type {any} */
    let thrown;
    try {
      await callLoad(HEX, `/c/${HEX}/chat`, '?view=chat');
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeDefined();
    expect(thrown.location).toBe(`/c/${NPUB}/chat?view=chat`);
  });

  it('throws 400 for a genuinely invalid identifier', async () => {
    /** @type {any} */
    let thrown;
    try {
      await callLoad('not-a-pubkey');
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeDefined();
    expect(thrown.status).toBe(400);
  });
});
