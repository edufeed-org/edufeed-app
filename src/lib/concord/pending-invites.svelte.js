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
    });
}

export function stopConcordPendingInvites() {
  generation += 1;
  sub?.unsubscribe();
  sub = undefined;
  pendingCount = 0;
}

/** @returns {number} reactive pending-invite count */
export function getPendingInviteCount() {
  return pendingCount;
}
