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
  it('weltoffen: public to READ, still closed to join', () => {
    expect(accessChoiceToNip29({ tier: 'members', worldReadable: true })).toEqual({
      isPublic: true,
      isOpen: false,
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
});
