// @ts-nocheck
/**
 * Resource-wizard draft persistence.
 *
 * One slot per `variantId` in the supplied storage (defaults to
 * `globalThis.localStorage`). Designed for the create flow only — edit
 * flows opt out by simply not calling these functions.
 *
 * All functions are tolerant of:
 *   • missing storage (SSR / no `window`)
 *   • write failures (quota exceeded, private mode)
 *   • corrupted JSON (returns null on read)
 *
 * Pure helper; safe to call from `$effect` and component lifecycle.
 */

const STORAGE_KEY_PREFIX = 'comcal.resourceDraft.';

/**
 * @param {string} variantId
 * @returns {string}
 */
function keyFor(variantId) {
  return `${STORAGE_KEY_PREFIX}${variantId}`;
}

/**
 * @returns {Storage | undefined}
 */
function defaultStorage() {
  if (typeof globalThis !== 'undefined' && globalThis.localStorage) {
    return globalThis.localStorage;
  }
  return undefined;
}

/**
 * Load a previously-saved draft for the given variant.
 *
 * The `extras` object carries wizard state that lives outside `formData`
 * (e.g. per-vocab subject selections, target communities, the "no URL"
 * toggle). Legacy drafts written before extras existed load as `extras: {}`.
 *
 * @param {string} variantId
 * @param {Storage | undefined} [storage]
 * @returns {{ formData: any, extras: any, savedAt: number } | null}
 */
export function loadDraft(variantId, storage = defaultStorage()) {
  if (!storage) return null;
  let raw;
  try {
    raw = storage.getItem(keyFor(variantId));
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !parsed.formData) return null;
    return {
      formData: parsed.formData,
      extras: parsed.extras && typeof parsed.extras === 'object' ? parsed.extras : {},
      savedAt: typeof parsed.savedAt === 'number' ? parsed.savedAt : 0
    };
  } catch {
    return null;
  }
}

/**
 * Persist a draft for the given variant. Silently no-ops on failure.
 *
 * @param {string} variantId
 * @param {any} formData
 * @param {any} [extras] wizard state stored outside formData (defaults to {})
 * @param {Storage | undefined} [storage]
 * @returns {void}
 */
export function saveDraft(variantId, formData, extras = {}, storage = defaultStorage()) {
  if (!storage) return;
  const payload = JSON.stringify({ formData, extras: extras ?? {}, savedAt: Date.now() });
  try {
    storage.setItem(keyFor(variantId), payload);
  } catch {
    // quota exceeded, private mode, etc. — drop the draft silently.
  }
}

/**
 * Remove the saved draft for the given variant.
 *
 * @param {string} variantId
 * @param {Storage | undefined} [storage]
 * @returns {void}
 */
export function clearDraft(variantId, storage = defaultStorage()) {
  if (!storage) return;
  try {
    storage.removeItem(keyFor(variantId));
  } catch {
    // ignore
  }
}
