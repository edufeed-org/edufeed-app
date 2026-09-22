// @ts-nocheck

/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { flushSync } from 'svelte';

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$app/paths', () => ({ resolve: (p) => p }));
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: { getReplaceable: () => undefined }
}));
// helpers/inbox.js → forms.js → event-factory.js / relay-service → relay
// pool; cut the chain at the same boundaries the inbox-service tests use.
vi.mock('$lib/helpers/event-factory.js', () => ({
  createAppEventFactory: vi.fn(),
  finalizeDraft: vi.fn()
}));
vi.mock('$lib/loaders/base.js', () => ({
  timedPool: vi.fn(),
  addressLoader: vi.fn(),
  eventLoader: vi.fn()
}));
vi.mock('$lib/services/relay-service.svelte.js', () => ({
  getRelayListLookupRelays: () => [],
  getReadRelays: vi.fn(async () => []),
  getWriteRelays: vi.fn(async () => [])
}));
vi.mock('$lib/stores/accounts.svelte', () => ({
  manager: { active: null, active$: { subscribe: vi.fn() } },
  getActiveUser: () => null
}));
vi.mock('$lib/services/dm-service.svelte.js', async () => {
  const fakes = await import('./__mocks__/system-notifications-fakes.svelte.js');
  return {
    getKnownDmConversations: fakes.getKnownDmConversations,
    isDmConversationUnread: fakes.isDmConversationUnread
  };
});
vi.mock('$lib/services/inbox-service.svelte.js', async () => {
  const fakes = await import('./__mocks__/system-notifications-fakes.svelte.js');
  return {
    getNotifications: fakes.getNotifications,
    isNotificationUnread: fakes.isNotificationUnread
  };
});
const settings = vi.hoisted(() => ({ systemNotificationsEnabled: false }));
vi.mock('$lib/stores/app-settings.svelte.js', () => ({ appSettings: settings }));

import * as fakes from './__mocks__/system-notifications-fakes.svelte.js';
import {
  startSystemNotifications,
  stopSystemNotifications
} from '$lib/services/system-notifications.svelte.js';
import { goto } from '$app/navigation';

const ME = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);
const THIRD = 'c'.repeat(64);

/** @type {Array<{title: string, options: any, instance: any}>} */
let created;
class FakeNotification {
  static permission = 'granted';
  constructor(title, options) {
    this.title = title;
    this.options = options;
    created.push({ title, options, instance: this });
  }
}

function conversation({ id, from = OTHER, created_at, participants = [ME, from] }) {
  return { id, participants, lastMessage: { pubkey: from, created_at, content: 'secret' } };
}

function inboxEvent({ id, kind = 7, from = OTHER, created_at, tags = [] }) {
  return { id, kind, pubkey: from, created_at, tags: [['p', ME], ...tags], content: '+' };
}

const NOW = Math.floor(Date.now() / 1000);

function setVisibility(state) {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
}

beforeEach(() => {
  created = [];
  vi.stubGlobal('Notification', FakeNotification);
  FakeNotification.permission = 'granted';
  settings.systemNotificationsEnabled = true;
  fakes.reset();
  vi.spyOn(window, 'focus').mockImplementation(() => {});
  window.history.replaceState({}, '', '/discover');
  setVisibility('visible');
});

