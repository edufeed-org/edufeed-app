/**
 * OS-level (browser Notification API) toasts for new DMs and inbox items.
 *
 * Foreground only: the Notification API needs a running tab, there is no
 * service-worker push behind this (see the web-push initiative for that).
 * Runs OUTSIDE component context in a $effect.root, started/stopped by the
 * root layout with the account lifecycle — like inbox-service and the wave
 * toasts. It reads the DM and inbox services' reactive getters and never
 * fetches anything itself.
 *
 * What it shows is deliberately minimal — a display name and what happened,
 * never message or event content: OS notification centers persist their
 * entries, which is the wrong place for a decrypted DM.
 *
 * Suppression rules live in the shared, unit-tested shouldToast() gate
 * (helpers/system-notifications.js); the Concord channel toasts use the same
 * gate and the same global opt-in (appSettings.systemNotificationsEnabled).
 */
import { untrack } from 'svelte';
import { goto } from '$app/navigation';
import { resolve } from '$app/paths';
import { getProfileContent } from 'applesauce-core/helpers';
import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
import { appSettings } from '$lib/stores/app-settings.svelte.js';
import {
  getKnownDmConversations,
  isDmConversationUnread
} from '$lib/services/dm-service.svelte.js';
import { getNotifications, isNotificationUnread } from '$lib/services/inbox-service.svelte.js';
import { getNotificationType } from '$lib/helpers/inbox.js';
import { getUserDisplayName } from '$lib/helpers/message-utils.js';
import {
  shouldToast,
  notificationsSupported,
  surfaceForPath
} from '$lib/helpers/system-notifications.js';
import * as m from '$lib/paraglide/messages';

/** @type {(() => void) | undefined} */
let destroyRoot;
let myPubkey = '';
/** Service start in unix seconds — the cache-replay guard. */
let startTime = 0;
/**
 * Newest lastMessage / notification created_at already inspected, per
 * source. An emission only ever yields candidates newer than this, so a
 * re-emission of unchanged data (or the same item arriving via a second
 * relay) never re-toasts.
 */
let dmHighWater = 0;
let inboxHighWater = 0;
/** Notification tag → Date.now() of the last toast (throttle). */
// eslint-disable-next-line svelte/prefer-svelte-reactivity -- internal throttle bookkeeping, not reactive state
let lastToastAt = new Map();

/** @param {string} pubkey */
function displayNameFor(pubkey) {
  let profile;
  try {
    const event = eventStore.getReplaceable(0, pubkey);
    profile = event ? getProfileContent(event) : undefined;
  } catch {
    profile = undefined;
  }
  return getUserDisplayName(pubkey, profile);
}

/**
 * Common gate for both sources. `surface` is the page the item lands on —
 * a visible tab already showing it gets the badge, not a toast.
 * @param {{createdAt: number, tag: string, surface: 'dm' | 'inbox'}} args
 */
function gate({ createdAt, tag, surface }) {
  const now = Date.now();
  const fire = shouldToast({
    createdAt,
    enabled: appSettings.systemNotificationsEnabled,
    permissionGranted: Notification.permission === 'granted',
    tabVisible: document.visibilityState === 'visible',
    isActiveChannel: surfaceForPath(window.location.pathname) === surface,
    marker: 0, // read state is checked per source before we get here
    startTime,
    lastToastAt: lastToastAt.get(tag) ?? 0,
    now
  });
  if (fire) lastToastAt.set(tag, now);
  return fire;
}

/**
 * @param {string} title @param {string} body @param {string} tag
 * @param {string} href resolved app path to open on click
 */
function show(title, body, tag, href) {
  const notification = new Notification(title, { body, tag });
  notification.onclick = () => {
    window.focus();
    goto(href);
  };
}

