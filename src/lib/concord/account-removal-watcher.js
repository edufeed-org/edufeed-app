/**
 * Watch for accounts disappearing from the account manager (a real
 * logout/removal — `AccountManager.removeAccount()` filters `accounts$` —
 * as opposed to switching `active$` between existing accounts, which never
 * touches `accounts$`) and wipe that pubkey's local Concord data.
 *
 * Pure logic over injected dependencies so it is unit-testable without a
 * real AccountManager or ConcordClient; `client.svelte.js` wires the real
 * `manager` + `wipeConcordData` in.
 *
 * Guards:
 * - The initial BehaviorSubject replay (first emission equals the
 *   pre-subscribe snapshot from `getAccounts()`) diffs empty — no wipe.
 * - A removed account whose pubkey is still logged in under another account
 *   instance (e.g. extension + bunker for the same npub) is NOT wiped.
 *
 * @param {{
 *   getAccounts: () => { id: string, pubkey: string }[],
 *   accounts$: import('rxjs').Observable<{ id: string, pubkey: string }[]>,
 *   wipe: (pubkey: string) => Promise<void>
 * }} deps
 * @returns {import('rxjs').Subscription}
 */
export function watchAccountRemovals({ getAccounts, accounts$, wipe }) {
  let previous = getAccounts().map((a) => ({ id: a.id, pubkey: a.pubkey }));
  return accounts$.subscribe((accounts) => {
    const current = accounts.map((a) => ({ id: a.id, pubkey: a.pubkey }));
    const removed = previous.filter((prev) => !current.some((c) => c.id === prev.id));
    previous = current;
    for (const { pubkey } of removed) {
      if (current.some((c) => c.pubkey === pubkey)) continue; // still logged in under another account instance
      wipe(pubkey).catch((error) => {
        console.error('concord: failed to wipe local data on logout', error);
      });
    }
  });
}
