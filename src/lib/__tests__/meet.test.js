/**
 * Meet helpers tests
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import {
  parseRoomEvent,
  getRoomCoordinate,
  isRoomActive,
  buildRoomEventTags,
  formatTimeRemaining
} from '$lib/helpers/meet.js';

/** Helper to create a minimal room event */
function makeRoomEvent(overrides = {}) {
  return {
    kind: 30312,
    pubkey: 'abc123',
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['d', 'test-room'],
      ['title', 'Test Room'],
      ['summary', 'A test room'],
      ['type', 'video'],
      ['status', 'open'],
      ['service', 'https://operator.example.com'],
      ['h', 'community123'],
      ['p', 'host456', '', 'host'],
      ['expiration', String(Math.floor(Date.now() / 1000) + 3600)]
    ],
    ...overrides
  };
}

describe('parseRoomEvent', () => {
  it('extracts all fields from tags', () => {
    const event = makeRoomEvent();
    const parsed = parseRoomEvent(event);

    expect(parsed.name).toBe('Test Room');
    expect(parsed.summary).toBe('A test room');
    expect(parsed.type).toBe('video');
    expect(parsed.status).toBe('open');
    expect(parsed.serviceUrl).toBe('https://operator.example.com');
    expect(parsed.communityPubkey).toBe('community123');
    expect(parsed.hostPubkey).toBe('host456');
    expect(parsed.expiration).toBeGreaterThan(0);
  });

  it('returns defaults for missing tags', () => {
    const event = { kind: 30312, pubkey: 'abc', tags: [['d', 'room1']] };
    const parsed = parseRoomEvent(event);

    expect(parsed.name).toBe('');
    expect(parsed.summary).toBe('');
    expect(parsed.type).toBe('video');
    expect(parsed.status).toBe('open');
    expect(parsed.serviceUrl).toBe('');
    expect(parsed.communityPubkey).toBe('');
    expect(parsed.hostPubkey).toBe('');
    expect(parsed.expiration).toBeNull();
  });

  it('preserves the original event as .event', () => {
    const event = makeRoomEvent();
    const parsed = parseRoomEvent(event);
    expect(parsed.event).toBe(event);
  });
});

describe('getRoomCoordinate', () => {
  it('returns correct coordinate string', () => {
    const event = makeRoomEvent();
    expect(getRoomCoordinate(event)).toBe('30312:abc123:test-room');
  });

  it('handles missing d-tag', () => {
    const event = { kind: 30312, pubkey: 'abc', tags: [] };
    expect(getRoomCoordinate(event)).toBe('30312:abc:');
  });
});

describe('isRoomActive', () => {
  it('returns true for open room with future expiration', () => {
    const event = makeRoomEvent();
    expect(isRoomActive(event)).toBe(true);
  });

  it('returns false for closed room', () => {
    const event = makeRoomEvent({
      tags: [
        ['d', 'room1'],
        ['status', 'closed']
      ]
    });
    expect(isRoomActive(event)).toBe(false);
  });

  it('returns false for expired room', () => {
    const event = makeRoomEvent({
      tags: [
        ['d', 'room1'],
        ['status', 'open'],
        ['expiration', String(Math.floor(Date.now() / 1000) - 3600)]
      ]
    });
    expect(isRoomActive(event)).toBe(false);
  });

  it('returns true for open room without expiration', () => {
    const event = {
      kind: 30312,
      pubkey: 'abc',
      tags: [
        ['d', 'room1'],
        ['status', 'open']
      ]
    };
    expect(isRoomActive(event)).toBe(true);
  });
});

describe('buildRoomEventTags', () => {
  it('creates correct tag array', () => {
    const tags = buildRoomEventTags({
      name: 'My Room',
      summary: 'A cool room',
      type: 'audio',
      communityPubkey: 'comm123',
      serviceUrl: 'https://op.example.com',
      duration: 3600
    });

    expect(tags).toContainEqual(['d', expect.any(String)]);
    expect(tags).toContainEqual(['title', 'My Room']);
    expect(tags).toContainEqual(['summary', 'A cool room']);
    expect(tags).toContainEqual(['type', 'audio']);
    expect(tags).toContainEqual(['status', 'open']);
    expect(tags).toContainEqual(['service', 'https://op.example.com']);
    expect(tags).toContainEqual(['h', 'comm123']);
    expect(tags).toContainEqual(['expiration', expect.any(String)]);
  });

  it('defaults to video type', () => {
    const tags = buildRoomEventTags({
      name: 'Room',
      communityPubkey: 'comm123',
      serviceUrl: 'https://op.example.com'
    });

    expect(tags).toContainEqual(['type', 'video']);
  });

  it('includes host p-tag when provided', () => {
    const tags = buildRoomEventTags({
      name: 'Room',
      communityPubkey: 'comm123',
      serviceUrl: 'https://op.example.com',
      hostPubkey: 'host456'
    });

    expect(tags).toContainEqual(['p', 'host456', '', 'host']);
  });

  it('omits expiration when no duration', () => {
    const tags = buildRoomEventTags({
      name: 'Room',
      communityPubkey: 'comm123',
      serviceUrl: 'https://op.example.com'
    });

    expect(tags.find((t) => t[0] === 'expiration')).toBeUndefined();
  });
});

describe('formatTimeRemaining', () => {
  it('returns hours and minutes for future expiration > 1 hour', () => {
    const now = Math.floor(Date.now() / 1000);
    const result = formatTimeRemaining(now + 3661); // 1h 1m 1s
    expect(result).toEqual({ hours: 1, minutes: 1 });
  });

  it('returns 0 hours and minutes for < 1 hour', () => {
    const now = Math.floor(Date.now() / 1000);
    const result = formatTimeRemaining(now + 1800); // 30 min
    expect(result).toEqual({ hours: 0, minutes: 30 });
  });

  it('returns { hours: 0, minutes: 0 } for less than 1 minute remaining', () => {
    const now = Math.floor(Date.now() / 1000);
    const result = formatTimeRemaining(now + 30); // 30 seconds
    expect(result).toEqual({ hours: 0, minutes: 0 });
  });

  it('returns null for expired timestamp', () => {
    const now = Math.floor(Date.now() / 1000);
    expect(formatTimeRemaining(now - 100)).toBeNull();
  });

  it('returns null for null input', () => {
    expect(formatTimeRemaining(null)).toBeNull();
  });

  it('returns null for undefined input', () => {
    expect(formatTimeRemaining(undefined)).toBeNull();
  });

  it('returns null for expiration equal to now', () => {
    const now = Math.floor(Date.now() / 1000);
    expect(formatTimeRemaining(now)).toBeNull();
  });

  it('handles multi-hour remaining time', () => {
    const now = Math.floor(Date.now() / 1000);
    const result = formatTimeRemaining(now + 7200 + 900); // 2h 15m
    expect(result).toEqual({ hours: 2, minutes: 15 });
  });
});
