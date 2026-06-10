<script>
  import { onDestroy } from 'svelte';
  import { createTimelineLoader } from 'applesauce-loaders/loaders';
  import {
    getFileMetadata,
    BLOSSOM_SERVER_LIST_KIND,
    getBlossomServersFromList
  } from 'applesauce-common/helpers';
  import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
  import { timedPool } from '$lib/loaders/base.js';
  import { getAllLookupRelays } from '$lib/helpers/relay-helper.js';
  import { runtimeConfig } from '$lib/stores/config.svelte.js';
  import { manager } from '$lib/stores/accounts.svelte';
  import { normalizeServerUrl, urlIsOnTrustedServer } from '$lib/helpers/blossom-trust.js';
  import * as m from '$lib/paraglide/messages';
  import LicenseBadge from './LicenseBadge.svelte';
  import { formatLicenseUrl } from '$lib/helpers/educational/licenseLabel.js';

  let {
    open = $bindable(false),
    /** @type {(picked: { url: string, hash: string, licenseEvent: any }) => void} */
    onpick = () => {},
    /** @type {() => void} */
    onupload = () => {},
    /** @type {() => void} */
    oncancel = () => {}
  } = $props();

  /**
   * @param {any} event
   * @returns {string | null}
   */
  function getAttestationLicense(event) {
    return event?.tags?.find(/** @param {string[]} t */ (t) => t[0] === 'license')?.[1] ?? null;
  }

  /**
   * @param {any} event
   * @returns {string | null}
   */
  function getAttestationCredit(event) {
    return event?.tags?.find(/** @param {string[]} t */ (t) => t[0] === 'credit')?.[1] ?? null;
  }

  /**
   * @param {string} pubkey
   * @returns {string}
   */
  function shortPubkey(pubkey) {
    if (!pubkey || pubkey.length <= 16) return pubkey;
    return `${pubkey.slice(0, 8)}…${pubkey.slice(-6)}`;
  }

  /**
   * @param {number} unixSeconds
   * @returns {string}
   */
  function formatTimestamp(unixSeconds) {
    const date = new Date(unixSeconds * 1000);
    return date.toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  // Symbol-bearing event arrays MUST use $state.raw — see CLAUDE.md.
  let events = $state.raw(/** @type {any[]} */ ([]));
  let userServerList = $state.raw(/** @type {any} */ (undefined));
  let loading = $state(false);

  /** @type {import('rxjs').Subscription | undefined} */
  let timelineSub;
  /** @type {import('rxjs').Subscription | undefined} */
  let loaderSub;
  /** @type {import('rxjs').Subscription | undefined} */
  let listSub;

  $effect(() => {
    if (!open) return;

    loading = true;

    // Timeline subscription: reactive view of all kind 1063 events in the store.
    const filter = { kinds: [1063] };
    const loader = createTimelineLoader(timedPool, getAllLookupRelays(), filter, {
      eventStore,
      limit: 100
    });
    loaderSub = loader().subscribe({
      complete: () => {
        loading = false;
      },
      error: () => {
        loading = false;
      }
    });
    timelineSub = eventStore.timeline(filter).subscribe((next) => {
      events = next ?? [];
      // Once we've received any timeline emission, we know the subscription is live.
      // Loader may still be fetching more, but we have enough to render meaningfully.
      loading = false;
    });

    // Active user's kind 10063 list (for trusted server expansion).
    const pubkey = manager.active?.pubkey;
    if (pubkey) {
      listSub = eventStore.replaceable(BLOSSOM_SERVER_LIST_KIND, pubkey).subscribe((e) => {
        userServerList = e;
      });
    }

    return () => {
      timelineSub?.unsubscribe();
      loaderSub?.unsubscribe();
      listSub?.unsubscribe();
      timelineSub = loaderSub = listSub = undefined;
    };
  });

  const trustedServers = $derived.by(() => {
    const fromList = userServerList
      ? getBlossomServersFromList(userServerList).map((u) => u.href)
      : [];
    const deploymentDefaults = /** @type {string[]} */ (runtimeConfig.defaultBlossomServers ?? []);
    return [...new Set([...deploymentDefaults, ...fromList].map(normalizeServerUrl))];
  });

  const tiles = $derived.by(() => {
    /** @type {Map<string, { events: any[], event: any, meta: any }>} */
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- ephemeral dedup inside $derived.by, never stored in reactive state
    const byHash = new Map();
    for (const event of events) {
      if (event?.kind !== 1063) continue;
      const meta = getFileMetadata(event);
      if (!meta?.url || !meta.sha256) continue;
      if (!urlIsOnTrustedServer(meta.url, trustedServers)) continue;
      const existing = byHash.get(meta.sha256);
      if (!existing) {
        byHash.set(meta.sha256, { events: [event], event, meta });
        continue;
      }
      existing.events.push(event);
      const wins =
        event.created_at > existing.event.created_at ||
        (event.created_at === existing.event.created_at && event.id < existing.event.id);
      if (wins) {
        existing.event = event;
        existing.meta = meta;
      }
    }
    // Sort each tile's events newest-first for the popover.
    for (const tile of byHash.values()) {
      tile.events.sort((a, b) => {
        if (b.created_at !== a.created_at) return b.created_at - a.created_at;
        return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
      });
    }
    return [...byHash.values()].sort((a, b) => b.event.created_at - a.event.created_at);
  });

  /**
   * @param {{ event: any, meta: any }} tile
   */
  function handlePick(tile) {
    open = false;
    onpick({ url: tile.meta.url, hash: tile.meta.sha256, licenseEvent: tile.event });
  }

  function handleUpload() {
    open = false;
    onupload();
  }

  function handleCancel() {
    open = false;
    oncancel();
  }

  /**
   * @param {Event} ev
   */
  function swapPlaceholder(ev) {
    const img = /** @type {HTMLImageElement} */ (ev.currentTarget);
    img.src =
      "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><rect width='64' height='64' fill='%23e5e7eb'/><text x='50%' y='54%' fill='%239ca3af' font-family='sans-serif' font-size='10' text-anchor='middle'>?</text></svg>";
  }

  onDestroy(() => {
    timelineSub?.unsubscribe();
    loaderSub?.unsubscribe();
    listSub?.unsubscribe();
  });
</script>

{#if open}
  <dialog class="modal-open modal">
    <div class="modal-box w-11/12 max-w-4xl">
      <h3 class="text-lg font-semibold">{m.image_library_picker_title()}</h3>

      {#if loading && tiles.length === 0}
        <div class="py-12 text-center" data-testid="library-loading">
          <span class="loading loading-md loading-spinner"></span>
          <p class="mt-2 text-sm opacity-70">{m.image_library_picker_loading()}</p>
        </div>
      {:else if tiles.length === 0}
        <div class="py-12 text-center">
          <p class="font-medium">{m.image_library_picker_empty_title()}</p>
          <p class="mt-1 text-sm opacity-70">{m.image_library_picker_empty_desc()}</p>
          <button type="button" class="btn mt-4 btn-primary" onclick={handleUpload}>
            {m.image_library_picker_empty_cta()}
          </button>
        </div>
      {:else}
        <div class="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {#each tiles as tile (tile.event.id)}
            <div class="group relative">
              <button
                type="button"
                class="flex w-full flex-col gap-1 rounded-lg border p-2 text-left hover:bg-base-200 focus:outline-2 focus:outline-primary"
                onclick={() => handlePick(tile)}
                data-testid="library-tile"
                data-event-id={tile.event.id}
              >
                <div class="aspect-square overflow-hidden rounded bg-base-200">
                  <img
                    src={tile.meta.url}
                    alt={m.image_library_picker_thumbnail_alt()}
                    loading="lazy"
                    onerror={swapPlaceholder}
                    class="h-full w-full object-cover"
                  />
                </div>
                <LicenseBadge licenseEvent={tile.event} class="self-start" />
              </button>

              <!-- Hover/focus-visible popover with full attestation history -->
              <div
                class="pointer-events-none invisible absolute top-full right-0 left-0 z-10 mt-1 rounded-lg border bg-base-100 p-3 text-xs opacity-0 shadow-lg transition-opacity duration-150 group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100"
                data-testid="library-tile-attestations"
              >
                <p class="mb-2 font-semibold">
                  {m.image_library_picker_attestations_title({ count: tile.events.length })}
                </p>
                <ul class="space-y-2">
                  {#each tile.events as attestation (attestation.id)}
                    {@const attestationLicense = getAttestationLicense(attestation)}
                    {@const attestationCredit = getAttestationCredit(attestation)}
                    <li class="border-b border-base-200 pb-2 last:border-b-0 last:pb-0">
                      {#if attestationLicense}
                        <div>
                          <span class="font-medium">{m.license_modal_license_label()}:</span>
                          {formatLicenseUrl(attestationLicense)}
                        </div>
                      {/if}
                      {#if attestationCredit}
                        <div>
                          <span class="font-medium">{m.license_modal_credit_label()}:</span>
                          {attestationCredit}
                        </div>
                      {/if}
                      <div class="opacity-70">
                        <span class="font-medium">{m.license_modal_attested_by()}:</span>
                        {shortPubkey(attestation.pubkey)}
                      </div>
                      <div class="opacity-70">
                        <span class="font-medium">{m.image_library_picker_attestation_date()}:</span
                        >
                        {formatTimestamp(attestation.created_at)}
                      </div>
                    </li>
                  {/each}
                </ul>
              </div>
            </div>
          {/each}
        </div>
      {/if}

      <div class="modal-action">
        <button type="button" class="btn btn-ghost" onclick={handleCancel}>
          {m.image_source_chooser_cancel()}
        </button>
      </div>
    </div>
    <button class="modal-backdrop" onclick={handleCancel} aria-label="Close">close</button>
  </dialog>
{/if}
