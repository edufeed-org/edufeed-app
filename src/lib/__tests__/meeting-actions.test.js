// @ts-nocheck
/**
 * Deleting a channel meeting: its guest passes are revoked first, then the
 * meeting itself is deleted on the group relay — NIP-09 kind 5 by the
 * author, NIP-29 kind 9005 by a moderator.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { of } from 'rxjs';

const published = [];
const publishToGroupRelay = vi.fn(async (_relay, template, user) => {
  const event = { ...template, pubkey: user.pubkey, id: `signed-${published.length}` };
  published.push(event);
  return event;
});
vi.mock('$lib/groups/group-management.js', async (orig) => ({
  ...(await orig()),
  publishToGroupRelay: (...a) => publishToGroupRelay(...a)
}));
vi.mock('$lib/groups/relay-auth.js', async (orig) => ({
  ...(await orig()),
  authenticateOnce: async () => ({ ok: true })
}));

const { deleteMeeting } = await import('$lib/groups/meeting-actions.js');

const ME = 'a'.repeat(64);
const MOD = 'b'.repeat(64);
const GROUP = 'g1';
const RELAY = 'wss://groups.example/';
const user = (pubkey) => ({ pubkey, signer: { signEvent: async (e) => e } });
const meeting = {
  id: 'meeting-1',
  kind: 31923,
  pubkey: ME,
  tags: [
    ['d', 'meeting-abc'],
    ['h', GROUP],
    ['start', '2000000000']
  ]
};
const coordinate = `31923:${ME}:meeting-abc`;
const future = String(Math.floor(Date.now() / 1000) + 86400);
/** @param {string} id @param {string} pubkey @param {string} a */
const pass = (id, pubkey, a) => ({
  id,
  kind: 9025,
  pubkey,
  created_at: 1,
  content: '',
  tags: [
    ['h', GROUP],
    ['expiration', future],
    ['a', a, RELAY]
  ]
});

/** @param {any[]} passes */
const relayWith = (passes) => ({ url: RELAY, request: vi.fn(() => of(...passes)) });

beforeEach(() => {
  published.length = 0;
  publishToGroupRelay.mockClear();
});

describe('deleteMeeting', () => {
  it('author: revokes the meeting pass (kind 5), then deletes the meeting with a kind 5', async () => {
    const relay = relayWith([
      pass('p-mine', ME, coordinate),
      pass('p-other-meeting', ME, `31923:${ME}:other`)
    ]);
    const deletion = await deleteMeeting({ relayConn: relay, event: meeting, user: user(ME) });

    expect(published).toHaveLength(2);
    const [revoke, del] = published;
    expect(revoke.kind).toBe(5);
    expect(revoke.tags).toContainEqual(['e', 'p-mine']);
    expect(del.kind).toBe(5);
    expect(del.tags).toEqual([
      ['e', 'meeting-1'],
      ['a', coordinate],
      ['h', GROUP],
      ['k', '31923']
    ]);
    expect(deletion).toBe(del);
    for (const call of publishToGroupRelay.mock.calls) expect(call[0]).toBe(relay);
  });

  it('deletes the meeting even when it never had a guest link', async () => {
    const relay = relayWith([]);
    await deleteMeeting({ relayConn: relay, event: meeting, user: user(ME) });
    expect(published).toHaveLength(1);
    expect(published[0].tags).toContainEqual(['a', coordinate]);
  });

  it('moderator: revokes with 9005 and removes the meeting with a 9005', async () => {
    const relay = relayWith([pass('p-mine', ME, coordinate)]);
    await deleteMeeting({ relayConn: relay, event: meeting, user: user(MOD), asAdmin: true });
    expect(published.map((e) => e.kind)).toEqual([9005, 9005]);
    expect(published[0].tags).toContainEqual(['e', 'p-mine']);
    expect(published[1].tags).toEqual([
      ['h', GROUP],
      ['e', 'meeting-1']
    ]);
  });

  it('refuses a non-author without moderation rights, publishing nothing', async () => {
    const relay = relayWith([pass('p-mine', ME, coordinate)]);
    await expect(
      deleteMeeting({ relayConn: relay, event: meeting, user: user(MOD) })
    ).rejects.toThrow();
    expect(published).toHaveLength(0);
  });

  it('keeps the meeting when its pass cannot be revoked', async () => {
    const relay = relayWith([pass('p-mine', ME, coordinate)]);
    publishToGroupRelay.mockImplementationOnce(async () => {
      throw new Error('relay said no');
    });
    await expect(
      deleteMeeting({ relayConn: relay, event: meeting, user: user(ME) })
    ).rejects.toThrow('relay said no');
    expect(publishToGroupRelay).toHaveBeenCalledTimes(1);
  });
});
