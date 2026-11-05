/** @vitest-environment node */
import { describe, it, expect, vi } from 'vitest';
import { nip19 } from 'nostr-tools';

vi.mock('$env/dynamic/private', () => ({ env: { FALLBACK_RELAYS: 'wss://relay.example.com' } }));

const { fetchFirstEventResult } = vi.hoisted(() => ({ fetchFirstEventResult: vi.fn() }));
vi.mock('$lib/server/relay-fetch.js', async (importActual) => ({
  ...(await importActual()),
  fetchFirstEventResult
}));

const { ogMetaHandle, ogCache } = await import('$lib/server/og.js');

/** @param {string} pathname */
function handleInput(pathname) {
  const event = /** @type {any} */ ({ url: new URL(`https://app.example.com${pathname}`) });
  const resolve = vi.fn(async () => new Response('<html><head></head><body></body></html>'));
  return { event, resolve };
}

describe('ogMetaHandle in-flight dedupe', () => {
  it('shares one relay fetch between concurrent requests for the same uncached page', async () => {
    ogCache.clear();
    /** @type {(v: any) => void} */
    let answer = () => {};
    fetchFirstEventResult.mockImplementation(() => new Promise((resolve) => (answer = resolve)));
    const path = `/p/${nip19.npubEncode('c'.repeat(64))}`;

    const first = ogMetaHandle(/** @type {any} */ (handleInput(path)));
    const second = ogMetaHandle(/** @type {any} */ (handleInput(path)));
    await new Promise((r) => setTimeout(r, 0));
    answer({ event: null, complete: true });
    await Promise.all([first, second]);

    expect(fetchFirstEventResult).toHaveBeenCalledTimes(1);
  });
});
