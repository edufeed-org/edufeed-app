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
import {
  isBackupDownloaded,
  isBackupDismissed,
  markBackupDismissed
} from '$lib/stores/backup-flags.svelte.js';
import {
  isRelayListBannerDismissed,
  markRelayListBannerDismissed
} from '$lib/stores/relay-list-flags.svelte.js';
import {
  isDmRelayBannerDismissed,
  markDmRelayBannerDismissed
} from '$lib/stores/dm-relay-flags.svelte.js';
import {
  isNip05HintDismissed,
  markNip05HintDismissed,
  isNip05ReadyHintDismissed,
  markNip05ReadyHintDismissed
} from '$lib/stores/nip05-hint-flags.svelte.js';
import { useMembershipGrantState } from '$lib/stores/membership-grant.svelte.js';
import { actionRunner } from '$lib/stores/action-runner.svelte.js';
import { UpdateProfile } from 'applesauce-actions/actions';
import {
  isProfileHintDismissed,
  markProfileHintDismissed
} from '$lib/stores/profile-hint-flags.svelte.js';
import {
  deriveHintStatus,
  trackEverOpen,
  isProfileHintApplicable,
  deriveNip05Hint
} from '$lib/helpers/assistant-hints.js';
import { getProfileNip05s } from '$lib/helpers/nip05-verify.js';
import { runtimeConfig } from '$lib/stores/config.svelte.js';

/** @typedef {'backup' | 'relays' | 'dm' | 'nip05' | 'profile'} HintId */
/** @typedef {import('$lib/helpers/assistant-hints.js').HintStatus} HintStatus */

export const HINT_IDS = /** @type {HintId[]} */ (['backup', 'relays', 'dm', 'profile', 'nip05']);

