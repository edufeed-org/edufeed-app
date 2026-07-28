/**
 * Shared detection for the state of the active user's membership handle
 * application, used by the settings MembershipCard and the Termi assistant:
 *
 *   'none'    — no kind 1069 application published by this user
 *   'pending' — an application exists but the wished handle does not resolve
 *               to the user's pubkey in the upstream NIP-05 directory yet
 *   'granted' — the upstream `.well-known/nostr.json` maps the wished handle
 *               to the user's pubkey (an admin approved it)
 *
 * The wished handle comes from the user's own newest application copy,
 * NIP-44-decrypted against the admin in that copy's p-tag (applications are
 * fanned out one encrypted copy per admin). The upstream check re-runs on
 * `window.focus` so a grant shows up when the user returns to the tab.
 */
import { manager } from '$lib/stores/accounts.svelte';
import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
import { runtimeConfig } from '$lib/stores/config.svelte.js';
import { buildUserResponseFilter, parseResponseTags } from '$lib/helpers/forms.js';
import { createTimelineLoader } from 'applesauce-loaders/loaders';
import { timedPool } from '$lib/loaders/base.js';
import { getCommunikeyRelays } from '$lib/helpers/relay-helper.js';

/**
 * Reactive hook — must be called during component/effect-root initialization.
 *
 * @returns {{
 *   getState: () => 'none' | 'pending' | 'granted',
 *   getWishedHandle: () => string,
 *   getAddress: () => string,
 *   getResponse: () => import('nostr-tools').NostrEvent | null
 * }}
 */
export function useMembershipGrantState() {
  const cfg = $derived(runtimeConfig.membership);
  const enabled = $derived(cfg?.enabled === true);
  const formAddress = $derived(cfg?.formAddress || '');
  const handleDomain = $derived(cfg?.handleDomain || '');
  const adminPubkeys = $derived(cfg?.adminPubkeys || []);

  /** @type {import('nostr-tools').NostrEvent | null} */
  let existingResponse = $state(null);
  /** Wished handle from the decrypted (or plaintext) response, e.g. "maria". */
  let wishedHandle = $state('');
  /** Whether the upstream `.well-known` lookup maps wishedHandle → user's pubkey. */
  let granted = $state(false);

  // The user's own newest application (any admin copy — same payload).
  $effect(() => {
    existingResponse = null;
    if (!enabled || !manager.active || !formAddress) return;
    const filter = buildUserResponseFilter(formAddress, manager.active.pubkey);
    const relays = getCommunikeyRelays();

    const loaderSub = createTimelineLoader(timedPool, relays, filter, {
      eventStore,
      limit: 1
    })().subscribe();

    const modelSub = eventStore.timeline(filter).subscribe((events) => {
      existingResponse = events?.[0] || null;
    });

    return () => {
      loaderSub.unsubscribe();
      modelSub.unsubscribe();
    };
  });

  // Decrypt (or read plaintext) the wished_handle out of the response.
  $effect(() => {
    const response = existingResponse;
    const active = manager.active;
    if (!response || !active) {
      wishedHandle = '';
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const isEncrypted = response.tags.some((t) => t[0] === 'encrypted');
        let tags;
        if (isEncrypted) {
          // Each fan-out copy is encrypted to the admin in its own p-tag.
          const counterparty =
            response.tags.find((t) => t[0] === 'p')?.[1] || adminPubkeys[0] || '';
          if (!counterparty || !active.signer?.nip44?.decrypt) return;
          const plaintext = await active.signer.nip44.decrypt(counterparty, response.content);
          tags = JSON.parse(plaintext);
        } else {
          tags = response.tags.filter((t) => t[0] === 'response');
        }
        if (cancelled) return;
        const values = parseResponseTags(tags);
        wishedHandle = (values?.wished_handle || '').trim();
      } catch {
        if (!cancelled) wishedHandle = '';
      }
    })();
    return () => {
      cancelled = true;
    };
  });

  // Ask the public domain whether the wished_handle has been provisioned for
  // this user; re-check when the tab regains focus.
  $effect(() => {
    granted = false;
    const active = manager.active;
    const handle = wishedHandle;
    if (!active || !handle || !handleDomain) return;
    const userPubkey = active.pubkey;
    let cancelled = false;

    async function check() {
      try {
        const url = `https://${handleDomain}/.well-known/nostr.json?name=${encodeURIComponent(handle)}`;
        const res = await fetch(url, { headers: { accept: 'application/json' } });
        if (!res.ok) return;
        const body = await res.json();
        const mapped = body?.names?.[handle];
        if (!cancelled) granted = mapped === userPubkey;
      } catch {
        // Network/CORS — leave as-is; the focus listener retries.
      }
    }

    check();
    if (typeof window !== 'undefined') {
      window.addEventListener('focus', check);
    }
    return () => {
      cancelled = true;
      if (typeof window !== 'undefined') {
        window.removeEventListener('focus', check);
      }
    };
  });

  const state = $derived(!existingResponse ? 'none' : granted ? 'granted' : 'pending');
  const address = $derived(wishedHandle && handleDomain ? `${wishedHandle}@${handleDomain}` : '');

  return {
    getState: () => state,
    getWishedHandle: () => wishedHandle,
    getAddress: () => address,
    getResponse: () => existingResponse
  };
}
