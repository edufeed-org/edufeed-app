import { manager } from '$lib/stores/accounts.svelte';
import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
import { addressLoader } from '$lib/loaders/base.js';
import { getAllLookupRelays } from '$lib/helpers/relay-helper.js';
import { getWriteRelays } from '$lib/services/relay-service.svelte.js';
import { getEmojis, getPackName } from 'applesauce-common/helpers';

/**
 * @typedef {{ shortcode: string, url: string }} Emoji
 * @typedef {{ packName: string, emojis: Emoji[] }} EmojiPack
 */

/**
 * Preload user's emoji sets into EventStore on login.
 * Fires addressLoader calls for kind 10030 (emoji list) and kind 30030 (emoji packs)
 * so data is available immediately when ReactionPicker first opens.
 * @param {string} pubkey
 */
export function preloadUserEmojiSets(pubkey) {
  const relays = getAllLookupRelays();

  // Load kind 10030 (user's emoji list)
  addressLoader({ kind: 10030, pubkey, relays }).subscribe();

  // Also try user's write relays
  getWriteRelays(pubkey).then((writeRelays) => {
    const newRelays = writeRelays.filter((r) => !relays.includes(r));
    if (newRelays.length > 0) {
      addressLoader({ kind: 10030, pubkey, relays: newRelays }).subscribe();
    }
  });

  // Subscribe to emoji list to preload referenced packs
  const sub = eventStore.replaceable(10030, pubkey).subscribe((listEvent) => {
    if (!listEvent) return;

    const aTags = listEvent.tags.filter((t) => t[0] === 'a' && t[1]?.startsWith('30030:'));
    for (const aTag of aTags) {
      const [, coordinate, relay] = aTag;
      const parts = coordinate.split(':');
      if (parts.length < 3) continue;

      const [, packPubkey, ...identifierParts] = parts;
      const identifier = identifierParts.join(':');
      const packRelays = relay ? [...relays, relay] : relays;

      addressLoader({
        kind: 30030,
        pubkey: packPubkey,
        identifier,
        relays: packRelays
      }).subscribe();

      if (packPubkey !== pubkey) {
        getWriteRelays(packPubkey).then((writeRelays) => {
          const newRelays = writeRelays.filter((r) => !packRelays.includes(r));
          if (newRelays.length > 0) {
            addressLoader({
              kind: 30030,
              pubkey: packPubkey,
              identifier,
              relays: newRelays
            }).subscribe();
          }
        });
      }
    }

    // One-shot: unsubscribe once packs are loaded
    sub.unsubscribe();
  });
}

/**
 * Hook to load and subscribe to the active user's NIP-30 custom emoji sets.
 * Loads kind 10030 (emoji list) → resolves kind 30030 (emoji packs).
 * @returns {() => EmojiPack[]} Reactive getter returning array of emoji packs
 */
export function useUserEmojiSets() {
  let activeUser = $state(manager.active);
  let emojiPacks = $state(/** @type {EmojiPack[]} */ ([]));

  // Subscribe to account changes
  $effect(() => {
    const subscription = manager.active$.subscribe((user) => {
      activeUser = user;
    });
    return () => subscription.unsubscribe();
  });

  // Load emoji list and packs
  $effect(() => {
    if (!activeUser?.pubkey) {
      emojiPacks = [];
      return;
    }

    const pubkey = activeUser.pubkey;
    const relays = getAllLookupRelays();

    /** @type {import('rxjs').Subscription[]} */
    const subs = [];

    // 1. Fetch user's emoji list (kind 10030)
    subs.push(addressLoader({ kind: 10030, pubkey, relays }).subscribe());

    // Also try user's write relays (outbox)
    getWriteRelays(pubkey).then((writeRelays) => {
      const newRelays = writeRelays.filter((r) => !relays.includes(r));
      if (newRelays.length > 0) {
        subs.push(addressLoader({ kind: 10030, pubkey, relays: newRelays }).subscribe());
      }
    });

    // 2. Subscribe to the emoji list event in EventStore
    /** @type {Map<string, import('rxjs').Subscription>} */
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- internal tracking, not reactive state
    const packSubs = new Map();

    const listSub = eventStore.replaceable(10030, pubkey).subscribe((listEvent) => {
      if (!listEvent) {
        emojiPacks = [];
        return;
      }

      // Parse `a` tags pointing to kind 30030 packs
      const aTags = listEvent.tags.filter((t) => t[0] === 'a' && t[1]?.startsWith('30030:'));

      // Track which packs are still referenced
      // eslint-disable-next-line svelte/prefer-svelte-reactivity -- internal tracking, not reactive state
      const currentPackKeys = new Set();

      for (const aTag of aTags) {
        const [, coordinate, relay] = aTag;
        const parts = coordinate.split(':');
        if (parts.length < 3) continue;

        const [, packPubkey, ...identifierParts] = parts;
        const identifier = identifierParts.join(':');
        const packKey = `${packPubkey}:${identifier}`;
        currentPackKeys.add(packKey);

        // Skip if already subscribed to this pack
        if (packSubs.has(packKey)) continue;

        // Fetch the pack
        const packRelays = relay ? [...relays, relay] : relays;
        subs.push(
          addressLoader({
            kind: 30030,
            pubkey: packPubkey,
            identifier,
            relays: packRelays
          }).subscribe()
        );

        // Also fetch from pack author's write relays if different user
        if (packPubkey !== pubkey) {
          getWriteRelays(packPubkey).then((writeRelays) => {
            const newRelays = writeRelays.filter((r) => !packRelays.includes(r));
            if (newRelays.length > 0) {
              subs.push(
                addressLoader({
                  kind: 30030,
                  pubkey: packPubkey,
                  identifier,
                  relays: newRelays
                }).subscribe()
              );
            }
          });
        }

        // Subscribe to pack in EventStore
        const packSub = eventStore.replaceable(30030, packPubkey, identifier).subscribe(() => {
          // Rebuild all packs when any pack updates
          rebuildPacks(aTags);
        });
        packSubs.set(packKey, packSub);
      }

      // Clean up subscriptions for removed packs
      for (const [key, sub] of packSubs) {
        if (!currentPackKeys.has(key)) {
          sub.unsubscribe();
          packSubs.delete(key);
        }
      }

      // Initial build
      rebuildPacks(aTags);
    });

    /**
     * Rebuild the emojiPacks array from current EventStore state
     * @param {string[][]} aTags
     */
    function rebuildPacks(aTags) {
      /** @type {EmojiPack[]} */
      const packs = [];

      for (const aTag of aTags) {
        const parts = aTag[1].split(':');
        if (parts.length < 3) continue;

        const [, packPubkey, ...identifierParts] = parts;
        const identifier = identifierParts.join(':');

        // Get the pack event synchronously from EventStore
        /** @type {any} */
        let packEvent;
        const sub = eventStore.replaceable(30030, packPubkey, identifier).subscribe((ev) => {
          packEvent = ev;
        });
        sub.unsubscribe();

        if (packEvent) {
          const emojis = getEmojis(packEvent);
          const packName = getPackName(packEvent) || identifier || 'Unnamed';
          if (emojis.length > 0) {
            packs.push({ packName, emojis });
          }
        }
      }

      emojiPacks = packs;
    }

    return () => {
      listSub.unsubscribe();
      for (const sub of subs) sub.unsubscribe();
      for (const sub of packSubs.values()) sub.unsubscribe();
    };
  });

  return () => emojiPacks;
}
