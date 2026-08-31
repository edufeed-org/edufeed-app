// App-wide count of pending Concord invitations (spec: invite surfacing).
// Mirrors notifications.svelte.js: module-level $state, manual RxJS
// subscription OUTSIDE component context, a generation guard, started/stopped
// by client.svelte.js under the account lifecycle. Reads pending$ (locked
// wraps — no signer prompt) + invites$ (already decrypted) so the count is
// prompt-free; the only decrypt stays in InviteInboxModal.readPending().
// Imports only RxJS + the client passed in — no applesauce-concord import.
import { of, combineLatest } from 'rxjs';
import { switchMap } from 'rxjs/operators';

let pendingCount = $state(0);
/** @type {{inviter?: string, areaName?: string} | null} */
let firstInvite = $state.raw(null);
let generation = 0;
/** @type {import('rxjs').Subscription | undefined} */
let sub;

/** @param {{ client: any }} args */
export function startConcordPendingInvites({ client }) {
  stopConcordPendingInvites();
  generation += 1;
  const myGeneration = generation;
  // directInviteWatcher$ is a BehaviorSubject the client fills after start();
  // switchMap re-binds to the live watcher's streams. Optional-chained: a
  // client without the watcher (non-nip44 signer, tests) simply never ticks.
  sub = client?.directInviteWatcher$
    ?.pipe(
      switchMap((/** @type {any} */ w) =>
        combineLatest([w?.pending$ ?? of([]), w?.invites$ ?? of([])])
      )
    )
    .subscribe((/** @type {[any[], any[]]} */ [pending, invites]) => {
      if (myGeneration !== generation) return;
      pendingCount = (pending?.length ?? 0) + (invites?.length ?? 0);
      // Details exist only for DECRYPTED invites — surfaces show them when
      // available (auto-decrypt makes this the common case) and stay
      // honest-generic while everything is still locked.
      const first = invites?.[0];
      firstInvite = first
        ? {
            inviter: first.inviter,
            areaName: first.bundle?.label ?? first.bundle?.name ?? undefined
          }
        : null;
    });
}

export function stopConcordPendingInvites() {
  generation += 1;
  sub?.unsubscribe();
  sub = undefined;
  pendingCount = 0;
  firstInvite = null;
}

/** @returns {number} reactive pending-invite count */
export function getPendingInviteCount() {
  return pendingCount;
}

/** Summary of the first DECRYPTED pending invite, or null while locked/none. */
export function getFirstPendingInvite() {
  return firstInvite;
}
