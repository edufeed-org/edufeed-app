/**
 * Session flush on account switch.
 *
 * The EventStore is a session-lifetime singleton, so content fetched under
 * one account (e.g. member-only NIP-29 rooms read over an authenticated
 * relay) kept rendering after switching to an account that has no access —
 * only a full reload cleared it. This module gives an account switch the
 * same privacy semantics as a reload:
 *
 *  - every event is removed from the in-memory EventStore (models are
 *    notified through `remove$`, so open timelines drop the content);
 *  - every relay connection that sent a NIP-42 AUTH this session is closed,
 *    because the socket stays authenticated as the OLD account otherwise —
 *    a refetch under the new account would re-leak member-only content.
 *    The next use recreates the connection, which re-issues a challenge
 *    answered by the new account's signer.
 *
 * Deliberately untouched:
 *  - the DeleteManager's kind-5 knowledge (deletions are not stored as
 *    events, so removing events keeps deleted content filtered);
 *  - the IDB event cache: it only persists whitelisted public kinds and
 *    survives a reload too, so clearing it would exceed reload-parity.
 */

/**
 * Remove all events from the store and close authenticated relay
 * connections so nothing identity-scoped survives an account switch.
 *
 * @param {{ eventStore: import('applesauce-core').EventStore, pool: { relays: Map<string, any>, remove: (relay: any) => void } }} deps
 */
export function flushSessionState({ eventStore, pool }) {
  eventStore.removeByFilters({});
  for (const relay of pool.relays.values()) {
    // `authentication` is the AUTH event sent on this connection — the only
    // marker that the socket carries an identity. Anonymous connections are
    // left alone to avoid needless reconnect churn.
    if (relay.authentication) pool.remove(relay);
  }
}

/**
 * Watch the account manager's active$ stream and flush when the active
 * IDENTITY changes away from a previous logged-in account: a switch to a
 * different pubkey or a logout. The initial replay, a first login from
 * anonymous, and a same-pubkey account swap (extension -> bunker) do not
 * flush — nothing fetched before belongs to a different identity there.
 *
 * @param {{ active$: import('rxjs').Observable<{ pubkey: string } | null | undefined>, flush: () => void }} deps
 * @returns {import('rxjs').Subscription}
 */
export function watchAccountSwitches({ active$, flush }) {
  /** @type {string | null | undefined} undefined = no emission seen yet */
  let previousPubkey;
  return active$.subscribe((account) => {
    const pubkey = account?.pubkey ?? null;
    if (previousPubkey !== undefined && previousPubkey !== null && previousPubkey !== pubkey) {
      flush();
    }
    previousPubkey = pubkey;
  });
}
