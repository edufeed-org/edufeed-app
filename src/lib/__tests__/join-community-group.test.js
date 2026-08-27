/**
 * joinCommunityGroup — applicant-side kind-9021 send for a moderated
 * community's root group (Plan 4 / Task 4).
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi } from 'vitest';

/** @type {{ relay: any }} */
const mockState = vi.hoisted(() => ({ relay: null }));
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  pool: { relay: vi.fn((/** @type {string} */ _url) => mockState.relay) }
}));

import { joinCommunityGroup } from '$lib/groups/join-community-group.js';
import { pool } from '$lib/stores/nostr-infrastructure.svelte';

const POINTER = { id: 'abc123def456aa00', relay: 'wss://groups.example' };
const USER = {
  pubkey: 'f'.repeat(64),
  signer: { signEvent: vi.fn(async (/** @type {any} */ t) => ({ ...t, id: 'signed', sig: 'sig' })) }
};

describe('joinCommunityGroup', () => {
  it('publishes a bare 9021 to the pointer relay, signed by the given user', async () => {
    mockState.relay = { publish: vi.fn(async () => ({ ok: true })) };
    await joinCommunityGroup({ pointer: POINTER, user: USER });

    expect(pool.relay).toHaveBeenCalledWith(POINTER.relay);
    expect(USER.signer.signEvent).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 9021, tags: [['h', POINTER.id]], pubkey: USER.pubkey })
    );
    expect(mockState.relay.publish).toHaveBeenCalledOnce();
  });

  it('adds a code tag when an invite code is given', async () => {
    mockState.relay = { publish: vi.fn(async () => ({ ok: true })) };
    await joinCommunityGroup({ pointer: POINTER, code: 'sekrit', user: USER });

    expect(USER.signer.signEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        tags: [
          ['h', POINTER.id],
          ['code', 'sekrit']
        ]
      })
    );
  });

  it('omits the code tag for a null/empty code the same as no code at all', async () => {
    mockState.relay = { publish: vi.fn(async () => ({ ok: true })) };
    await joinCommunityGroup({ pointer: POINTER, code: null, user: USER });

    expect(USER.signer.signEvent).toHaveBeenCalledWith(
      expect.objectContaining({ tags: [['h', POINTER.id]] })
    );
  });

  it('rethrows the relay rejection reason', async () => {
    mockState.relay = { publish: vi.fn(async () => ({ ok: false, message: 'not a member' })) };
    await expect(joinCommunityGroup({ pointer: POINTER, user: USER })).rejects.toThrow(
      'not a member'
    );
  });
});
