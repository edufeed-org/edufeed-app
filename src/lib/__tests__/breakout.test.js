/** @vitest-environment node */
/**
 * breakout.js — the pure half of breakout rooms: balanced random split,
 * the kind-39000 marker that hides a room from every channel list, the
 * metadata a room is created with, the `edufeed.call.breakout` wire format
 * and the deadline math.
 */
import { describe, it, expect } from 'vitest';
import {
  BREAKOUT_TOPIC,
  BREAKOUT_MIN_ROOMS,
  BREAKOUT_MAX_ROOMS,
  splitRandom,
  breakoutRoomName,
  breakoutAbout,
  parseBreakoutMarker,
  isBreakoutGroup,
  breakoutRoomMetadata,
  isParentRoleRejection,
  buildBreakoutAssignPayload,
  buildBreakoutEndPayload,
  parseBreakoutPayload,
  assignedRoom,
  roomOfPubkey,
  remainingSeconds,
  formatCountdown
} from '$lib/groups/breakout.js';
import {
  buildCreateGroupTemplate,
  buildEditGroupMetadataTemplate
} from '$lib/groups/group-management.js';

/** A deterministic rng: cycles through the given values. @param {number[]} values */
function rngOf(values) {
  let i = 0;
  return () => values[i++ % values.length];
}

/** @param {string[][]} tags */
const metadata = (tags) => ({ kind: 39000, tags, content: '', created_at: 1 });

