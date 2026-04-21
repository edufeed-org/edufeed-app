/**
 * Per-pubkey profile subscription primitive.
 *
 * Kicks off an explicit relay-driven profile fetch via `profileLoader` and
 * subscribes to `eventStore.model(ProfileModel, pubkey)` for reactive
 * updates. Consolidates the working pattern used by `useUserProfile` so
 * higher-level hooks (single-pubkey and batch) share one implementation.
 *
 * The addressLoader backing `profileLoader` batches incoming pointers via
 * `bufferTime`, so calling this for many pubkeys in quick succession
 * coalesces into a single relay request per relay.
 */
import { ProfileModel } from 'applesauce-core/models';
import { profileLoader } from '$lib/loaders/profile.js';
import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
import { getProfileLookupRelays } from '$lib/helpers/relay-helper.js';

/**
 * Start a network fetch + reactive model subscription for one pubkey's profile.
 *
 * @param {string} pubkey
 * @param {(profile: any) => void} onProfile - Invoked whenever the profile
 *   changes in eventStore (may be called with undefined on delete).
 * @returns {{ unsubscribe: () => void }}
 */
export function subscribeProfile(pubkey, onProfile) {
  const loaderSub = profileLoader({
    kind: 0,
    pubkey,
    relays: getProfileLookupRelays()
  }).subscribe();

  const modelSub = eventStore.model(ProfileModel, pubkey).subscribe(onProfile);

  return {
    unsubscribe() {
      loaderSub.unsubscribe();
      modelSub.unsubscribe();
    }
  };
}
