// @ts-nocheck
/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const settings = vi.hoisted(() => ({ systemNotificationsEnabled: false }));
vi.mock('$lib/stores/app-settings.svelte.js', () => ({ appSettings: settings }));

import {
  toggleSystemNotifications,
  isNotificationPermissionDenied
} from '$lib/stores/notification-permission.svelte.js';

class FakeNotification {
  static permission = 'default';
  static requestPermission = vi.fn(async () => FakeNotification.permission);
}

beforeEach(() => {
  settings.systemNotificationsEnabled = false;
  FakeNotification.permission = 'default';
  FakeNotification.requestPermission.mockClear();
  vi.stubGlobal('Notification', FakeNotification);
});

afterEach(() => vi.unstubAllGlobals());

describe('toggleSystemNotifications', () => {
  it('asks for permission and enables only when granted', async () => {
    FakeNotification.requestPermission.mockResolvedValueOnce('granted');
    expect(await toggleSystemNotifications()).toBe('on');
    expect(settings.systemNotificationsEnabled).toBe(true);
    expect(FakeNotification.requestPermission).toHaveBeenCalledTimes(1);
  });

  it('leaves the flag off when the browser denies or dismisses the prompt', async () => {
    FakeNotification.requestPermission.mockResolvedValueOnce('denied');
    expect(await toggleSystemNotifications()).toBe('denied');
    expect(settings.systemNotificationsEnabled).toBe(false);

    FakeNotification.requestPermission.mockResolvedValueOnce('default');
    expect(await toggleSystemNotifications()).toBe('default');
    expect(settings.systemNotificationsEnabled).toBe(false);
  });

  it('does not prompt again when permission is already granted', async () => {
    FakeNotification.permission = 'granted';
    expect(await toggleSystemNotifications()).toBe('on');
    expect(FakeNotification.requestPermission).not.toHaveBeenCalled();
  });

  it('turns off without touching the browser', async () => {
    settings.systemNotificationsEnabled = true;
    expect(await toggleSystemNotifications()).toBe('off');
    expect(settings.systemNotificationsEnabled).toBe(false);
    expect(FakeNotification.requestPermission).not.toHaveBeenCalled();
  });

  it('reports unsupported browsers instead of throwing', async () => {
    vi.stubGlobal('Notification', undefined);
    expect(await toggleSystemNotifications()).toBe('unsupported');
    expect(isNotificationPermissionDenied()).toBe(false);
  });

  it('exposes the denied state', () => {
    FakeNotification.permission = 'denied';
    expect(isNotificationPermissionDenied()).toBe(true);
  });
});
