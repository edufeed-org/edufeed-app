// Reactive hook bridging a Concord `BlobPointer` (community icon/banner) into
// a decrypted `blob:` object URL rune. Same bridge pattern as
// `bridge.svelte.js`'s `useObservable`: call during component init, read via
// the returned getter.
//
// Imports `blob-media.js` directly (a sibling concord/ submodule, no barrel)
// per this app's Concord convention. `blob-media.js` itself has zero package
// imports (pure Web Crypto + fetch), so this stays SSR-safe on its own merits
// too: `$effect` bodies never run during SSR, so the browser-only
// `fetchDecryptedBlobUrl` call below never executes server-side regardless.
import { fetchDecryptedBlobUrl } from './blob-media.js';

/**
 * Decrypted community-icon object URL for one Concord `BlobPointer`, or
 * `null` while loading / on failure / when no pointer is available. Call
 * during component init; read via the returned getter.
 * @param {() => {url?: string, key?: string, nonce?: string, hash?: string} | null | undefined} getIconPointer
 * @returns {() => string | null}
 */
export function useConcordAreaIcon(getIconPointer) {
  let iconUrl = $state.raw(/** @type {string | null} */ (null));

  $effect(() => {
    const pointer = getIconPointer();
    if (!pointer?.url || !pointer?.key || !pointer?.nonce || !pointer?.hash) {
      iconUrl = null;
      return;
    }

    let cancelled = false;
    fetchDecryptedBlobUrl(pointer).then((url) => {
      if (!cancelled) iconUrl = url;
    });
    return () => {
      cancelled = true;
    };
  });

  return () => iconUrl;
}