afterEach(() => {
  stopSystemNotifications();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Emit a fresh known conversation newer than service start. */
function freshDm(offset = 10, id = 'conv-1', from = OTHER) {
  fakes.dmUnread.add(id);
  fakes.setKnown([conversation({ id, from, created_at: NOW + offset })]);
  flushSync();
}

describe('DM toasts', () => {
  it('does not toast for the conversations already present when the service starts', () => {
    fakes.dmUnread.add('conv-old');
    fakes.setKnown([conversation({ id: 'conv-old', created_at: NOW - 100 })]);
    startSystemNotifications(ME);
    flushSync();
    expect(created).toHaveLength(0);
  });

  it('toasts once for a fresh message from a known sender, tagged per conversation, without content', () => {
    startSystemNotifications(ME);
    flushSync();
    freshDm();
    expect(created).toHaveLength(1);
    expect(created[0].options.tag).toBe('dm-conv-1');
    expect(created[0].options.body).not.toContain('secret');
    expect(created[0].title).not.toContain('secret');
    // Same data emitted again (e.g. an unrelated re-render) must not re-toast.
    fakes.setKnown([...fakes.getKnownDmConversations()]);
    flushSync();
    expect(created).toHaveLength(1);
  });

  it('ignores messages the user sent themselves', () => {
    startSystemNotifications(ME);
    flushSync();
    fakes.setKnown([conversation({ id: 'conv-1', from: ME, created_at: NOW + 10 })]);
    flushSync();
    expect(created).toHaveLength(0);
  });

  it('skips a conversation that is already marked read', () => {
    startSystemNotifications(ME);
    flushSync();
    fakes.setKnown([conversation({ id: 'conv-1', created_at: NOW + 10 })]); // not in dmUnread
    flushSync();
    expect(created).toHaveLength(0);
  });

  it('stays quiet while the DM view is visible, and fires once the tab is hidden', () => {
    startSystemNotifications(ME);
    flushSync();
    window.history.replaceState({}, '', '/c/messages');
    freshDm(10);
    expect(created).toHaveLength(0);
    setVisibility('hidden');
    freshDm(20, 'conv-2', THIRD);
    expect(created).toHaveLength(1);
  });

  it('respects the global opt-in and the browser permission', () => {
    settings.systemNotificationsEnabled = false;
    startSystemNotifications(ME);
    flushSync();
    freshDm(10);
    expect(created).toHaveLength(0);

    settings.systemNotificationsEnabled = true;
    FakeNotification.permission = 'default';
    freshDm(20, 'conv-2', THIRD);
    expect(created).toHaveLength(0);
  });

  it('click focuses the window and opens the conversation with the other participant', () => {
    startSystemNotifications(ME);
    flushSync();
    freshDm();
    created[0].instance.onclick();
    expect(window.focus).toHaveBeenCalled();
    expect(goto).toHaveBeenCalledWith(`/c/messages?to=${OTHER}`);
  });

  it('opens the DM list for a group conversation', () => {
    startSystemNotifications(ME);
    flushSync();
    fakes.dmUnread.add('grp');
    fakes.setKnown([
      conversation({ id: 'grp', created_at: NOW + 10, participants: [ME, OTHER, THIRD] })
    ]);
    flushSync();
    created[0].instance.onclick();
    expect(goto).toHaveBeenCalledWith('/c/messages');
  });

  it('stops toasting after stop()', () => {
    startSystemNotifications(ME);
    flushSync();
    stopSystemNotifications();
    freshDm();
    expect(created).toHaveLength(0);
  });

  it('does nothing when the browser has no Notification API', () => {
    vi.stubGlobal('Notification', undefined);
    startSystemNotifications(ME);
    flushSync();
    fakes.dmUnread.add('conv-1');
    fakes.setKnown([conversation({ id: 'conv-1', created_at: NOW + 10 })]);
    flushSync();
    expect(created).toHaveLength(0);
  });
});

describe('inbox toasts', () => {
  it('does not toast for items already loaded at start (replay), only for fresh ones', () => {
    fakes.unread.add('old');
    fakes.setNotifications([inboxEvent({ id: 'old', created_at: NOW - 50 })]);
    startSystemNotifications(ME);
    flushSync();
    expect(created).toHaveLength(0);

    fakes.unread.add('fresh');
    fakes.setNotifications([
      inboxEvent({ id: 'fresh', created_at: NOW + 10 }),
      inboxEvent({ id: 'old', created_at: NOW - 50 })
    ]);
    flushSync();
    expect(created).toHaveLength(1);
    expect(created[0].options.tag).toBe('inbox');
  });

  it('collapses a burst into one toast and never includes the event content', () => {
    startSystemNotifications(ME);
    flushSync();
    fakes.unread.add('r1');
    fakes.unread.add('r2');
    fakes.setNotifications([
      inboxEvent({ id: 'r1', kind: 7, created_at: NOW + 10 }),
      inboxEvent({ id: 'r2', kind: 1111, from: THIRD, created_at: NOW + 12 })
    ]);
    flushSync();
    expect(created).toHaveLength(1);
    expect(created[0].options.body).not.toContain('+');
  });

  it('skips items that are already read', () => {
    startSystemNotifications(ME);
    flushSync();
    fakes.setNotifications([inboxEvent({ id: 'seen', created_at: NOW + 10 })]);
    flushSync();
    expect(created).toHaveLength(0);
  });

  it('stays quiet while the inbox page is visible', () => {
    startSystemNotifications(ME);
    flushSync();
    window.history.replaceState({}, '', '/c/inbox');
    fakes.unread.add('r1');
    fakes.setNotifications([inboxEvent({ id: 'r1', created_at: NOW + 10 })]);
    flushSync();
    expect(created).toHaveLength(0);
  });

  it('click opens the inbox', () => {
    startSystemNotifications(ME);
    flushSync();
    fakes.unread.add('r1');
    fakes.setNotifications([inboxEvent({ id: 'r1', created_at: NOW + 10 })]);
    flushSync();
    created[0].instance.onclick();
    expect(goto).toHaveBeenCalledWith('/c/inbox');
  });
});
