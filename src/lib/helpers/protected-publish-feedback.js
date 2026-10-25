/**
 * Tell the author where a NIP-70 protected event ended up.
 *
 * Protected events go only to relays that advertise NIP-42 + NIP-70 and
 * accept the author's AUTH (publish-service.js), which is usually a much
 * smaller set than a normal publish — so "published" alone would oversell
 * it. Takes the publish service's status shape (optimistic `onStatusChange`
 * updates, or a hand-built final status from an awaited `publishEvent`).
 */
import { showToast } from '$lib/helpers/toast.js';
import * as m from '$lib/paraglide/messages';

const TOAST_MS = 6000;

/**
 * "relay.edufeed.org, amb-relay.edufeed.org" from relay URLs.
 * @param {string[]} urls
 * @returns {string}
 */
export function relayHostList(urls) {
  const hosts = (urls ?? []).map((url) => {
    try {
      return new URL(url).host;
    } catch {
      return url;
    }
  });
  return [...new Set(hosts)].join(', ');
}

/**
 * @param {{ status?: string, done?: boolean, acceptedRelays?: string[], totalRelays?: number }} status
 */
export function announceProtectedPublish(status) {
  if (!status?.done) return;
  const accepted = status.acceptedRelays ?? [];
  if (accepted.length > 0) {
    showToast(
      m.protected_publish_accepted({ relays: relayHostList(accepted) }),
      'success',
      TOAST_MS
    );
  } else if (!status.totalRelays) {
    showToast(m.protected_publish_no_relays(), 'error', TOAST_MS);
  } else {
    showToast(m.protected_publish_failed(), 'error', TOAST_MS);
  }
}