/**
 * Reactive hook for the assistant's hints. Must be called during component
 * initialization (it registers $effects).
 *
 * @returns {{
 *   getHints: () => Array<{id: HintId, status: HintStatus, variant?: string, address?: string}>,
 *   getOpenCount: () => number,
 *   runHint: (id: HintId) => void,
 *   customizeHint: (id: HintId) => void,
 *   dismissHint: (id: HintId) => void
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

  // NIP-05 presence check: reads the user's own kind 0 (loaded app-wide for
  // the navbar) and only concludes "missing" once the profile arrived or the
  // settle timeout passed — never over a profile we simply haven't fetched.
  let profileSettled = $state(false);
  /** @type {string[]} All nip05 addresses on the profile. */
  let profileNip05s = $state.raw(/** @type {string[]} */ ([]));
  let hasProfile = $state(false);
  const hasNip05 = $derived(profileNip05s.length > 0);

  $effect(() => {
    const user = getActiveUser();
    profileSettled = false;
    profileNip05s = [];
    hasProfile = false;
    if (!user) return;

    const sub = eventStore.replaceable(0, user.pubkey).subscribe((event) => {
      if (!event) return;
      hasProfile = true;
      profileNip05s = getProfileNip05s(event);
      profileSettled = true;
    });
    const timeout = setTimeout(() => {
      profileSettled = true;
    }, 5000);

    return () => {
      sub?.unsubscribe();
      clearTimeout(timeout);
    };
  });

  // Membership handle application state (none / pending / granted) — drives
  // the nip05 hint's variant and the one-click activation.
  const grant = useMembershipGrantState();

  const nip05Meta = $derived.by(() => {
    const grantState = grant.getState();
    const address = grant.getAddress();
    const lower = address.toLowerCase();
    const activated = !!address && profileNip05s.some((a) => a.toLowerCase() === lower);
    const hasOther = profileNip05s.some((a) => a.toLowerCase() !== lower);
    const variant =
      grantState === 'granted' ? 'ready' : grantState === 'pending' ? 'pending' : 'apply';
    return { variant, address, activated, hasOther };
  });

  /** Hint ids whose primary action fired and awaits confirmation. */
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- $state.raw + wholesale replacement (see CLAUDE.md)
  let running = $state.raw(/** @type {Set<HintId>} */ (new Set()));
  /** Hint ids that were visible (open/doing) at some point this session. */
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- $state.raw + wholesale replacement (see CLAUDE.md)
  let everOpen = $state.raw(/** @type {Set<string>} */ (new Set()));
  /** Hint ids removed from the chat this session via the card's "x". */
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- $state.raw + wholesale replacement (see CLAUDE.md)
  let dismissed = $state.raw(/** @type {Set<HintId>} */ (new Set()));

  // The session-local dismissed Set must not leak across accounts: a hint
  // dismissed under account A would otherwise hide account B's open hints
  // until a reload.
  $effect(() => {
    getActiveUser();
    dismissed = new Set(); // eslint-disable-line svelte/prefer-svelte-reactivity -- $state.raw + wholesale replacement (see CLAUDE.md)
  });

  const statuses = $derived.by(() => {
    const user = getActiveUser();
    if (!user) return { backup: null, relays: null, dm: null, nip05: null, profile: null };

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

    // Only membership-enabled deployments can offer a handle to request.
    const membership = runtimeConfig.membership;
    const nip05Hint = deriveNip05Hint({
      membershipEnabled: !!membership?.enabled && !!membership?.handleDomain,
      profileSettled,
      grantState: grant.getState(),
      activated: nip05Meta.activated,
      hasNip05,
      applyDismissed: isNip05HintDismissed(user.pubkey),
      readyDismissed: isNip05ReadyHintDismissed(user.pubkey)
    });

    const dmStatus = getDmRelayCheckStatus();
    const dmApplicable =
      dmStatus === 'absent' &&
      getDefaultDmRelays().length > 0 &&
      !isDmRelayBannerDismissed(user.pubkey);

    const profileApplicable = isProfileHintApplicable({
      user,
      settled: profileSettled,
      hasProfile,
      dismissed: isProfileHintDismissed(user.pubkey),
      signupOpen: modalStore.activeModal === 'signup'
    });

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
      }),
      nip05: deriveHintStatus({
        applicable: nip05Hint.applicable,
        confirmed: nip05Hint.confirmed,
        // 'ready' publishes the profile update inline; other variants navigate.
        running: running.has('nip05'),
        everOpen: everOpen.has('nip05')
      }),
      profile: deriveHintStatus({
        applicable: profileApplicable,
        confirmed: hasProfile,
        running: false, // the action opens a modal; the kind 0 confirms reactively
        everOpen: everOpen.has('profile')
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
    if (id === 'nip05') {
      const meta = nip05Meta;
      if (meta.variant === 'ready') {
        if (meta.hasOther || !hasProfile) {
          // Another nip05 exists (settings offers replace-or-add), or there is
          // no kind 0 yet — UpdateProfile would throw without one, so hand
          // over to the settings flow instead of failing silently.
          goto('/settings');
          return;
        }
        if (running.has(id) || !meta.address) return;
        setRunning(id, true);
        // One-click activation: publish the granted address to the profile.
        // The kind 0 subscription confirms reactively ('done'); on failure
        // clearing the running flag drops the hint back to 'open'.
        actionRunner
          .run(UpdateProfile, { nip05: meta.address })
          .catch(() => {})
          .then(() => setRunning(id, false));
        return;
      }
      // 'apply' — open the application form right here. Routing to /settings
      // meant a second click on a card the user had to find first, and left
      // them unsure whether anything had happened. Submitting inside the modal
      // feeds the shared grant hook, so this hint flips to 'pending' in place.
      modalStore.openModal('membershipApply');
      return;
    }
    if (id === 'profile') {
      const user = getActiveUser();
      if (!user) return;
      // EditProfileModal creates the kind 0 when none exists (UpdateProfile).
      modalStore.openModal('profile', { profile: {}, pubkey: user.pubkey });
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

  /**
   * Remove a hint card from the chat. Open/doing hints also get their
   * per-account dismiss flag set so they stay gone across sessions; done
   * cards are session-only (they cannot reappear after a reload anyway).
   * @param {HintId} id
   */
  function dismissHint(id) {
    const user = getActiveUser();
    const status = statuses[id];
    if (user && (status === 'open' || status === 'doing')) {
      if (id === 'backup') markBackupDismissed(user.pubkey);
      else if (id === 'relays') markRelayListBannerDismissed(user.pubkey);
      else if (id === 'dm') markDmRelayBannerDismissed(user.pubkey);
      else if (id === 'nip05') {
        if (nip05Meta.variant === 'ready') markNip05ReadyHintDismissed(user.pubkey);
        else markNip05HintDismissed(user.pubkey);
      } else if (id === 'profile') markProfileHintDismissed(user.pubkey);
    }
    const next = new Set(dismissed); // eslint-disable-line svelte/prefer-svelte-reactivity -- replaced wholesale below
    next.add(id);
    dismissed = next;
  }

  return {
    getHints: () =>
      HINT_IDS.flatMap((id) => {
        const status = statuses[id];
        if (status === null || dismissed.has(id)) return [];
        /** @type {{id: HintId, status: HintStatus, variant?: string, address?: string}} */
        const entry = { id, status };
        if (id === 'nip05') {
          entry.variant = nip05Meta.variant;
          entry.address = nip05Meta.address;
        }
        return [entry];
      }),
    getOpenCount: () =>
      HINT_IDS.filter(
        (id) => !dismissed.has(id) && (statuses[id] === 'open' || statuses[id] === 'doing')
      ).length,
    runHint,
    customizeHint,
    dismissHint
  };
}
