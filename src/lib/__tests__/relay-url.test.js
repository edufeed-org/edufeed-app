/** @vitest-environment node */
// sameRelayUrl — relay-url equality for user-authored strings. A kind-10009
// written by another client may lack the trailing slash normalizeURL adds, and
// a raw === compare then silently drops relay-hidden channels
// (host-channels.svelte.js). Malformed input must compare, never throw.
import { describe, it, expect } from 'vitest';
import { sameRelayUrl } from '$lib/groups/relay-url.js';

describe('sameRelayUrl', () => {
  it('treats trailing-slash and case variants as the same relay', () => {
    expect(sameRelayUrl('wss://groups.edufeed.org', 'wss://groups.edufeed.org/')).toBe(true);
    expect(sameRelayUrl('wss://Groups.Edufeed.org/', 'wss://groups.edufeed.org/')).toBe(true);
  });

  it('distinguishes different relays', () => {
    expect(sameRelayUrl('wss://a.example/', 'wss://b.example/')).toBe(false);
    expect(sameRelayUrl('wss://a.example/', 'wss://a.example/sub')).toBe(false);
  });

  it('never throws on garbage, falling back to strict equality', () => {
    expect(sameRelayUrl('not a url', 'not a url')).toBe(true);
    expect(sameRelayUrl('not a url', 'wss://a.example/')).toBe(false);
    expect(sameRelayUrl(/** @type {any} */ (null), 'wss://a.example/')).toBe(false);
  });
});
