/**
 * Real-time wave notification service.
 * Subscribes to incoming waves and shows toast notifications.
 */
import { pool, eventStore } from '$lib/stores/nostr-infrastructure.svelte';
import { ProfileModel } from 'applesauce-core/models';
import { profileLoader } from '$lib/loaders/profile.js';
import { getProfileLookupRelays, getAllLookupRelays } from '$lib/helpers/relay-helper.js';
import { isWave } from '$lib/helpers/waves.js';
import { showToast } from '$lib/helpers/toast';
import * as m from '$lib/paraglide/messages.js';

/** @type {import('rxjs').Subscription | undefined} */
let subscription;

/**
 * Initialize real-time wave toast notifications.
 * @param {string} pubkey - The logged-in user's pubkey
 */
export function initializeWaveToasts(pubkey) {
  cleanupWaveToasts();

  const since = Math.floor(Date.now() / 1000);
  const relays = getAllLookupRelays();

  subscription = pool
    .request(relays, { kinds: [7], '#p': [pubkey], '#k': ['0'], since })
    .subscribe((event) => {
      // Filter self-waves and non-waves
      if (event.pubkey === pubkey || !isWave(event)) return;

      // Add to EventStore for inbox
      eventStore.add(event);

      // Load waver's profile for display name
      const profileRelays = getProfileLookupRelays();
      profileLoader({ kind: 0, pubkey: event.pubkey, relays: profileRelays }).subscribe();

      /** @type {import('rxjs').Subscription | undefined} */
      let profileSub;
      profileSub = eventStore.model(ProfileModel, event.pubkey).subscribe((profile) => {
        if (profile) {
          const name = profile.display_name || profile.name || event.pubkey.slice(0, 8);
          showToast(`👋 ${name} ${m.inbox_action_wave()}`, 'info');
          profileSub?.unsubscribe();
        }
      });

      // Timeout fallback if profile never loads
      setTimeout(() => {
        if (profileSub && !profileSub.closed) {
          showToast(`👋 ${event.pubkey.slice(0, 8)} ${m.inbox_action_wave()}`, 'info');
          profileSub.unsubscribe();
        }
      }, 3000);
    });
}

/** Clean up wave toast subscription. */
export function cleanupWaveToasts() {
  subscription?.unsubscribe();
  subscription = undefined;
}
