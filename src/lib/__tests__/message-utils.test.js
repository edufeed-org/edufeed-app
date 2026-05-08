/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import {
  formatMessageTimestamp,
  getUserDisplayName,
  getReplyParentId,
  groupMessagesByDate
} from '$lib/helpers/message-utils.js';

describe('formatMessageTimestamp', () => {
  it('returns "now" for timestamps less than 60 seconds ago', () => {
    const now = Math.floor(Date.now() / 1000);
    expect(formatMessageTimestamp(now)).toBe('now');
    expect(formatMessageTimestamp(now - 30)).toBe('now');
  });

  it('returns minutes for timestamps less than 1 hour ago', () => {
    const now = Math.floor(Date.now() / 1000);
    expect(formatMessageTimestamp(now - 120)).toBe('2m');
    expect(formatMessageTimestamp(now - 3540)).toBe('59m');
  });

  it('returns hours for timestamps less than 24 hours ago', () => {
    const now = Math.floor(Date.now() / 1000);
    expect(formatMessageTimestamp(now - 7200)).toBe('2h');
    expect(formatMessageTimestamp(now - 82800)).toBe('23h');
  });

  it('returns a date string for timestamps older than 24 hours', () => {
    const twoDaysAgo = Math.floor(Date.now() / 1000) - 172800;
    const result = formatMessageTimestamp(twoDaysAgo);
    // Should be a non-empty date string, not a relative time
    expect(result).toBeTruthy();
    expect(result).not.toMatch(/^\d+[mh]$/);
    expect(result).not.toBe('now');
  });
});

describe('getUserDisplayName', () => {
  it('returns display_name when available', () => {
    const profile = { display_name: 'Alice', name: 'alice' };
    expect(getUserDisplayName('abc123', profile)).toBe('Alice');
  });

  it('returns name when display_name is missing', () => {
    const profile = { name: 'alice' };
    expect(getUserDisplayName('abc123', profile)).toBe('alice');
  });

  it('returns truncated pubkey when profile has no name', () => {
    const profile = {};
    expect(getUserDisplayName('abcdef1234567890', profile)).toBe('abcdef12...');
  });

  it('returns truncated pubkey when profile is null', () => {
    expect(getUserDisplayName('abcdef1234567890', null)).toBe('abcdef12...');
  });

  it('returns "Unknown" when pubkey is empty', () => {
    expect(getUserDisplayName('', null)).toBe('Unknown');
  });
});

describe('getReplyParentId', () => {
  it('returns event ID from NIP-10 reply marker', () => {
    const message = {
      tags: [
        ['p', 'somepubkey'],
        ['e', 'parent123', '', 'reply']
      ]
    };
    expect(getReplyParentId(message)).toBe('parent123');
  });

  it('returns null when no reply tag exists', () => {
    const message = {
      tags: [['p', 'somepubkey']]
    };
    expect(getReplyParentId(message)).toBeNull();
  });

  it('returns null when tags are missing', () => {
    expect(getReplyParentId({})).toBeNull();
    expect(getReplyParentId({ tags: [] })).toBeNull();
  });
});

describe('groupMessagesByDate', () => {
  it('groups messages with date separators', () => {
    const now = Math.floor(Date.now() / 1000);
    const messages = [
      { id: '1', created_at: now - 86400 * 2, content: 'old' },
      { id: '2', created_at: now - 86400 * 2 + 60, content: 'old2' },
      { id: '3', created_at: now, content: 'new' }
    ];

    const result = groupMessagesByDate(messages);

    // Should have at least 2 separators (2 different days) + 3 messages = 5 items
    expect(result.length).toBeGreaterThanOrEqual(5);

    // First item should be a date separator
    expect(result[0].type).toBe('separator');

    // Messages from the same day should share one separator
    const separators = result.filter((item) => item.type === 'separator');
    expect(separators.length).toBeGreaterThanOrEqual(2);
  });

  it('returns empty array for empty input', () => {
    expect(groupMessagesByDate([])).toEqual([]);
  });

  it('preserves message order', () => {
    const now = Math.floor(Date.now() / 1000);
    const messages = [
      { id: '1', created_at: now - 60, content: 'first' },
      { id: '2', created_at: now, content: 'second' }
    ];

    const result = groupMessagesByDate(messages);
    const messageItems = result.filter((item) => item.type === 'message');
    expect(messageItems[0].message.id).toBe('1');
    expect(messageItems[1].message.id).toBe('2');
  });
});
