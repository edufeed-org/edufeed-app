/**
 * Waiting on a remote signer (NIP-46 bunker, NIP-07 extension).
 *
 * A phone in energy saver mode holds a bunker's requests back, so a
 * signature can take minutes or never come (laoc, 2026-10-03: a call stuck
 * on "Requesting access…"). No browser API exposes the power-saving state,
 * so the app reacts to slowness instead: a hint after a few seconds, and a
 * typed timeout error the UI can explain.
 */
import { showToast } from '$lib/helpers/toast.js';
import * as m from '$lib/paraglide/messages';

/** A signer that did not answer within its time bound. */
export class SignerTimeoutError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'SignerTimeoutError';
  }
}

/**
 * Reject `promise` if it has not settled within `ms`, clearing the timer either way.
 * @template T
 * @param {Promise<T>} promise
 * @param {number} ms
 * @param {string} label
 * @returns {Promise<T>}
 */
export function rejectAfter(promise, ms, label) {
  /** @type {ReturnType<typeof setTimeout>} */
  let timer;
  const timeout = new Promise((_resolve, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new SignerTimeoutError(
            `${label} timed out after ${ms / 1000}s — the signer did not respond`
          )
        ),
      ms
    );
  });
  return Promise.race([promise, /** @type {Promise<T>} */ (timeout)]).finally(() =>
    clearTimeout(timer)
  );
}

/**
 * Call `onSlow` once if `promise` is still pending after `ms`.
 * @param {Promise<unknown>} promise
 * @param {number} ms
 * @param {() => void} onSlow
 */
export function notifyWhenSlow(promise, ms, onSlow) {
  const timer = setTimeout(onSlow, ms);
  const clear = () => clearTimeout(timer);
  promise.then(clear, clear);
}

/**
 * Phone or tablet — where "open your signing app" means switching apps and
 * energy saver mode is the usual reason a bunker goes quiet.
 * @param {any} [nav]
 * @returns {boolean}
 */
export function isLikelyMobile(nav = globalThis.navigator) {
  if (!nav) return false;
  if (typeof nav.userAgentData?.mobile === 'boolean') return nav.userAgentData.mobile;
  const ua = String(nav.userAgent ?? '');
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(ua)) return true;
  // iPadOS asks for desktop sites with a Mac UA; only the touch points tell.
  return /Macintosh/.test(ua) && (nav.maxTouchPoints ?? 0) > 1;
}

/** @param {boolean} mobile */
export function slowSignHintText(mobile) {
  return mobile ? m.signer_slow_hint_mobile() : m.signer_slow_hint();
}

/** @param {boolean} mobile */
export function signerTimeoutText(mobile) {
  return mobile ? m.signer_timeout_hint_mobile() : m.signer_timeout_hint();
}

/** After this long the "open your signing app" hint appears. */
export const SLOW_SIGN_HINT_MS = 8_000;
const SLOW_HINT_TOAST_MS = 10_000;
// Several requests waiting at once (a publish fanning out) show one hint.
const SLOW_HINT_COOLDOWN_MS = 30_000;
let lastSlowHintAt = -Infinity;

/** Default `onSlow`: one toast per cooldown window. */
export function showSlowSignHint() {
  const now = Date.now();
  if (now - lastSlowHintAt < SLOW_HINT_COOLDOWN_MS) return;
  lastSlowHintAt = now;
  showToast(slowSignHintText(isLikelyMobile()), 'info', SLOW_HINT_TOAST_MS);
}
