/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const buildInviteBundle = vi.hoisted(() => vi.fn(() => ({ bundle: true })));
const create = vi.hoisted(() => vi.fn(() => Promise.resolve({ wrap: true })));
vi.mock('applesauce-concord/helpers', () => ({ buildInviteBundle }));
vi.mock('applesauce-concord/factories', () => ({ DirectInviteFactory: { create } }));

import { directInviteToArea } from '$lib/concord/area-invite.js';

const MEMBER = 'b'.repeat(64);
function makeCommunity() {
  return {
    material: { community_id: 'cid' },
    pubkey: 'a'.repeat(64),
    signer: { sign: true },
    state$: { value: { metadata: { name: 'Area', icon: 'i' } } },
    eventStore: { add: vi.fn() },
    pool: { publish: vi.fn(() => Promise.resolve()) },
    relays: () => ['wss://r']
  };
}
beforeEach(() => {
  buildInviteBundle.mockClear();
  create.mockClear();
});

describe('directInviteToArea', () => {
  it('builds an AREA bundle (channels: []) and gift-wraps+publishes it', async () => {
    const c = makeCommunity();
    await directInviteToArea(c, MEMBER);
    expect(buildInviteBundle).toHaveBeenCalledWith(
      c.material,
      expect.objectContaining({ channels: [], creator_npub: c.pubkey, name: 'Area' })
    );
    expect(create).toHaveBeenCalledWith({ bundle: true }, MEMBER, c.signer);
    expect(c.eventStore.add).toHaveBeenCalledWith({ wrap: true });
    expect(c.pool.publish).toHaveBeenCalledWith(['wss://r'], { wrap: true });
  });

  it('swallows a publish rejection (best-effort)', async () => {
    const c = makeCommunity();
    c.pool.publish = vi.fn(() => Promise.reject(new Error('relay down')));
    await expect(directInviteToArea(c, MEMBER)).resolves.toBeUndefined();
  });
});
