/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { shouldToast, surfaceForPath } from '$lib/helpers/system-notifications.js';

describe('shouldToast without Concord levels', () => {
  const base = {
    createdAt: 1_000,
    enabled: true,
    permissionGranted: true,
    tabVisible: false,
    isActiveChannel: false,
    marker: 0,
    startTime: 500,
    lastToastAt: 0,
    now: 100_000
  };

  it('defaults level to all when a source has no per-channel levels', () => {
    expect(shouldToast(base)).toBe(true);
  });

  it('still honours the opt-in, permission, replay and throttle guards', () => {
    expect(shouldToast({ ...base, enabled: false })).toBe(false);
    expect(shouldToast({ ...base, permissionGranted: false })).toBe(false);
    expect(shouldToast({ ...base, createdAt: 500 })).toBe(false);
    expect(shouldToast({ ...base, createdAt: 400, marker: 450, startTime: 0 })).toBe(false);
    expect(shouldToast({ ...base, lastToastAt: 90_000 })).toBe(false);
  });

  it('stays quiet while the user is looking at the target surface', () => {
    expect(shouldToast({ ...base, tabVisible: true, isActiveChannel: true })).toBe(false);
    expect(shouldToast({ ...base, tabVisible: false, isActiveChannel: true })).toBe(true);
    expect(shouldToast({ ...base, tabVisible: true, isActiveChannel: false })).toBe(true);
  });
});

describe('surfaceForPath', () => {
  it('maps the DM view and the inbox, with or without trailing slash or sub-path', () => {
    expect(surfaceForPath('/c/messages')).toBe('dm');
    expect(surfaceForPath('/c/messages/')).toBe('dm');
    expect(surfaceForPath('/c/inbox')).toBe('inbox');
    expect(surfaceForPath('/c/inbox/')).toBe('inbox');
  });

  it('returns null for every other route, including look-alike prefixes', () => {
    expect(surfaceForPath('/')).toBeNull();
    expect(surfaceForPath('/c/messagesx')).toBeNull();
    expect(surfaceForPath('/discover')).toBeNull();
    expect(surfaceForPath('/c/abc123/inbox')).toBeNull();
  });
});
