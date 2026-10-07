/** @vitest-environment node */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  getCallChatUnread,
  noteCallChatReceived,
  registerCallChatView,
  resetCallChatUnread
} from '$lib/groups/call-chat-unread.svelte.js';

const unread = getCallChatUnread();

beforeEach(() => {
  resetCallChatUnread();
});

describe('call chat unread marker', () => {
  it('counts messages from others that arrive while no chat is on screen', () => {
    expect(unread.count).toBe(0);
    noteCallChatReceived();
    noteCallChatReceived();
    expect(unread.count).toBe(2);
  });

  it('putting the chat on screen marks everything seen', () => {
    noteCallChatReceived();
    const off = registerCallChatView();
    expect(unread.count).toBe(0);
    off();
    expect(unread.count).toBe(0);
  });

  it('messages arriving while the chat is on screen are seen as they come', () => {
    const off = registerCallChatView();
    noteCallChatReceived();
    expect(unread.count).toBe(0);
    off();
    noteCallChatReceived();
    expect(unread.count).toBe(1);
  });

  it('stays seen while ANY view is on screen, and unregister is idempotent', () => {
    const a = registerCallChatView();
    const b = registerCallChatView();
    a();
    a();
    noteCallChatReceived();
    expect(unread.count).toBe(0);
    b();
    noteCallChatReceived();
    expect(unread.count).toBe(1);
  });

  it('a new call starts clean', () => {
    noteCallChatReceived();
    resetCallChatUnread();
    expect(unread.count).toBe(0);
  });
});
