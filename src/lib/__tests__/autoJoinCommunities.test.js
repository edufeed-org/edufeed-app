/**
 * Unit tests for buildAutoJoinFollowSet — used by the signup flow to build and
 * sign a kind 30000 follow set ahead of optimistic EventStore insertion.
 *
 * The helper's job is small and pure-ish:
 *   1. Normalize each identifier (npub or hex) to lowercase hex.
 *   2. Drop entries that don't decode.
 *   3. If anything remains, build a kind 30000 event with d="communities" and
 *      one p-tag per pubkey, then call signer.signEvent.
 *   4. Return the signed event + the resolved hex pubkeys.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildAutoJoinFollowSet } from '../helpers/autoJoinCommunities.js';

// Real npub → expected hex (the deployment target community). Using a real
// pair keeps the test honest about nip19 round-tripping.
const TARGET_NPUB = 'npub1hhpplya3ut9h2cyvant6pgq2w7thnkfk0hyhnz7e7gflqmy4h3yqp2p4pk';
const TARGET_HEX = 'bdc21f93b1e2cb75608cecd7a0a00a779779d9367dc9798bd9f213f06c95bc48';

const USER_PUBKEY = '0000000000000000000000000000000000000000000000000000000000000001';

/**
 * Build a fake signer that records the event it was asked to sign and returns
 * the same payload back with a sentinel `id`/`sig` so the caller can assert on
 * the structure that was actually built.
 */
function makeSigner() {
  return {
    signEvent: vi.fn(async (event) => ({
      ...event,
      id: 'fake-id',
      sig: 'fake-sig'
    }))
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('buildAutoJoinFollowSet', () => {
  it('returns {signed: null} and skips signEvent when input is empty', async () => {
    const signer = makeSigner();
    const result = await buildAutoJoinFollowSet(signer, USER_PUBKEY, []);
    expect(result).toEqual({ signed: null, targetPubkeys: [] });
    expect(signer.signEvent).not.toHaveBeenCalled();
  });

  it('returns {signed: null} and skips signEvent when input is undefined', async () => {
    // Defensive: the call site reads from runtimeConfig.signup?.autoJoinCommunities
    // which could be undefined under timing edge cases.
    const signer = makeSigner();
    const result = await buildAutoJoinFollowSet(signer, USER_PUBKEY, undefined);
    expect(result).toEqual({ signed: null, targetPubkeys: [] });
    expect(signer.signEvent).not.toHaveBeenCalled();
  });

  it('skips signEvent when every identifier is invalid', async () => {
    const signer = makeSigner();
    const result = await buildAutoJoinFollowSet(signer, USER_PUBKEY, [
      'not-an-npub',
      '',
      'npub1invalid'
    ]);
    expect(result).toEqual({ signed: null, targetPubkeys: [] });
    expect(signer.signEvent).not.toHaveBeenCalled();
  });

  it('decodes a valid npub to lowercase hex and signs a kind 30000 event', async () => {
    const signer = makeSigner();
    const { signed, targetPubkeys } = await buildAutoJoinFollowSet(signer, USER_PUBKEY, [
      TARGET_NPUB
    ]);

    expect(targetPubkeys).toEqual([TARGET_HEX]);
    expect(signer.signEvent).toHaveBeenCalledTimes(1);

    const built = signer.signEvent.mock.calls[0][0];
    expect(built.kind).toBe(30000);
    expect(built.pubkey).toBe(USER_PUBKEY);
    expect(built.content).toBe('');
    // Tag order must be: d-tag first, then one p-tag per community.
    // Stable shape lets relays recognise the follow set as the canonical
    // "communities" set rather than a generic kind 30000 list.
    expect(built.tags).toEqual([
      ['d', 'communities'],
      ['p', TARGET_HEX]
    ]);
    expect(typeof built.created_at).toBe('number');

    expect(signed).toMatchObject({ kind: 30000, sig: 'fake-sig' });
  });

  it('passes raw hex pubkeys through (lowercased)', async () => {
    const signer = makeSigner();
    const { targetPubkeys } = await buildAutoJoinFollowSet(signer, USER_PUBKEY, [
      TARGET_HEX.toUpperCase()
    ]);
    expect(targetPubkeys).toEqual([TARGET_HEX]);
  });

  it('filters mixed valid/invalid entries; only valid pubkeys end up as p-tags', async () => {
    const signer = makeSigner();
    const { signed, targetPubkeys } = await buildAutoJoinFollowSet(signer, USER_PUBKEY, [
      'garbage',
      TARGET_NPUB,
      ''
    ]);

    expect(targetPubkeys).toEqual([TARGET_HEX]);
    expect(signed?.tags).toEqual([
      ['d', 'communities'],
      ['p', TARGET_HEX]
    ]);
  });

  it('emits one p-tag per identifier in input order (no de-duplication)', async () => {
    // Helper does not de-dupe — that's the responsibility of the env-var
    // author. We just verify input order is preserved so deployments can rely
    // on a stable tag layout.
    const signer = makeSigner();
    const SECOND_NPUB = 'npub1f7jar3qnu269uyx5p0e4v24hqxjnxysxudvujza2ur5ehltvdeqsly2fx9';
    const { signed, targetPubkeys } = await buildAutoJoinFollowSet(signer, USER_PUBKEY, [
      TARGET_NPUB,
      SECOND_NPUB
    ]);

    expect(targetPubkeys).toHaveLength(2);
    expect(targetPubkeys[0]).toBe(TARGET_HEX);
    expect(signed?.tags[0]).toEqual(['d', 'communities']);
    expect(signed?.tags).toHaveLength(3); // d + 2 p-tags
  });

  it('propagates signer errors to the caller', async () => {
    // Signing failures are unusual but real (e.g. NIP-46 disconnect mid-flow).
    // Caller is expected to handle this — we don't swallow it because the
    // signup flow needs to know whether to roll back optimistic state.
    const signer = {
      signEvent: vi.fn(async () => {
        throw new Error('signer offline');
      })
    };
    await expect(buildAutoJoinFollowSet(signer, USER_PUBKEY, [TARGET_NPUB])).rejects.toThrow(
      'signer offline'
    );
  });
});
