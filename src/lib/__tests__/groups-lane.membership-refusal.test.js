/** @vitest-environment node */
// "blocked: unknown member" (buzz, hzrd149) means: join first. The UI should
// say that, not a generic failure (laoc, 2026-08-11).
import { describe, it, expect } from 'vitest';
import { isMembershipRefusal } from '$lib/groups/groups.js';

describe('isMembershipRefusal', () => {
  it('recognises the wordings live relays actually use', () => {
    expect(isMembershipRefusal(new Error('blocked: unknown member'))).toBe(true);
    expect(isMembershipRefusal(new Error('restricted: not a member'))).toBe(true);
    expect(isMembershipRefusal(new Error('blocked: relay membership required'))).toBe(true);
  });
  it('leaves other refusals alone', () => {
    expect(isMembershipRefusal(new Error('auth-required: do auth'))).toBe(false);
    expect(isMembershipRefusal(new Error('invalid: channel name is required'))).toBe(false);
    expect(isMembershipRefusal(null)).toBe(false);
  });
});
