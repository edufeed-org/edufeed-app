// Reactive state for the Termi assistant's account hints — the former
// post-login info banners (backup file, NIP-65 relay list, kind 10050 DM
// relays) relocated into the chat as proactive messages. Detection and
// actions are reused from the banner era:
//
// - backup: nsec accounts created in-app without a downloaded recovery file;
//   the action opens the existing recovery-download modal, and the
//   backup-flags store confirms completion reactively.
// - relays: no kind 10002 with mailbox relays after the network loader
//   settled; the action signs + publishes the configured default list.
// - dm: dm-service's settle-aware kind 10050 self-check reports 'absent';
//   the action publishes the default DM relay list.
//
// Status semantics live in $lib/helpers/assistant-hints.js (pure, tested).
import { goto } from '$app/navigation';
import { useActiveUser, manager } from '$lib/stores/accounts.svelte';
import { pool, eventStore } from '$lib/stores/nostr-infrastructure.svelte';
import { createRelayListLoader } from '$lib/loaders/relay-list-loader.js';
import { getRelayListLookupRelays } from '$lib/services/relay-service.svelte.js';
import {
  getDefaultRelayList,
  getDefaultDmRelays,
  hasMailboxRelays
} from '$lib/helpers/relay-helper.js';
import { publishDefaultRelayList } from '$lib/services/relay-list-backfill.js';
import { ensureDmRelayList } from '$lib/services/dm-relay-backfill.js';
import { getDmRelayCheckStatus } from '$lib/services/dm-service.svelte.js';
import { modalStore } from '$lib/stores/modal.svelte.js';
import { isBackupDownloaded, isBackupDismissed } from '$lib/stores/backup-flags.svelte.js';
import { isRelayListBannerDismissed } from '$lib/stores/relay-list-flags.svelte.js';
import { isDmRelayBannerDismissed } from '$lib/stores/dm-relay-flags.svelte.js';
import { deriveHintStatus, trackEverOpen } from '$lib/helpers/assistant-hints.js';

/** @typedef {'backup' | 'relays' | 'dm'} HintId */
/** @typedef {import('$lib/helpers/assistant-hints.js').HintStatus} HintStatus */

export const HINT_IDS = /** @type {HintId[]} */ (['backup', 'relays', 'dm']);

/**
 * Reactive hook for the assistant's hints. Must be called during component
 * initialization (it registers $effects).
 *
 * @returns {{
 *   getHints: () => Array<{id: HintId, status: HintStatus}>,
 *   getOpenCount: () => number,
 *   runHint: (id: HintId) => void,
 *   customizeHint: (id: HintId) => void
 * }}
 */
export function useAssistantHints() {
  const getActiveUser = useActiveUser();

  // Relay-list presence check (same pattern as the former RelayListBanner):
  // only conclude "missing" after the loader had time to settle, so we never
  // prompt over a list we simply hadn't fetched yet. Plain $state set inside
  // subscribe callbacks — hasMailboxRelays mutates the event's Symbol cache
  // and must not run inside a $derived.
  let hasRelayList = $state(false);
  let settled = $state(false);

  $effect(() => {
    const user = getActiveUser();
    settled = false;
    hasRelayList = false;
    if (!user) return;

    const loader = createRelayListLoader(pool, getRelayListLookupRelays(), eventStore, user.pubkey);
    const loaderSub = loader()().subscribe();
    const sub = eventStore.replaceable(10002, user.pubkey).subscribe((event) => {
      hasRelayList = hasMailboxRelays(event);
    });
    const timeout = setTimeout(() => {
      settled = true;
    }, 5000);

    return () => {
      loaderSub?.unsubscribe();
      sub?.unsubscribe();
      clearTimeout(timeout);
    };
  });

  /** Hint ids whose primary action fired and awaits confirmation. */
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- $state.raw + wholesale replacement (see CLAUDE.md)
  let running = $state.raw(/** @type {Set<HintId>} */ (new Set()));
  /** Hint ids that were visible (open/doing) at some point this session. */
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- $state.raw + wholesale replacement (see CLAUDE.md)
  let everOpen = $state.raw(/** @type {Set<string>} */ (new Set()));

  const statuses = $derived.by(() => {
    const user = getActiveUser();
    if (!user) return { backup: null, relays: null, dm: null };

    const backupConfirmed = isBackupDownloaded(user.pubkey);
    // Only nudge users who created their account via the in-app wizard —
    // pre-existing nsec accounts own their backup story already.
    const backupApplicable =
      user.type === 'nsec' &&
      typeof localStorage !== 'undefined' &&
      !!localStorage.getItem(`signed-up-here:${user.pubkey}`) &&
      !backupConfirmed &&
      !isBackupDismissed(user.pubkey);

    const relaysApplicable =
      settled &&
      !hasRelayList &&
      getDefaultRelayList().length > 0 &&
      !isRelayListBannerDismissed(user.pubkey);

    const dmStatus = getDmRelayCheckStatus();
    const dmApplicable =
      dmStatus === 'absent' &&
      getDefaultDmRelays().length > 0 &&
      !isDmRelayBannerDismissed(user.pubkey);

    return {
      backup: deriveHintStatus({
        applicable: backupApplicable,
        confirmed: backupConfirmed,
        running: false, // the action opens a modal; the flags store confirms
        everOpen: everOpen.has('backup')
      }),
      relays: deriveHintStatus({
        applicable: relaysApplicable,
        confirmed: hasRelayList,
        running: running.has('relays'),
        everOpen: everOpen.has('relays')
      }),
      dm: deriveHintStatus({
        applicable: dmApplicable,
        confirmed: dmStatus === 'present',
        running: running.has('dm'),
        everOpen: everOpen.has('dm')
      })
    };
  });

  // Record visibility so a later confirmation renders as "done" only for
  // hints the user actually saw. trackEverOpen returns the same Set reference
  // when nothing changed, so this effect settles immediately.
  $effect(() => {
    everOpen = trackEverOpen(everOpen, statuses);
  });

  /** @param {HintId} id @param {boolean} on */
  function setRunning(id, on) {
    const next = new Set(running); // eslint-disable-line svelte/prefer-svelte-reactivity -- replaced wholesale below
    if (on) next.add(id);
    else next.delete(id);
    running = next;
  }

  /** @param {HintId} id */
  function runHint(id) {
    if (id === 'backup') {
      modalStore.openModal('recovery-download');
      return;
    }
    if (running.has(id)) return;
    setRunning(id, true);
    // Fire-and-forget like the banners: on success the underlying store flips
    // the confirmation reactively ('done'); on failure clearing the running
    // flag drops the hint back to 'open'.
    const action =
      id === 'relays' ? publishDefaultRelayList(manager.active?.signer) : ensureDmRelayList();
    action.catch(() => {}).then(() => setRunning(id, false));
  }

  /** @param {HintId} id */
  function customizeHint(id) {
    if (id === 'relays') goto('/settings#relay-settings');
    else if (id === 'dm') goto('/settings#dm-relay-settings');
  }

  return {
    getHints: () =>
      HINT_IDS.flatMap((id) => {
        const status = statuses[id];
        return status === null ? [] : [{ id, status }];
      }),
    getOpenCount: () =>
      HINT_IDS.filter((id) => statuses[id] === 'open' || statuses[id] === 'doing').length,
    runHint,
    customizeHint
  };
}