describe('splitRandom', () => {
  it('deals everyone out as evenly as possible', () => {
    const rooms = splitRandom(['a', 'b', 'c', 'd', 'e'], 2, rngOf([0.5]));
    expect(rooms).toHaveLength(2);
    expect(rooms.map((r) => r.length).sort()).toEqual([2, 3]);
    expect(rooms.flat().sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('is deterministic for an injected rng and shuffles for a different one', () => {
    const people = ['a', 'b', 'c', 'd', 'e', 'f'];
    const first = splitRandom(people, 3, rngOf([0.1, 0.9, 0.3, 0.7, 0.5]));
    const again = splitRandom(people, 3, rngOf([0.1, 0.9, 0.3, 0.7, 0.5]));
    const other = splitRandom(people, 3, rngOf([0.99, 0.01, 0.6, 0.2, 0.8]));
    expect(again).toEqual(first);
    expect(other).not.toEqual(first);
    for (const room of first) expect(room).toHaveLength(2);
  });

  it('never fabricates rooms: fewer people than rooms leaves rooms empty, not undefined', () => {
    const rooms = splitRandom(['a'], 3, rngOf([0]));
    expect(rooms).toEqual([['a'], [], []]);
  });

  it('does not mutate its input', () => {
    const people = ['c', 'a', 'b'];
    splitRandom(people, 2, rngOf([0.2, 0.8]));
    expect(people).toEqual(['c', 'a', 'b']);
  });

  it('bounds the room count', () => {
    expect(BREAKOUT_MIN_ROOMS).toBe(2);
    expect(BREAKOUT_MAX_ROOMS).toBe(8);
    expect(() => splitRandom(['a'], 1, rngOf([0]))).toThrow();
    expect(() => splitRandom(['a'], 9, rngOf([0]))).toThrow();
  });
});

describe('room marker on kind 39000', () => {
  it('names a room after its number and the channel', () => {
    expect(breakoutRoomName(2, 'Seminar A')).toBe('Breakout 2 · Seminar A');
  });

  it('round-trips parent, number and deadline through the about text', () => {
    const about = breakoutAbout({ parent: 'main-id', index: 3, until: 1700000000 });
    expect(about).toBe('edufeed:breakout parent=main-id n=3 until=1700000000');
    expect(parseBreakoutMarker(metadata([['about', about]]))).toEqual({
      parent: 'main-id',
      index: 3,
      until: 1700000000
    });
  });

  it('leaves the deadline out when there is none', () => {
    const about = breakoutAbout({ parent: 'main-id', index: 1 });
    expect(about).toBe('edufeed:breakout parent=main-id n=1');
    expect(parseBreakoutMarker(metadata([['about', about]]))).toEqual({
      parent: 'main-id',
      index: 1,
      until: null
    });
  });

  it('recognises a room only by the marker, never by its name', () => {
    expect(isBreakoutGroup(metadata([['about', 'edufeed:breakout parent=x n=1']]))).toBe(true);
    expect(isBreakoutGroup(metadata([['name', 'Breakout 1 · Seminar']]))).toBe(false);
    expect(isBreakoutGroup(metadata([['about', 'we talk about breakout rooms']]))).toBe(false);
    expect(
      isBreakoutGroup({ kind: 39002, tags: [['about', 'edufeed:breakout parent=x n=1']] })
    ).toBe(false);
    expect(isBreakoutGroup(null)).toBe(false);
    expect(parseBreakoutMarker(metadata([['about', 'edufeed:breakout n=1']]))).toBeNull();
  });
});

describe('breakoutRoomMetadata', () => {
  const base = { parentId: 'main-id', channelName: 'Seminar', index: 2, until: 1700000000 };

  it('is a hidden, closed, public AV room with the marker and the parent', () => {
    const meta = breakoutRoomMetadata({ ...base, withParent: true });
    expect(meta).toEqual({
      name: 'Breakout 2 · Seminar',
      about: 'edufeed:breakout parent=main-id n=2 until=1700000000',
      isPublic: true,
      isOpen: false,
      isHidden: true,
      livekit: true,
      parent: 'main-id'
    });
    const tags = buildCreateGroupTemplate('room-id', meta).tags;
    expect(tags[0]).toEqual(['h', 'room-id']);
    expect(tags).toContainEqual(['livekit']);
    expect(tags).toContainEqual(['hidden']);
    expect(tags).toContainEqual(['public']);
    expect(tags).toContainEqual(['closed']);
    expect(tags).toContainEqual(['parent', 'main-id']);
    expect(tags).not.toContainEqual(['private']);
  });

  it('drops the parent tag when the host has no role in the channel (relay rule)', () => {
    const meta = breakoutRoomMetadata({ ...base, withParent: false });
    expect(meta.parent).toBeUndefined();
    const tags = buildEditGroupMetadataTemplate('room-id', meta).tags;
    expect(tags.some((t) => t[0] === 'parent')).toBe(false);
    // the marker still names the parent, so lists can hide the room either way
    expect(parseBreakoutMarker(metadata(tags))?.parent).toBe('main-id');
  });

  it('classifies the pyramid parent-role rejection', () => {
    expect(
      isParentRoleRejection(new Error('restricted: must be an admin of the parent group'))
    ).toBe(true);
    expect(isParentRoleRejection(new Error('restricted: insufficient permissions'))).toBe(false);
    expect(isParentRoleRejection(null)).toBe(false);
  });
});

describe('edufeed.call.breakout payloads', () => {
  const rooms = [
    { id: 'r1', relay: 'wss://relay.example/', name: 'Breakout 1 · S', members: ['aa:1', 'bb:2'] },
    { id: 'r2', relay: 'wss://relay.example/', name: 'Breakout 2 · S', members: ['cc:3'] }
  ];

  it('has its own topic, apart from the chat and signal topics', () => {
    expect(BREAKOUT_TOPIC).toBe('edufeed.call.breakout');
    expect(BREAKOUT_TOPIC).not.toBe('edufeed.call');
    expect(BREAKOUT_TOPIC).not.toBe('edufeed.call.chat');
  });

  it('builds and parses an assignment', () => {
    const payload = buildBreakoutAssignPayload({ rooms, until: 1700000000 });
    expect(payload).toEqual({ t: 'assign', rooms, until: 1700000000 });
    expect(parseBreakoutPayload(JSON.parse(JSON.stringify(payload)))).toEqual({
      t: 'assign',
      rooms,
      until: 1700000000
    });
  });

  it('omits an absent deadline and parses it back as null', () => {
    const payload = buildBreakoutAssignPayload({ rooms });
    expect('until' in payload).toBe(false);
    expect(parseBreakoutPayload(payload)).toEqual({ t: 'assign', rooms, until: null });
    expect(parseBreakoutPayload({ ...payload, until: null })).toEqual({
      t: 'assign',
      rooms,
      until: null
    });
  });

  it('builds and parses the end signal', () => {
    expect(buildBreakoutEndPayload()).toEqual({ t: 'end' });
    expect(parseBreakoutPayload({ t: 'end' })).toEqual({ t: 'end' });
  });

  it('rejects malformed input instead of throwing', () => {
    expect(parseBreakoutPayload(null)).toBeNull();
    expect(parseBreakoutPayload('assign')).toBeNull();
    expect(parseBreakoutPayload({ t: 'nope' })).toBeNull();
    expect(parseBreakoutPayload({ t: 'assign' })).toBeNull();
    expect(parseBreakoutPayload({ t: 'assign', rooms: [{ id: 'r1' }] })).toBeNull();
    expect(
      parseBreakoutPayload({
        t: 'assign',
        rooms: [{ id: 'r1', relay: 'not a relay', name: 'x', members: [] }]
      })
    ).toBeNull();
    expect(
      parseBreakoutPayload({
        t: 'assign',
        rooms: [{ id: 'r1', relay: 'wss://relay.example', name: 'x', members: [1, 2] }]
      })
    ).toBeNull();
    expect(parseBreakoutPayload({ t: 'assign', rooms, until: 'soon' })).toBeNull();
  });

  it('finds the room a seat was assigned to', () => {
    const payload = /** @type {any} */ (parseBreakoutPayload({ t: 'assign', rooms }));
    expect(assignedRoom(payload, 'cc:3')?.id).toBe('r2');
    expect(assignedRoom(payload, 'aa:1')?.id).toBe('r1');
    expect(assignedRoom(payload, 'zz:9')).toBeNull();
  });
});

describe('following rosters', () => {
  const rooms = [
    { id: 'r1', relay: 'wss://relay.example/', name: 'Breakout 1' },
    { id: 'r2', relay: 'wss://relay.example/', name: 'Breakout 2' }
  ];

  it('finds the room whose roster names the pubkey', () => {
    const members = { r1: new Set(['aa']), r2: new Set(['bb', 'cc']) };
    expect(roomOfPubkey(rooms, members, 'cc')?.id).toBe('r2');
    expect(roomOfPubkey(rooms, members, 'aa')?.id).toBe('r1');
    expect(roomOfPubkey(rooms, members, 'zz')).toBeNull();
  });

  it('treats an unknown roster as "not there" rather than as a match', () => {
    expect(roomOfPubkey(rooms, {}, 'aa')).toBeNull();
  });
});

describe('deadline math', () => {
  it('counts down in whole seconds and never below zero', () => {
    expect(remainingSeconds(1700000100, 1700000000 * 1000)).toBe(100);
    expect(remainingSeconds(1700000100, 1700000099_400)).toBe(1);
    expect(remainingSeconds(1700000100, 1700000200 * 1000)).toBe(0);
    expect(remainingSeconds(null, 0)).toBeNull();
  });

  it('formats minutes:seconds, with hours only when needed', () => {
    expect(formatCountdown(0)).toBe('0:00');
    expect(formatCountdown(59)).toBe('0:59');
    expect(formatCountdown(600)).toBe('10:00');
    expect(formatCountdown(3661)).toBe('1:01:01');
  });
});
