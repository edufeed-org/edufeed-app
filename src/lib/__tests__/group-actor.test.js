/** @vitest-environment node */
/**
 * resolveGroupActor — which identity signs a root-roster moderation event
 * (put-user, remove-user, create-invite). The members surfaces open for the
 * key-holding owner too, but the relay only honours pubkeys in the group's
 * 39001: on the Edufeed community that is the community key alone, so the
 * owner's personal account got "not allowed" (laoc, 2026-09-22).
 */
import { describe, it, expect, vi } from 'vitest';

const signers = vi.hoisted(() => ({ community: /** @type {any} */ (null) }));
vi.mock('$lib/helpers/community-signer.js', () => ({
  getCommunitySigner: (/** @type {string} */ pk) => (pk === COMMUNITY ? signers.community : null)
}));

const COMMUNITY = 'e'.repeat(64);
const ME = 'a'.repeat(64);
const me = { pubkey: ME, signer: { sign: 'me' } };

const { resolveGroupActor } = await import('$lib/groups/group-actor.js');

describe('resolveGroupActor', () => {
  it('returns null when nobody is signed in', () => {
    signers.community = { sign: 'community' };
    expect(resolveGroupActor(null, [], COMMUNITY)).toBeNull();
  });

  it('keeps the active account when the roster lists it with a moderation role', () => {
    signers.community = { sign: 'community' };
    const admins = [{ pubkey: ME, roles: ['admin'] }];
    expect(resolveGroupActor(me, admins, COMMUNITY)).toBe(me);
  });

  it('signs as the community when the active account is not a relay moderator but holds the key', () => {
    signers.community = { sign: 'community' };
    const admins = [{ pubkey: COMMUNITY, roles: ['admin'] }];
    expect(resolveGroupActor(me, admins, COMMUNITY)).toEqual({
      pubkey: COMMUNITY,
      signer: signers.community
    });
  });

  it('a publisher-only roster entry is not a moderator — still signs as the community', () => {
    signers.community = { sign: 'community' };
    const admins = [{ pubkey: ME, roles: ['publisher'] }];
    expect(resolveGroupActor(me, admins, COMMUNITY)?.pubkey).toBe(COMMUNITY);
  });

  it('falls back to the active account when there is no community key (per-channel modals)', () => {
    signers.community = null;
    expect(resolveGroupActor(me, [], COMMUNITY)).toBe(me);
    expect(resolveGroupActor(me, [], null)).toBe(me);
  });
});
