/** @vitest-environment node */
// A participant tile's "Privat schreiben" preselects the call chat's
// recipient; the panel takes the request when it is (or gets) on screen.
import { describe, it, expect, beforeEach } from 'vitest';
import {
  getCallChatCompose,
  requestPrivateRecipient,
  takePrivateRecipient,
  resetCallChatCompose
} from '$lib/groups/call-chat-compose.svelte.js';

const compose = getCallChatCompose();
beforeEach(() => resetCallChatCompose());

describe('call chat compose requests', () => {
  it('holds the requested recipient until the panel takes it', () => {
    expect(compose.recipient).toBeNull();
    requestPrivateRecipient('b'.repeat(64) + ':1');
    expect(compose.recipient).toBe('b'.repeat(64) + ':1');
    expect(takePrivateRecipient()).toBe('b'.repeat(64) + ':1');
    expect(compose.recipient).toBeNull();
    expect(takePrivateRecipient()).toBeNull();
  });

  it('a later request replaces an earlier one; reset clears', () => {
    requestPrivateRecipient('a');
    requestPrivateRecipient('b');
    expect(compose.recipient).toBe('b');
    resetCallChatCompose();
    expect(compose.recipient).toBeNull();
  });
});
