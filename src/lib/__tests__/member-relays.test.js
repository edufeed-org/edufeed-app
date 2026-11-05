/**
 * MEMBER_RELAYS: everything a member of the deployment publishes also goes to
 * the deployment's own relays (laoc, 2026-11-05: "edufeed.org members should
 * always also write to relay.edufeed.org"). Membership counts only through the
 * NIP-05 directory of NIP05_HANDLE_DOMAIN — anyone can type "@edufeed.org"
 * into a profile.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const runtimeConfig = vi.hoisted(() => ({ membership: /** @type {any} */ ({}) }));
vi.mock('$lib/stores/config.svelte.js', () => ({ runtimeConfig }));

const MEMBER = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);

/** @param {any} body */
const okFetch = (body) => vi.fn(async () => ({ ok: true, json: async () => body }));

/** @type {any} */
let mod;
beforeEach(async () => {
  vi.resetModules();
  runtimeConfig.membership = { handleDomain: 'edufeed.org', relays: ['wss://relay.edufeed.org'] };
  mod = await import('$lib/services/member-relays.js');
});

describe('getMemberRelays', () => {
  it('returns the member relays for a pubkey listed in the directory', async () => {
    const fetchImpl = okFetch({ names: { kaya: MEMBER.toUpperCase() } });
    expect(await mod.getMemberRelays(MEMBER, fetchImpl)).toEqual(['wss://relay.edufeed.org']);
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://edufeed.org/.well-known/nostr.json',
      expect.objectContaining({ headers: { Accept: 'application/json' } })
    );
  });

  it('returns nothing for someone outside the directory', async () => {
    expect(await mod.getMemberRelays(OTHER, okFetch({ names: { kaya: MEMBER } }))).toEqual([]);
  });

  it('reads the directory once for many publishes', async () => {
    const fetchImpl = okFetch({ names: { kaya: MEMBER } });
    await mod.getMemberRelays(MEMBER, fetchImpl);
    await mod.getMemberRelays(OTHER, fetchImpl);
    await mod.getMemberRelays(MEMBER, fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('does not fetch at all without a handle domain or member relays', async () => {
    const fetchImpl = okFetch({ names: { kaya: MEMBER } });
    runtimeConfig.membership = { handleDomain: 'edufeed.org', relays: [] };
    expect(await mod.getMemberRelays(MEMBER, fetchImpl)).toEqual([]);
    runtimeConfig.membership = { handleDomain: '', relays: ['wss://relay.edufeed.org'] };
    expect(await mod.getMemberRelays(MEMBER, fetchImpl)).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('never blocks a publish on a broken directory, and asks again later', async () => {
    const failing = vi.fn(async () => {
      throw new Error('offline');
    });
    expect(await mod.getMemberRelays(MEMBER, failing)).toEqual([]);
    const fetchImpl = okFetch({ names: { kaya: MEMBER } });
    expect(await mod.getMemberRelays(MEMBER, fetchImpl)).toEqual(['wss://relay.edufeed.org']);
  });
});
