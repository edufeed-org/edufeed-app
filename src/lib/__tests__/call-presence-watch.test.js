/** @vitest-environment node */
// The shared 39004 watcher, with several groups on one relay (the dashboard's
// use). The single-group behaviour is pinned by call-presence.svelte.test.js.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Subject } from 'rxjs';

/** @type {{info: Subject<any>, auth: Subject<any>, subs: Array<{filters: any[], stream: Subject<any>, closed: boolean}>}} */
const h = { info: new Subject(), auth: new Subject(), subs: [] };
const authenticateOnce = vi.fn(async () => ({ ok: true }));
vi.mock('$lib/groups/relay-auth.js', () => ({ authenticateOnce: () => authenticateOnce() }));
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  pool: {
    relay: () => ({
      information$: h.info,
      authenticated$: h.auth,
      authenticated: false,
      subscription: (/** @type {any[]} */ filters) => {
        const entry = { filters, stream: new Subject(), closed: false };
        h.subs.push(entry);
        return {
          subscribe: (/** @type {any} */ o) => {
            const sub = entry.stream.subscribe(o);
            return {
              unsubscribe: () => {
                entry.closed = true;
                sub.unsubscribe();
              }
            };
          }
        };
      }
    })
  }
}));

const { watchRelayCalls } = await import('$lib/groups/call-presence-watch.js');

const RELAY = 'wss://groups.example/';
const KEY = 'ab'.repeat(32);
const P1 = 'a'.repeat(64);
const P2 = 'b'.repeat(64);
/** @param {string} signer @param {string} id @param {string[]} people @param {number} at */
const list = (signer, id, people, at) => ({
  kind: 39004,
  pubkey: signer,
  created_at: at,
  tags: [['d', id], ...people.map((p) => ['participant', p])]
});
const last = () => h.subs[h.subs.length - 1];
const tick = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  h.info = new Subject();
  h.auth = new Subject();
  h.subs = [];
  authenticateOnce.mockClear();
});

describe('watchRelayCalls', () => {
  it('asks for all groups in one pinned request, with the extra filters, after logging in', async () => {
    const stop = watchRelayCalls(RELAY, ['g1', 'g2'], {
      getSigner: () => ({ sign: true }),
      authFirst: true,
      onParticipants: () => {},
      extraFilters: [{ kinds: [31923], '#h': ['g1', 'g2'] }]
    });
    expect(h.subs).toHaveLength(0); // nothing before the relay key is known
    h.info.next({ self: KEY });
    expect(h.subs).toHaveLength(0); // nor before the login
    await tick();
    expect(authenticateOnce).toHaveBeenCalledTimes(1);
    expect(last().filters).toEqual([
      { kinds: [39004], '#d': ['g1', 'g2'], authors: [KEY] },
      { kinds: [31923], '#h': ['g1', 'g2'] }
    ]);
    stop();
    expect(last().closed).toBe(true);
  });

  it('counts only lists the relay key signed, per group, newest wins, and hands other events on', () => {
    /** @type {Record<string, string[]>} */
    const got = {};
    /** @type {any[]} */
    const other = [];
    const stop = watchRelayCalls(RELAY, ['g1', 'g2'], {
      getSigner: () => null,
      onParticipants: (id, people) => (got[id] = people),
      onEvent: (e) => other.push(e)
    });
    h.info.next({ self: KEY });
    const s = last().stream;
    s.next(list('f'.repeat(64), 'g1', [P1], 100)); // forged: another key
    s.next(list(KEY, 'g3', [P1], 100)); // a group nobody asked about
    expect(got).toEqual({});
    s.next(list(KEY, 'g1', [P1, P2], 100));
    s.next(list(KEY, 'g2', [P2], 50));
    s.next(list(KEY, 'g1', [P1], 90)); // older copy arriving late
    expect(got).toEqual({ g1: [P1, P2], g2: [P2] });
    s.next(list(KEY, 'g1', [], 110));
    expect(got.g1).toEqual([]);
    s.next({ kind: 31923, id: 'm1' });
    expect(other).toEqual([{ kind: 31923, id: 'm1' }]);
    stop();
  });

  it('asks again once the connection is authenticated, and once more only when the key changes', () => {
    const stop = watchRelayCalls(RELAY, ['g1'], {
      getSigner: () => null,
      onParticipants: () => {}
    });
    h.info.next({ self: KEY });
    expect(h.subs).toHaveLength(1);
    h.auth.next(true);
    expect(h.subs).toHaveLength(2);
    expect(h.subs[0].closed).toBe(true);
    h.auth.next(true); // still authenticated: no flapping
    h.info.next({ self: KEY }); // same key again
    expect(h.subs).toHaveLength(2);
    h.info.next({ self: 'cd'.repeat(32) });
    expect(h.subs).toHaveLength(3);
    expect(last().filters[0].authors).toEqual(['cd'.repeat(32)]);
    stop();
  });
});
