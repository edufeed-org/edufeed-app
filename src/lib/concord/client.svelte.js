// One ConcordClient per logged-in session. Created lazily (dynamic import —
// the concord dep tree pulls @noble/hashes v2 and must never enter SSR
// chunks), torn down on logout/account switch. autoUnlock stays false: zero
// signer calls during initial sync (CORD lists unlock on user action).
import { browser } from '$app/environment';
// Pure merge helper (no package deps beyond the app's own applesauce-core) —
// safe to import statically, unlike 'applesauce-concord' itself.
import { mergeRelaySets } from './relay-sets.js';
// Cross-build pool auth shim — safe to import statically (only depends on
// rxjs, which the app already uses elsewhere). See pool-adapter.js header.
import { adaptPoolForConcord } from './pool-adapter.js';

let state = $state.raw({
  phase: /** @type {'off'|'starting'|'ready'|'error'} */ ('off'),
  client: /** @type {any} */ (undefined),
  communities: /** @type {any[]} */ ([]),
  error: /** @type {string|null} */ (null),
  // Bookkeeping for the unlockConcordLists() affordance below — NOT the
  // same thing as a list's own `.unlocked` (that's reactive, per-cast, and
  // exposed to sidebars via useConcordListLocked() in
  // unlinked-areas.svelte.js). These two just let a "Sync private areas"
  // button show a spinner and reflect whether its last run succeeded.
  unlocking: false,
  unlocked: false
});

let initialized = false;
/** @type {any} */ let currentClient;
/** @type {import('rxjs').Subscription[]} */ let clientSubs = [];
// Held reference to the notifications service module (Task 4), set once
// setup() resolves its dynamic import — teardown() is sync, so it cannot
// dynamically import the module itself; it stops the service via this
// held reference instead.
/** @type {{ start: Function, stop: Function } | undefined} */ let notificationsModule;
// Held reference to the pending-invite count service (Task 2, invite
// surfacing), same reasoning as notificationsModule above: teardown() is
// sync and cannot dynamically import the module itself.
/** @type {{ start: Function, stop: Function } | undefined} */ let pendingInvitesModule;

// Generation guard against stale async setup() resumption (final review,
// IMPORTANT). The combineLatest subscriber below is `async`, and RxJS never
// awaits an async subscriber callback before delivering the next emission —
// so `teardown(); await setup(account)` is NOT serialized: a second
// emission (logout, account switch, or even a spurious duplicate) can start
// its own teardown()+setup() while a PRIOR setup() is still suspended
// mid-await. Two failure modes without a guard:
//   1. The stale setup resumes after logout/switch and finishes installing
//      a client for the WRONG (old) account, clobbering the new one.
//   2. The stale setup's `catch` (e.g. a network error arriving late) tears
//      down state/currentClient that by then belong to the SUCCESSOR.
// Fix: bump `generation` synchronously in the subscriber before teardown(),
// capture it as `myGeneration` at setup() entry, and re-check
// `myGeneration === generation` after every `await` inside setup()
// (including at the very top of the catch, per the instructions this
// guard was written against). A stale invocation only cleans up its OWN
// locally-held client/subs (never the shared `currentClient`/`clientSubs`,
// which may already belong to a newer generation) and never rewrites
// `state`. Interleavings exercised by the accompanying unit test
// (concord-client-generation-guard.test.js): (a) a slow setup for account A
// loses the race to a fast setup for account B — B's client ends up
// installed and A's client is stopped without touching B's; (b) a stale
// rejection (A's `client.start()` throws after B has already taken over)
// does not overwrite B's phase/error state.
let generation = 0;

export function getConcordState() {
  return state;
}

export function getConcordClient() {
  return currentClient;
}

// NOTE: nip44 capability is exposed reactively as `signerHasNip44` on
// useConcordCommunity's return value (community.svelte.js) — a raw helper
// here would read the untracked `currentClient` and go stale in templates
// (the exact bug fixed in Task 8); deliberately no such helper exists.

function teardown() {
  notificationsModule?.stop();
  pendingInvitesModule?.stop();
  for (const sub of clientSubs) sub.unsubscribe();
  clientSubs = [];
  // ConcordClient exposes stop(), not dispose() — verified against
  // node_modules/applesauce-concord/dist/client/client.d.ts.
  currentClient?.stop();
  currentClient = undefined;
  state = {
    phase: 'off',
    client: undefined,
    communities: [],
    error: null,
    unlocking: false,
    unlocked: false
  };
}

/**
 * Wipe an account's local Concord data (spec §5: logout clears stores).
 * Called from the accounts$ removal watcher below (a real logout — the
 * account disappears from manager.accounts — not a mere account switch,
 * which only moves manager.active$ and never touches manager.accounts$).
 * @param {string} pubkey
 */
