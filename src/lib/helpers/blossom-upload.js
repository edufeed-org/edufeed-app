/**
 * Blossom upload with server fallback.
 *
 * The deployment's own Blossom server is closed to eligible accounts
 * (blossom-server `requirePubkeyInRule`): a refused uploader gets a 401/403
 * whose X-Reason the SDK surfaces as `HTTPError.message`. The app predicts
 * eligibility (blossom-eligibility store) so that case is rare, but the
 * server is the authority — when it refuses, the file goes to the next server
 * in the account's list and finally to a public server, and the user learns
 * where it went. Any other failure (413, 5xx, network) is rethrown untouched:
 * only an authorization refusal is a reason to try elsewhere. A refusal by
 * the deployment server is NOT taken as an eligibility verdict (a 401 can be
 * clock skew or an expired bunker-signed auth event just as well); it
 * triggers a fresh probe of the policy instead.
 */
import { BlossomClient } from 'blossom-client-sdk';
import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
import {
  getBlossomUploadServers,
  getPublicBlossomServers,
  isDefaultBlossomServer
} from '$lib/services/blossom-settings-service.js';
import { refreshBlossomEligibility } from '$lib/stores/blossom-eligibility.svelte.js';
import { goto } from '$app/navigation';
import { resolve } from '$app/paths';
import { uniqueBlossomServers } from '$lib/helpers/blossom-server-key.js';
import { showToast } from '$lib/helpers/toast.js';
import * as m from '$lib/paraglide/messages';

/** Max servers tried for one file: the chosen one, its runner-up, a public one. */
const MAX_ATTEMPTS = 3;

/**
 * Was this upload refused for lack of authorization (as opposed to failing)?
 * blossom-client-sdk throws `HTTPError` with `.status`; duck-typed so mocks
 * and other fetch wrappers qualify too.
 * @param {unknown} err
 */
export function isBlossomAuthDenied(err) {
  const e = /** @type {any} */ (err);
  const status = typeof e?.status === 'number' ? e.status : e?.response?.status;
  return status === 401 || status === 403;
}

/**
 * @param {string | null | undefined} url
 */
function hostOf(url) {
  try {
    return new URL(/** @type {string} */ (url)).host;
  } catch {
    return String(url ?? '');
  }
}

/**
 * Upload `file`, trying the account's servers in order and falling back on an
 * authorization refusal.
 *
 * @param {File | Blob} file
 * @param {{
 *   signer: { signEvent: (template: any) => Promise<any> },
 *   userPubkey: string,
 *   servers?: string[],   // explicit candidate list (defaults to getBlossomUploadServers)
 *   silent?: boolean      // suppress the "uploaded elsewhere" toast
 * }} opts
 * @returns {Promise<{ blob: any, serverUrl: string, fellBackFrom: string | null, reason: string | null }>}
 */
export async function uploadWithFallback(file, { signer, userPubkey, servers, silent = false }) {
  const signerFn = async (/** @type {any} */ template) => signer.signEvent(template);
  const ordered = servers ?? getBlossomUploadServers(userPubkey, eventStore);
  const candidates = uniqueBlossomServers([ordered[0], ordered[1], getPublicBlossomServers()[0]]);
  if (candidates.length === 0) throw new Error('No Blossom server configured');

  /** @type {unknown} */
  let lastError;
  /** @type {string | null} */
  let fellBackFrom = null;
  /** @type {string | null} */
  let reason = null;

  for (const serverUrl of candidates.slice(0, MAX_ATTEMPTS)) {
    try {
      const client = new BlossomClient(serverUrl, signerFn);
      const blob = await client.uploadBlob(file);
      if (fellBackFrom && !silent) {
        showToast(m.blossom_fallback_toast({ host: hostOf(serverUrl) }), 'warning', 8000, {
          // An action, not a link: showToast's link opens a new tab (meant for external URLs).
          action: {
            label: m.blossom_fallback_toast_link(),
            onClick: () => goto(resolve(/** @type {any} */ ('/settings#blossom-settings')))
          }
        });
      }
      return { blob, serverUrl, fellBackFrom, reason };
    } catch (err) {
      if (!isBlossomAuthDenied(err)) throw err;
      lastError = err;
      fellBackFrom ??= serverUrl;
      reason = /** @type {any} */ (err)?.message || reason;
      // The deployment server refused this account: ask the policy again
      // (cache bypass) rather than guessing from the status code.
      if (isDefaultBlossomServer(serverUrl)) {
        refreshBlossomEligibility(userPubkey, { refresh: true }).catch(() => {});
      }
    }
  }
  throw lastError;
}
