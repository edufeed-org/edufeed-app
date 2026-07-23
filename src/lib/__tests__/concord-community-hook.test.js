/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { shouldShowChannelsTab } from '$lib/concord/community.svelte.js';

describe('shouldShowChannelsTab', () => {
  const base = { enabled: true, pointer: undefined, isOwner: false, isMember: false };
  it('hidden when flag off, regardless of everything else', () => {
    expect(
      shouldShowChannelsTab({ ...base, enabled: false, pointer: {}, isOwner: true, isMember: true })
    ).toBe(false);
  });
  it('visible for members even without pointer (invite-first join)', () => {
    expect(shouldShowChannelsTab({ ...base, isMember: true })).toBe(true);
  });
  it('visible when pointer exists (non-member sees invite inbox)', () => {
    expect(shouldShowChannelsTab({ ...base, pointer: { communityId: 'x' } })).toBe(true);
  });
  it('visible for owner without pointer (founding affordance)', () => {
    expect(shouldShowChannelsTab({ ...base, isOwner: true })).toBe(true);
  });
  it('hidden otherwise', () => {
    expect(shouldShowChannelsTab(base)).toBe(false);
  });
});
