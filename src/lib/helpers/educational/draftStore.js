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
 * @param {string} variantId
 * @param {Storage | undefined} [storage]
 * @returns {{ formData: any, savedAt: number } | null}
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
 * @param {Storage | undefined} [storage]
 * @returns {void}
 */
export function saveDraft(variantId, formData, storage = defaultStorage()) {
  if (!storage) return;
  const payload = JSON.stringify({ formData, savedAt: Date.now() });
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