export async function wipeConcordData(pubkey) {
  const { runtimeConfig } = await import('$lib/stores/config.svelte.js');
  if (!runtimeConfig.concord?.enabled) return;
  const { concordDbName } = await import('./storage.js');
  const { deleteConcordDb } = await import('./idb-database.js');
  await deleteConcordDb(concordDbName(pubkey));
}

/**
 * Resolve an Observable's next (often already-buffered/synchronous) value
 * and unsubscribe. `communityList$`/`inviteList$` are switchMap chains over
 * BehaviorSubjects (see applesauce-concord's client.js), so they replay
 * their current value to a new subscriber — no need to pull in rxjs's
 * firstValueFrom for this. Declared-then-assigned per CLAUDE.md's RxJS
 * subscription ordering rule (a synchronous emission inside `subscribe()`
 * would otherwise read `sub` before it's initialized).
 * @template T
 * @param {import('rxjs').Observable<T>} observable
 * @returns {Promise<T>}
 */
function firstValue(observable) {
  return new Promise((resolve, reject) => {
    /** @type {import('rxjs').Subscription | undefined} */
    let sub;
    sub = observable.subscribe({
      next: (value) => {
        resolve(value);
        sub?.unsubscribe();
      },
      error: (error) => {
        reject(error);
        sub?.unsubscribe();
      }
    });
  });
}

/**
 * Decrypt the user's Community List (kind 13302) and Invite List (kind
 * 13303) with their signer. `autoUnlock: false` means these stay encrypted
 * after initial sync until the app calls this explicitly — there is
 * otherwise no way for a remote-only membership (created on another client,
 * synced via a CORD-05 stock relay per Fix 1 above) to ever hydrate into
 * `communities$`.
 *
 * No manual reconcile is needed after unlocking: `.unlock(signer)` caches
 * the decrypted plaintext on the event and calls `notifyEventUpdate`, which
 * makes the cast's `communities$` re-emit; the client's own internal
 * `watchLists()` subscription (wired up during `client.start()`, still live
 * here) reacts to that re-emission by merging the memberships and running
 * `reconcileCommunities()` — which updates the `communities$` BehaviorSubject
 * this module already subscribes to in `setup()`. That in turn reassigns
 * `state.communities`, so UI reading `getConcordState()` updates on its own.
 * @returns {Promise<boolean>} true on success, false on any guard failure or error
 */
export async function unlockConcordLists() {
  const client = currentClient;
  const signer = client?.signer;
  if (!client || !signer?.nip44) return false;
  state = { ...state, unlocking: true };
  try {
    const [communityList, inviteList] = await Promise.all([
      firstValue(client.communityList$),
      firstValue(client.inviteList$)
    ]);
    await Promise.all([
      communityList && !communityList.unlocked ? communityList.unlock(signer) : undefined,
      inviteList && !inviteList.unlocked ? inviteList.unlock(signer) : undefined
    ]);
    state = { ...state, unlocking: false, unlocked: true };
    return true;
  } catch (/** @type {any} */ error) {
    console.error('concord: unlock failed', error);
    state = { ...state, unlocking: false };
    return false;
  }
}

/**
 * @param {any} account
 * @param {number} myGeneration - captured from the module-level `generation`
 *   counter by the caller BEFORE this async function starts; re-checked
 *   after every await below (see the `generation` doc comment above).
 */
