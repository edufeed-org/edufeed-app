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
  import { searchOer, fetchOerAsset } from '$lib/helpers/oer/searchOer.js';
  import { oerToLicenseInput } from '$lib/helpers/oer/oerToLicenseInput.js';
  import { findExistingLicense, publishLicenseAttestation } from '$lib/helpers/image-license.js';
  import { OER_SOURCES } from '$lib/config/oer-sources.js';
  import LicenseBadge from './LicenseBadge.svelte';
  import ImageLibraryDetailModal from './ImageLibraryDetailModal.svelte';

  let {
    open = $bindable(false),
    /** @type {(picked: { url: string, hash: string, licenseEvent: any }) => void} */
    onpick = () => {},
    /** @type {() => void} */
    onupload = () => {},
    /** @type {() => void} */
    oncancel = () => {}
  } = $props();

  // Symbol-bearing event arrays MUST use $state.raw — see CLAUDE.md.
  let events = $state.raw(/** @type {any[]} */ ([]));
  let userServerList = $state.raw(/** @type {any} */ (undefined));
  let loading = $state(false);

  const oerEnabled = $derived(Boolean(runtimeConfig.oer?.enabled));

  let oerQuery = $state('');
  let oerSelectedSources = $state(OER_SOURCES.filter((s) => s.checked).map((s) => s.id));
  // OerItem[] carry no Symbol metadata, but they're replaced wholesale — keep raw for parity.
  let oerResults = $state.raw(/** @type {any[]} */ ([]));
  let oerPage = $state(1);
  let oerHasMore = $state(false);
  let oerLoading = $state(false);
  let oerError = $state('');
  let oerPicking = $state(false);

  /** @param {string} id */
  function toggleOerSource(id) {
    oerSelectedSources = oerSelectedSources.includes(id)
      ? oerSelectedSources.filter((s) => s !== id)
      : [...oerSelectedSources, id];
  }

  async function runOerSearch(page = 1) {
    const term = oerQuery.trim();
    if (!term || oerSelectedSources.length === 0) return;
    oerLoading = true;
    oerError = '';
    try {
      const { data, meta } = await searchOer({
        searchTerm: term,
        sources: oerSelectedSources,
        page
      });
      // Dedupe by amb.id across pages; first occurrence wins.
      // eslint-disable-next-line svelte/prefer-svelte-reactivity -- ephemeral dedup inside async fn, never stored in reactive state
      const seen = new Set(page === 1 ? [] : oerResults.map((i) => i.amb?.id ?? i.id));
      const merged = page === 1 ? [] : [...oerResults];
      for (const item of data) {
        const key = item.amb?.id ?? item.id;
        if (!key || seen.has(key)) continue;
        seen.add(key);
        merged.push(item);
      }
      oerResults = merged;
      oerPage = page;
      oerHasMore = Boolean(meta?.hasMore);
    } catch (e) {
      console.error('OER search failed', e);
      oerError = m.image_library_picker_oer_error();
    } finally {
      oerLoading = false;
    }
  }

  /** @param {SubmitEvent} e */
  function onOerSubmit(e) {
    e.preventDefault();
    runOerSearch(1);
  }

  /** @param {any} item */
  async function pickOer(item) {
    if (oerPicking) return;
    oerPicking = true;
    oerError = '';
    try {
      const originalUrl = item.amb?.id;
      if (!originalUrl) throw new Error('OER item missing amb.id');
      const asset = await fetchOerAsset(originalUrl);
      const existing = await findExistingLicense(asset.sha256);
      let licenseEvent = existing;
      if (!licenseEvent) {
        const input = oerToLicenseInput(item, asset);
        if (!input) throw new Error('Cannot resolve license for OER item');
        licenseEvent = await publishLicenseAttestation(input, manager.active);
      }
      open = false;
      onpick({ url: originalUrl, hash: asset.sha256, licenseEvent });
    } catch (e) {
      console.error('OER pick failed', e);
      oerError = m.image_library_picker_oer_pick_failed();
    } finally {
      oerPicking = false;
    }
  }

  /**
   * Proxied thumbnail for an OER tile (privacy: browser hits source only on pick).
   * @param {any} item
   */
  function oerThumb(item) {
    return item.extensions?.images?.small ?? item.extensions?.images?.medium ?? item.amb?.id;
  }

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

  let detailOpen = $state(false);
  /** @type {{ event: any, events: any[], meta: any } | null} */
  let detailTile = $state(null);

  /**
   * @param {{ event: any, events: any[], meta: any }} tile
   */
  function showDetails(tile) {
    detailTile = tile;
    detailOpen = true;
  }

  function confirmDetail() {
    if (!detailTile) return;
    const t = detailTile;
    open = false;
    detailTile = null;
    onpick({ url: t.meta.url, hash: t.meta.sha256, licenseEvent: t.event });
  }

  function cancelDetail() {
    detailTile = null;
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

      {#if oerEnabled}
        <section class="mt-4 rounded-lg border border-base-300 p-3" data-testid="oer-section">
          <h4 class="mb-2 text-sm font-semibold">{m.image_library_picker_oer_section_title()}</h4>
          <form class="flex gap-2" onsubmit={onOerSubmit} data-testid="oer-search-form">
            <input
              type="search"
              class="input-bordered input input-sm w-full"
              placeholder={m.image_library_picker_oer_search_placeholder()}
              bind:value={oerQuery}
              data-testid="oer-search-input"
            />
            <button type="submit" class="btn btn-sm btn-primary" disabled={oerLoading}>
              {m.image_library_picker_oer_search_button()}
            </button>
          </form>

          <div class="mt-2 flex flex-wrap gap-3">
            {#each OER_SOURCES as src (src.id)}
              <label class="flex cursor-pointer items-center gap-1 text-xs">
                <input
                  type="checkbox"
                  class="checkbox checkbox-xs"
                  checked={oerSelectedSources.includes(src.id)}
                  onchange={() => toggleOerSource(src.id)}
                />
                <span>{src.label}</span>
              </label>
            {/each}
          </div>

          {#if oerError}
            <p class="mt-2 text-xs text-error" data-testid="oer-error">{oerError}</p>
          {/if}

          {#if oerLoading && oerResults.length === 0}
            <div class="py-6 text-center" data-testid="oer-loading">
              <span class="loading loading-sm loading-spinner"></span>
              <p class="mt-1 text-xs opacity-70">{m.image_library_picker_oer_loading()}</p>
            </div>
          {:else if oerResults.length > 0}
            <div class="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
              {#each oerResults as item (item.amb?.id ?? item.id)}
                <button
                  type="button"
                  class="flex flex-col gap-1 rounded-lg border p-2 text-left hover:bg-base-200 focus:outline-2 focus:outline-primary disabled:opacity-50"
                  onclick={() => pickOer(item)}
                  disabled={oerPicking}
                  data-testid="oer-tile"
                >
                  <div class="aspect-square overflow-hidden rounded bg-base-200">
                    <img
                      src={oerThumb(item)}
                      alt={item.amb?.name ?? m.image_library_picker_thumbnail_alt()}
                      loading="lazy"
                      onerror={swapPlaceholder}
                      class="h-full w-full object-cover"
                    />
                  </div>
                  <span class="truncate text-xs opacity-70">{item.amb?.name ?? ''}</span>
                </button>
              {/each}
            </div>
            {#if oerHasMore}
              <div class="mt-3 text-center">
                <button
                  type="button"
                  class="btn btn-ghost btn-sm"
                  onclick={() => runOerSearch(oerPage + 1)}
                  disabled={oerLoading}
                >
                  {m.image_library_picker_oer_load_more()}
                </button>
              </div>
            {/if}
          {/if}
        </section>
      {/if}

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
            <button
              type="button"
              class="flex flex-col gap-1 rounded-lg border p-2 text-left hover:bg-base-200 focus:outline-2 focus:outline-primary"
              onclick={() => showDetails(tile)}
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

<ImageLibraryDetailModal
  bind:open={detailOpen}
  tile={detailTile}
  onuse={confirmDetail}
  oncancel={cancelDetail}
/>
