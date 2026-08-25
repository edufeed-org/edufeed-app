/** @vitest-environment node */
import { describe, it, expect, vi } from 'vitest';
import { Subject } from 'rxjs';
import { createGroupSync } from '../group-sync.js';
import { buildStateTemplate, buildRealtimeTemplate } from '../session-events.js';

const GROUP = 'deadbeef00000000';
const SID = 'session-uuid-1';

function makeRelay() {
  const subjects = [];
  return {
    subjects,
    subscription: vi.fn(() => {
      const s = new Subject();
      subjects.push(s);
      return s.asObservable();
    })
  };
}
const stateEv = (id, created_at, payload) => ({
  ...buildStateTemplate(GROUP, SID, payload),
  id,
  created_at
});

describe('createGroupSync', () => {
  it('freezes backfill sorted by created_at, then appends live in arrival order', async () => {
    const relay = makeRelay();
    let seq = 0;
    const publish = vi.fn(async (t) => ({ ...t, id: `own${++seq}` }));
    const sync = createGroupSync({ relayConn: relay, groupId: GROUP, sessionId: SID, publish });
    const notified = vi.fn();
    sync.subscribe(notified);

    const s = relay.subjects[0];
    s.next(stateEv('b', 200, 2)); // out of order on purpose
    s.next(stateEv('a', 100, 1));
    expect(sync.getUpdates()).toEqual([]); // nothing before EOSE
    s.next('EOSE');
    expect(sync.getUpdates().map((u) => u.payload)).toEqual([1, 2]);
    expect(notified).toHaveBeenCalledTimes(1);

    s.next(stateEv('c', 150, 3)); // older timestamp, arrives late → APPENDED
    expect(sync.getUpdates().map((u) => u.payload)).toEqual([1, 2, 3]);
    s.next(stateEv('c', 150, 3)); // duplicate id ignored
    expect(sync.getUpdates()).toHaveLength(3);
  });

  it('sendState publishes and appends optimistically, deduped against echo', async () => {
    const relay = makeRelay();
    const publish = vi.fn(async (t) => ({ ...t, id: 'own1' }));
    const sync = createGroupSync({ relayConn: relay, groupId: GROUP, sessionId: SID, publish });
    relay.subjects[0].next('EOSE');
    sync.sendState({ x: 1 }, { info: 'hi' });
    await vi.waitFor(() => expect(sync.getUpdates()).toHaveLength(1));
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 9450, tags: expect.arrayContaining([['i', SID]]) })
    );
    relay.subjects[0].next({ ...publish.mock.results[0].value, id: 'own1', kind: 9450 });
    await Promise.resolve();
    expect(sync.getUpdates()).toHaveLength(1); // echo deduped
  });

  it('reports publish failures via onError', async () => {
    const relay = makeRelay();
    const onError = vi.fn();
    const publish = vi.fn(async () => {
      throw new Error('restricted: not a member');
    });
    const sync = createGroupSync({
      relayConn: relay,
      groupId: GROUP,
      sessionId: SID,
      publish,
      onError
    });
    relay.subjects[0].next('EOSE');
    sync.sendState({ x: 1 });
    await vi.waitFor(() => expect(onError).toHaveBeenCalled());
    expect(sync.getUpdates()).toHaveLength(0);
  });

  it('realtime: lazy 24450 subscription, own frames skipped', async () => {
    const relay = makeRelay();
    let seq = 0;
    const publish = vi.fn(async (t) => ({ ...t, id: `rt${++seq}` }));
    const sync = createGroupSync({ relayConn: relay, groupId: GROUP, sessionId: SID, publish });
    relay.subjects[0].next('EOSE');
    expect(relay.subjects).toHaveLength(1); // no realtime sub yet

    const frames = [];
    const off = sync.onRealtime((bytes) => frames.push([...bytes]));
    expect(relay.subjects).toHaveLength(2);
    sync.sendRealtime(Uint8Array.from([7]));
    await vi.waitFor(() => expect(publish).toHaveBeenCalled());
    relay.subjects[1].next({
      ...buildRealtimeTemplate(GROUP, SID, Uint8Array.from([7])),
      id: 'rt1'
    });
    relay.subjects[1].next({
      ...buildRealtimeTemplate(GROUP, SID, Uint8Array.from([9])),
      id: 'peer'
    });
    expect(frames).toEqual([[9]]); // own echo (id rt1) skipped
    off();
  });
});