async function setup(account, myGeneration) {
  const { runtimeConfig } = await import('$lib/stores/config.svelte.js');
  if (myGeneration !== generation) return; // superseded while importing config
  if (!runtimeConfig.concord?.enabled) return;
  // The app's own configured relays — required (a misconfigured deployment
  // with the flag on but no relays is an error state, checked below). CORD
  // stock relays (added below, once the dynamic import resolves) are purely
  // additive on top of this.
  const relays = runtimeConfig.concord.relays;
  if (!relays?.length) {
    // Surface misconfiguration as an error state — leaving phase at 'off'
    // strands flag-gated UI (e.g. the /invite join button) on an
    // indefinite disabled spinner (Task 12 review finding).
    console.warn('concord: CONCORD_ENABLED without CONCORD_RELAYS — feature disabled');
    state = { ...state, phase: 'error', error: 'CONCORD_RELAYS is not configured' };
    return;
  }
  state = { ...state, phase: 'starting' };
  // Local to THIS invocation — never read/written by any other setup() call,
  // so a stale invocation can always clean up its own work without touching
  // whatever the shared `currentClient`/`clientSubs` module vars now hold.
  /** @type {any} */
  let client;
  /** @type {import('rxjs').Subscription[]} */
  const localSubs = [];
  try {
    const [{ ConcordClient, Helpers }, { pool }, storageModule] = await Promise.all([
      import('applesauce-concord'),
      import('$lib/stores/nostr-infrastructure.svelte'),
      import('./storage.js')
    ]);
    if (myGeneration !== generation) return; // superseded while importing deps — never build a client for a stale account
    const dbName = storageModule.concordDbName(account.pubkey);
    // Include CORD-05 §3's stock relays alongside our configured ones. The
    // package's kind-13302/13303 list sync (and invite-link fallback) reads
    // and writes these by default, and spec-compliant clients (e.g. Armada)
    // publish/expect the user's Community List there — without them, a list
    // created on another client is invisible to us (and vice versa). The
    // lists are NIP-44 self-encrypted to the owning user, so content stays
    // private even on these public relays; only list *existence*/metadata is
    // exposed, an accepted trade-off for cross-client interop. Configured
    // relays are preferred (listed first) when both sets overlap.
    const relaysWithStock = mergeRelaySets(relays, Helpers?.STOCK_RELAYS);
    client = new ConcordClient({
      signer: account.signer,
      // The app's `pool` is `applesauce-relay@^6.2.1`; applesauce-concord
      // pins its own pre-release fork of applesauce-relay as an internal
      // dependency. Beyond the type-only mismatch, the fork's Relay class
      // has REAL behavioral additions (per-pubkey isAuthenticated/NIP-42
      // tracking) that 6.2.1 lacks — adaptPoolForConcord() shims those in
      // (see pool-adapter.js) so relay-auth.js's stream-key AUTH driver
      // doesn't crash on relays that gate reads/writes behind NIP-42.
      pool: /** @type {any} */ (adaptPoolForConcord(pool)),
      relays: relaysWithStock,
      storage: storageModule.createConcordStorage(dbName),
      storeFactory: storageModule.createConcordStoreFactory(dbName),
      autoUnlock: false,
      autoSaveCommunityList: false,
      watchDirectInvites: !!account.signer?.nip44
    });
    localSubs.push(
      client.communities$.subscribe((/** @type {any[]} */ communities) => {
        if (myGeneration !== generation) return; // stale emission after a later teardown/setup
        state = { ...state, communities };
      }),
      client.phase$.subscribe((/** @type {'idle'|'starting'|'ready'|'error'} */ phase) => {
        if (myGeneration !== generation) return;
        state = { ...state, phase: phase === 'idle' ? 'starting' : phase };
      })
    );
    // No await since the last generation check above — safe to publish this
    // client as the shared one (JS is single-threaded; nothing can race in
    // between synchronous statements).
    currentClient = client;
    clientSubs = localSubs;
    state = { ...state, client };
    // Auto-unlock (rail-affordance follow-up 2026-07-28): the app already
    // performs automatic NIP-44 decryption at startup for DMs (dm-service),
    // so the private-areas list gets the same treatment instead of hiding
    // behind an unexplained lock button. One attempt, and only once a LOCKED
    // cast actually exists — users without any 13302 still see zero signer
    // calls, preserving this module's original "no signer calls during
    // initial sync" property for non-Concord users. The sidebars' manual
    // "Sync private areas" affordance stays as the fallback for a
    // failed/rejected attempt (the cast then remains locked).
    if (account.signer?.nip44) {
      let autoUnlockAttempted = false;
      clientSubs.push(
        client.communityList$.subscribe((/** @type {any} */ cast) => {
          if (myGeneration !== generation) return;
          if (autoUnlockAttempted || !cast || cast.unlocked) return;
          autoUnlockAttempted = true;
          void unlockConcordLists();
        })
      );
    }
    // Auto-read pending Direct Invites — same policy as the DM gift-wrap
    // decrypt at startup and the community-list auto-unlock above: the app
    // already performs automatic NIP-44 decryption for these, so making the
    // recipient click "Entschlüsseln" for an invite was the odd one out
    // (laoc, 2026-08-17). One attempt per wrap; the invite inbox's manual
    // button stays as the fallback for a failed/rejected attempt.
    if (account.signer?.nip44) {
      /** @type {{unsubscribe: () => void} | undefined} */
      let pendingSub;
      // eslint-disable-next-line svelte/prefer-svelte-reactivity -- plain bookkeeping, never rendered
      const attemptedWraps = new Set();
      clientSubs.push(
        client.directInviteWatcher$.subscribe((/** @type {any} */ watcher) => {
          if (myGeneration !== generation) return;
          pendingSub?.unsubscribe();
          pendingSub = watcher?.pending$?.subscribe((/** @type {any[]} */ pending) => {
            if (myGeneration !== generation) return;
            const fresh = (pending ?? []).filter((record) => {
              const key = record?.id ?? record?.wrap?.id;
              return key && !attemptedWraps.has(key);
            });
            if (fresh.length === 0) return;
            for (const record of fresh) attemptedWraps.add(record?.id ?? record?.wrap?.id);
            void Promise.resolve(watcher.readPending()).catch((/** @type {unknown} */ err) => {
              console.warn('concord: invite auto-decrypt failed', err);
            });
          });
        }),
        /** @type {any} */ ({ unsubscribe: () => pendingSub?.unsubscribe() })
      );
    }
    // Start the notifications service alongside the client (spec §2). Dynamic
    // import keeps module-load order unchanged; the service reuses the same
    // ConcordStorage the client got, so markers live in the same per-account
    // DB and are wiped together on logout.
    const notifications = await import('./notifications.svelte.js');
    if (myGeneration !== generation) return; // superseded while importing the notifications module
    notificationsModule = {
      start: notifications.startConcordNotifications,
      stop: notifications.stopConcordNotifications
    };
    await notifications.startConcordNotifications({
      client,
      storage: storageModule.createConcordStorage(dbName),
      pubkey: account.pubkey
    });
    // Start the pending-invite count service alongside notifications (Task
    // 2, invite surfacing) — same dynamic-import + held-reference pattern.
    const pendingInvites = await import('./pending-invites.svelte.js');
    if (myGeneration !== generation) return; // superseded while importing the pending-invites module
    pendingInvitesModule = {
      start: pendingInvites.startConcordPendingInvites,
      stop: pendingInvites.stopConcordPendingInvites
    };
    pendingInvites.startConcordPendingInvites({ client });
    if (myGeneration !== generation) {
      // A newer generation already ran teardown() (which called
      // notificationsModule?.stop() while it still pointed at THIS
      // invocation's service — see teardown() above) before this await
      // resumed. Do NOT call the singleton stop here (final review,
      // IMPORTANT — a prior version of this guard did, and it was a bug):
      // start/stopConcordNotifications are module-level, one service for
      // the whole session, not one per setup() invocation. By the time this
      // stale branch runs, the successor may already have started ITS OWN
      // service (its own startConcordNotifications() call begins by calling
      // stopConcordNotifications() itself) — calling stop again here would
      // kill that healthy, freshly-started service instead of this stale
      // one. teardown() already covers this invocation's cleanup; nothing
      // further is needed.
      return;
    }
    await client.start();
    if (myGeneration !== generation) {
      // A newer generation already ran teardown() (and may have installed
      // its own client) while `start()` was pending. currentClient/state
      // may already belong to that successor — clean up only THIS
      // invocation's local client/subs, never the shared module state.
      for (const sub of localSubs) sub.unsubscribe();
      client.stop();
    }
  } catch (/** @type {any} */ error) {
    if (myGeneration !== generation) return; // stale failure: the successor now owns currentClient/state — don't clobber it
    console.error('concord: client start failed', error);
    // A failed start must not leave a half-started client behind: drop the
    // subs, stop the client, and clear it so getConcordClient() returns
    // undefined. Keep phase/error (a plain teardown() would reset to 'off').
    notificationsModule?.stop();
    pendingInvitesModule?.stop();
    for (const sub of localSubs) sub.unsubscribe();
    client?.stop();
    currentClient = undefined;
    state = {
      phase: 'error',
      client: undefined,
      communities: [],
      error: String(error?.message || error),
      unlocking: false,
      unlocked: false
    };
  }
}

