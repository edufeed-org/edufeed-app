/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { accessChoiceToNip29 } from '$lib/groups/access-choice.js';

describe('accessChoiceToNip29', () => {
  it('Stufe 2: private, closed, access members', () => {
    expect(accessChoiceToNip29({ tier: 'members', worldReadable: false })).toEqual({
      isPublic: false,
      isOpen: false,
      access: 'members'
    });
  });
  it('weltoffen: public to READ and open to self-join (world channel)', () => {
    expect(accessChoiceToNip29({ tier: 'members', worldReadable: true })).toEqual({
      isPublic: true,
      isOpen: true,
      access: 'members'
    });
  });
  it('Stufe 3: private, closed, access invited — weltoffen has no effect', () => {
    expect(accessChoiceToNip29({ tier: 'invited', worldReadable: true })).toEqual({
      isPublic: false,
      isOpen: false,
      access: 'invited'
    });
  });

  it('world channels are open groups — bare 9021 self-join, no admin approval', () => {
    const world = accessChoiceToNip29({ tier: 'members', worldReadable: true });
    expect(world).toMatchObject({ isPublic: true, isOpen: true });
    // members-only and invited channels stay closed (join needs relay policy or code)
    expect(accessChoiceToNip29({ tier: 'members', worldReadable: false }).isOpen).toBe(false);
    expect(accessChoiceToNip29({ tier: 'invited' }).isOpen).toBe(false);
  });
});
