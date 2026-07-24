/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { shouldShowChannelsTab, deriveVisibleChannels } from '$lib/concord/community.svelte.js';

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

describe('deriveVisibleChannels', () => {
  it('includes a public channel and marks it accessible even without a held key', () => {
    const channels = [{ channel_id: 'general', private: false }];
    expect(deriveVisibleChannels(channels, [])).toEqual([
      { channel_id: 'general', private: false, accessible: true }
    ]);
  });

  it('includes a private channel with a held key and marks it accessible', () => {
    const channels = [{ channel_id: 'secret', private: true }];
    expect(deriveVisibleChannels(channels, ['secret'])).toEqual([
      { channel_id: 'secret', private: true, accessible: true }
    ]);
  });

  it('includes a private channel without a held key but marks it inaccessible', () => {
    const channels = [{ channel_id: 'secret', private: true }];
    expect(deriveVisibleChannels(channels, [])).toEqual([
      { channel_id: 'secret', private: true, accessible: false }
    ]);
  });

  it('drops deleted channels regardless of privacy or held keys', () => {
    const channels = [
      { channel_id: 'general', private: false, deleted: true },
      { channel_id: 'secret', private: true, deleted: true }
    ];
    expect(deriveVisibleChannels(channels, ['secret'])).toEqual([]);
  });

  it('preserves other channel fields untouched', () => {
    const channels = [{ channel_id: 'general', private: false, name: 'General' }];
    expect(deriveVisibleChannels(channels, [])).toEqual([
      { channel_id: 'general', private: false, name: 'General', accessible: true }
    ]);
  });
});
