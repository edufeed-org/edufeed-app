/** @vitest-environment node */
/**
 * breakout-relay.js — the relay round-trips of a breakout session, over a
 * mocked group-relay connection: creating a room (9007 + 9002, falling back
 * to no `parent` when the relay says the host has no role in the channel),
 * seating / unseating people (9000 / 9001) and deleting rooms (9008).
 */
import { describe, it, expect, vi } from 'vitest';
import {
  createBreakoutRoom,
  seatInRoom,
  unseatFromRoom,
  deleteBreakoutRoom
} from '$lib/groups/breakout-relay.js';

const PK = 'a'.repeat(64);
const user = {
  pubkey: PK,
  signer: { signEvent: vi.fn(async (t) => ({ ...t, id: 'id-' + t.kind, sig: 'sig' })) }
};
const METADATA_EVENT = { kind: 39000, tags: [['d', 'room-1']] };

/**
 * A relay connection that accepts everything unless `reject(event)` says
 * otherwise, and answers the 39000 confirmation request.
 * @param {(event: any) => string | null} [reject]
 */
function relayOf(reject = () => null) {
  /** @type {any[]} */
  const published = [];
  return {
    published,
    publish: vi.fn(async (event) => {
      published.push(event);
      const reason = reject(event);
      return reason ? { ok: false, message: reason } : { ok: true };
    }),
    request: vi.fn(() => ({
      pipe: () => ({
        subscribe: (/** @type {any} */ observer) => {
          observer.next?.(METADATA_EVENT);
          observer.complete?.();
          return { unsubscribe() {} };
        }
      })
    }))
  };
}

const roomArgs = {
  id: 'room-1',
  parentId: 'main',
  channelName: 'Seminar',
  index: 1,
  until: 1700000000
};

describe('createBreakoutRoom', () => {
  it('creates the room as a hidden AV child of the channel: 9007 then 9002, both with the parent', async () => {
    const relay = relayOf();
    const confirmed = await createBreakoutRoom(relay, roomArgs, user, { confirmDelayMs: 0 });
    expect(confirmed).toBe(METADATA_EVENT);
    expect(relay.published.map((e) => e.kind)).toEqual([9007, 9002]);
    for (const event of relay.published) {
      expect(event.tags[0]).toEqual(['h', 'room-1']);
      expect(event.tags).toContainEqual(['parent', 'main']);
      expect(event.tags).toContainEqual(['livekit']);
      expect(event.tags).toContainEqual(['hidden']);
      expect(event.tags).toContainEqual(['name', 'Breakout 1 · Seminar']);
      expect(event.tags).toContainEqual([
        'about',
        'edufeed:breakout parent=main n=1 until=1700000000'
      ]);
    }
  });

  it('retries the 9002 without the parent when the host has no role in the channel', async () => {
    const relay = relayOf((event) =>
      event.kind === 9002 && event.tags.some((/** @type {string[]} */ t) => t[0] === 'parent')
        ? 'restricted: must be an admin of the parent group'
        : null
    );
    await createBreakoutRoom(relay, roomArgs, user, { confirmDelayMs: 0 });
    expect(relay.published.map((e) => e.kind)).toEqual([9007, 9002, 9002]);
    const last = relay.published[2];
    expect(last.tags.some((/** @type {string[]} */ t) => t[0] === 'parent')).toBe(false);
    // the marker still names the channel
    expect(last.tags).toContainEqual([
      'about',
      'edufeed:breakout parent=main n=1 until=1700000000'
    ]);
  });

  it('surfaces every other rejection (e.g. the relay create whitelist) unchanged', async () => {
    const relay = relayOf((event) =>
      event.kind === 9007 ? 'restricted: only members of this relay can create a group' : null
    );
    await expect(createBreakoutRoom(relay, roomArgs, user, { confirmDelayMs: 0 })).rejects.toThrow(
      /only members of this relay/
    );
    expect(relay.published).toHaveLength(1);
  });
});

describe('seating', () => {
  it('seats a pubkey with a plain put-user and unseats with remove-user', async () => {
    const relay = relayOf();
    await seatInRoom(relay, 'room-1', 'b'.repeat(64), user);
    await unseatFromRoom(relay, 'room-1', 'b'.repeat(64), user);
    expect(relay.published.map((e) => e.kind)).toEqual([9000, 9001]);
    expect(relay.published[0].tags).toEqual([
      ['h', 'room-1'],
      ['p', 'b'.repeat(64)]
    ]);
    expect(relay.published[1].tags).toEqual([
      ['h', 'room-1'],
      ['p', 'b'.repeat(64)]
    ]);
  });

  it('treats "already a member" / "already left" as success (idempotent moves)', async () => {
    const relay = relayOf((event) =>
      event.kind === 9000 ? 'all targets are members already' : 'all targets have left already'
    );
    await expect(seatInRoom(relay, 'room-1', 'b'.repeat(64), user)).resolves.toBeUndefined();
    await expect(unseatFromRoom(relay, 'room-1', 'b'.repeat(64), user)).resolves.toBeUndefined();
  });
});

describe('deleteBreakoutRoom', () => {
  it('publishes a 9008 for the room', async () => {
    const relay = relayOf();
    await deleteBreakoutRoom(relay, 'room-1', user);
    expect(relay.published.map((e) => e.kind)).toEqual([9008]);
    expect(relay.published[0].tags).toEqual([['h', 'room-1']]);
  });

  it('accepts a room that is already gone', async () => {
    const relay = relayOf(() => "group 'room-1' doesn't exist");
    await expect(deleteBreakoutRoom(relay, 'room-1', user)).resolves.toBeUndefined();
  });
});
