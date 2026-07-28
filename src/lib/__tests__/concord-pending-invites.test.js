/** @vitest-environment node */
import { describe, it, expect, beforeEach } from 'vitest';
import { BehaviorSubject } from 'rxjs';
import {
  startConcordPendingInvites,
  stopConcordPendingInvites,
  getPendingInviteCount
} from '$lib/concord/pending-invites.svelte.js';

function makeClient() {
  const pending$ = new BehaviorSubject(/** @type {any[]} */ ([]));
  const invites$ = new BehaviorSubject(/** @type {any[]} */ ([]));
  const directInviteWatcher$ = new BehaviorSubject({ pending$, invites$ });
  return { directInviteWatcher$, pending$, invites$ };
}

beforeEach(() => stopConcordPendingInvites());

describe('pending-invites service', () => {
  it('counts pending + decrypted invites and updates reactively', () => {
    const c = makeClient();
    startConcordPendingInvites({ client: c });
    expect(getPendingInviteCount()).toBe(0);
    c.pending$.next([{ id: 'w1' }, { id: 'w2' }]);
    expect(getPendingInviteCount()).toBe(2);
    c.invites$.next([{ id: 'i1' }]);
    expect(getPendingInviteCount()).toBe(3);
    c.pending$.next([]);
    expect(getPendingInviteCount()).toBe(1);
  });

  it('resets to 0 on stop and ignores later emissions', () => {
    const c = makeClient();
    startConcordPendingInvites({ client: c });
    c.pending$.next([{ id: 'w1' }]);
    expect(getPendingInviteCount()).toBe(1);
    stopConcordPendingInvites();
    expect(getPendingInviteCount()).toBe(0);
    c.pending$.next([{ id: 'w2' }, { id: 'w3' }]);
    expect(getPendingInviteCount()).toBe(0); // unsubscribed
  });

  it('handles a client without a watcher (never ticks, count stays 0)', () => {
    startConcordPendingInvites({ client: {} });
    expect(getPendingInviteCount()).toBe(0);
  });
});
