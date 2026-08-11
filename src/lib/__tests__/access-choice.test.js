/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { accessChoiceToNip29, disclosureKind } from '$lib/groups/access-choice.js';

const meta = (/** @type {string[][]} */ extra = []) => ({
  kind: 39000,
  tags: [['d', 'x'], ...extra]
});

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

describe('disclosureKind', () => {
  it('reads world from the RAW tags, not the applesauce parse', () => {
    expect(disclosureKind(meta(), 'members')).toBe('world');
  });
  it('splits members vs invited on the pointer access slot', () => {
    expect(disclosureKind(meta([['private']]), 'members')).toBe('members');
    expect(disclosureKind(meta([['private']]), 'invited')).toBe('invited');
    expect(disclosureKind(meta([['private']]), undefined)).toBe('invited');
  });
  it('unknown while metadata has not loaded', () => {
    expect(disclosureKind(null, 'members')).toBe('unknown');
  });
});