/** Idempotent; call once from the root layout (browser only). */
export async function initConcordService() {
  if (!browser || initialized) return;
  initialized = true;
  const [{ configReady }, { manager }, { combineLatest, Observable }] = await Promise.all([
    import('$lib/stores/config.svelte.js'),
    import('$lib/stores/accounts.svelte'),
    import('rxjs')
  ]);
  const configReady$ = new Observable((subscriber) => {
    const unsubscribe = configReady.subscribe((ready) => subscriber.next(ready));
    return () => unsubscribe();
  });
  combineLatest([configReady$, manager.active$]).subscribe(async ([ready, account]) => {
    if (!ready) return;
    // Bump BEFORE teardown()/setup() so any setup() still in flight from a
    // prior emission (this callback is async; RxJS delivers the next
    // emission without waiting for it) observes a stale generation on its
    // next re-check and bails instead of clobbering this emission's work.
    generation += 1;
    const myGeneration = generation;
    teardown();
    if (account?.signer) await setup(account, myGeneration);
  });
  // Wipe local Concord data when an account is genuinely removed (logout),
  // never on a mere active-account switch. Logic + guards live in the
  // extracted, unit-tested watcher; wipeConcordData itself no-ops unless
  // runtimeConfig.concord.enabled.
  const { watchAccountRemovals } = await import('./account-removal-watcher.js');
  watchAccountRemovals({
    getAccounts: () => manager.accounts,
    accounts$: manager.accounts$,
    wipe: wipeConcordData
  });
}
