/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { accessChoiceToNip29 } from '$lib/groups/access-choice.js';

// Two relay-observable tiers now (the relay-trust "members" tier is retired to
// Concord): `world` = not private + open self-join; `invited` = private + closed.
describe('accessChoiceToNip29', () => {
  it('world: public to READ and open to bare 9021 self-join', () => {
    expect(accessChoiceToNip29({ tier: 'world' })).toEqual({ isPublic: true, isOpen: true });
  });

  it('invited: private (members-only read) and closed (join needs an admin)', () => {
    expect(accessChoiceToNip29({ tier: 'invited' })).toEqual({ isPublic: false, isOpen: false });
  });

  it('anything that is not "world" fails closed to private+closed', () => {
    expect(accessChoiceToNip29(/** @type {any} */ ({ tier: 'nonsense' }))).toEqual({
      isPublic: false,
      isOpen: false
    });
  });
});