/** @param {Array<{id: string, participants: string[], lastMessage: any}>} known */
function onDms(known) {
  const previous = dmHighWater;
  for (const conv of known) {
    const createdAt = conv.lastMessage?.created_at ?? 0;
    if (createdAt > dmHighWater) dmHighWater = createdAt;
  }
  const fresh = known
    .filter((conv) => {
      const last = conv.lastMessage;
      return last && last.created_at > previous && last.pubkey && last.pubkey !== myPubkey;
    })
    .sort((a, b) => a.lastMessage.created_at - b.lastMessage.created_at);
  for (const conv of fresh) {
    if (!isDmConversationUnread(conv.id, conv.lastMessage.created_at)) continue;
    const tag = `dm-${conv.id}`;
    if (!gate({ createdAt: conv.lastMessage.created_at, tag, surface: 'dm' })) continue;
    const others = conv.participants.filter((p) => p !== myPubkey);
    const href =
      others.length === 1 ? resolve(`/c/messages?to=${others[0]}`) : resolve('/c/messages');
    show(displayNameFor(conv.lastMessage.pubkey), m.inbox_action_dm(), tag, href);
  }
}

/** @param {import('nostr-tools').NostrEvent} event */
function describeInboxEvent(event) {
  switch (getNotificationType(event)) {
    case 'reaction':
      return m.system_notif_reaction();
    case 'comment':
      return m.system_notif_comment();
    case 'reply':
      return m.inbox_action_reply();
    case 'mention':
      return m.system_notif_mention();
    case 'wave':
      return m.inbox_action_wave();
    case 'rsvp':
      return m.system_notif_rsvp();
    case 'pollVote':
      return m.inbox_action_poll_vote();
    case 'groupAdded':
      return m.system_notif_group_added();
    case 'formRequest':
      return m.system_notif_form_request();
    case 'formResponse':
      return m.system_notif_form_response();
    default:
      return m.system_notif_generic();
  }
}

/** @param {import('nostr-tools').NostrEvent[]} items */
function onInbox(items) {
  const previous = inboxHighWater;
  for (const event of items) {
    if (event.created_at > inboxHighWater) inboxHighWater = event.created_at;
  }
  const fresh = items.filter(
    (event) =>
      event.created_at > previous && event.pubkey !== myPubkey && isNotificationUnread(event)
  );
  if (fresh.length === 0) return;
  const newest = fresh.reduce((a, b) => (b.created_at > a.created_at ? b : a));
  // One collapsing tag for the whole inbox: a burst becomes a single toast
  // that the next one replaces, instead of a stack of OS entries.
  if (!gate({ createdAt: newest.created_at, tag: 'inbox', surface: 'inbox' })) return;
  const href = resolve('/c/inbox');
  if (fresh.length === 1) {
    show(displayNameFor(newest.pubkey), describeInboxEvent(newest), 'inbox', href);
  } else {
    show(m.inbox_bell_label(), m.system_notif_inbox_many({ count: fresh.length }), 'inbox', href);
  }
}

/**
 * Start watching for the account. Idempotent per start/stop cycle; the root
 * layout calls it on login and stopSystemNotifications() on logout.
 * @param {string} pubkey
 */
export function startSystemNotifications(pubkey) {
  stopSystemNotifications();
  if (!notificationsSupported()) return;
  myPubkey = pubkey;
  startTime = Math.floor(Date.now() / 1000);
  destroyRoot = $effect.root(() => {
    // The getters are the only reactive reads; everything the handlers touch
    // (settings, location, profiles) is untracked so a settings toggle or a
    // profile arriving never re-runs the scan — only new data does.
    $effect(() => {
      const known = getKnownDmConversations();
      untrack(() => onDms(known ?? []));
    });
    $effect(() => {
      const items = getNotifications();
      untrack(() => onInbox(items ?? []));
    });
  });
}

export function stopSystemNotifications() {
  destroyRoot?.();
  destroyRoot = undefined;
  myPubkey = '';
  startTime = 0;
  dmHighWater = 0;
  inboxHighWater = 0;
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- internal throttle bookkeeping, not reactive state
  lastToastAt = new Map();
}
