<!--
  ProfileUploadsTab — "Meine Uploads": the kind-1063 license attestations the
  profile owner signed, one row per blob hash (newest attestation wins), with
  an "Entfernen" action that deletes the blob from its Blossom server(s) and
  publishes a NIP-09 for the attestation. Rendered only on the viewer's own
  profile; the page gates it, this component merely assumes the owner.

  Loader + model live here (not in useProfileContent) because kind 1063 is
  not a feed kind: nothing else on the profile fetches it.
-->
<script>
  import { untrack } from 'svelte';
  import { TimelineModel } from 'applesauce-core/models';
  import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
  import { createCachedTimelineLoader } from '$lib/loaders/base.js';
  import { getAllLookupRelays } from '$lib/helpers/relay-helper.js';
  import { getWriteRelays } from '$lib/services/relay-service.svelte.js';
  import { getBlossomUploadServers } from '$lib/services/blossom-settings-service.js';
  import { removeUpload } from '$lib/services/uploads-service.js';
  import {
    latestPerHash,
    blossomServersForLicense,
    getLicenseHash
  } from '$lib/helpers/my-uploads.js';
  import { getLicenseUrl } from '$lib/helpers/image-license.js';
  import { getProxiedImageUrl } from '$lib/helpers/image-proxy.js';
  import { formatTimestamp } from '$lib/helpers/dates.js';
  import { showToast } from '$lib/helpers/toast';
  import ImageLicenseOverlay from '$lib/components/shared/ImageLicenseOverlay.svelte';
  import { FilesIcon } from '$lib/components/icons';
  import * as m from '$lib/paraglide/messages';

  /**
   * @type {{
   *   pubkey: string,
   *   activeUser: { pubkey: string, signer: { signEvent: (t: any) => Promise<any> } } | null
   * }}
   */
  let { pubkey, activeUser } = $props();

  /** @type {import('nostr-tools').NostrEvent[]} */
  let rawEvents = $state.raw([]);
  // Rows removed in this session: the kind 5 drops them from the model
  // optimistically, but a relay answering after the deletion could re-add a
  // copy — keep them out regardless.
  let removedHashes = $state.raw(/** @type {Set<string>} */ (new Set()));
  let uploads = $derived(
    latestPerHash(rawEvents).filter((e) => !removedHashes.has(getLicenseHash(e) || ''))
  );

  /** @type {import('nostr-tools').NostrEvent | null} */
  let pendingRemoval = $state.raw(null);
  let removing = $state(false);

  $effect(() => {
    if (!pubkey) {
      rawEvents = [];
      return;
    }
    const filter = { kinds: [1063], authors: [pubkey] };
    const modelSub = eventStore.model(TimelineModel, filter).subscribe({
      next: (loaded) => {
        rawEvents = loaded || [];
      },
      error: (err) => console.error('ProfileUploadsTab: Model error:', err)
    });

    // Attestations go out through the outbox (author write relays + fallback),
    // so query the lookup set first and the user's NIP-65 write relays on top.
    const relays = untrack(() => getAllLookupRelays());
    const loaderSub = createCachedTimelineLoader(relays, filter, { limit: 500 })().subscribe();
    /** @type {import('rxjs').Subscription | undefined} */
    let writeSub;
    getWriteRelays(pubkey)
      .then((writeRelays) => {
        const extra = writeRelays.filter((r) => !relays.includes(r));
        if (extra.length > 0) {
          writeSub = createCachedTimelineLoader(extra, filter, { limit: 500 })().subscribe();
        }
      })
      .catch(() => {});

    return () => {
      modelSub.unsubscribe();
      loaderSub.unsubscribe();
      writeSub?.unsubscribe();
    };
  });

  /**
   * @param {import('nostr-tools').NostrEvent} event
   * @param {string} name
   */
  function tag(event, name) {
    return event.tags.find((t) => t[0] === name)?.[1] ?? null;
  }

  /** @param {import('nostr-tools').NostrEvent} event */
  function isImage(event) {
    return (tag(event, 'm') || '').startsWith('image/');
  }

  /** @param {string | null} url */
  function shortUrl(url) {
    if (!url) return '';
    try {
      const parsed = new URL(url);
      const file = parsed.pathname.split('/').pop() || '';
      return `${parsed.host}/…${file.slice(-12)}`;
    } catch {
      return url;
    }
  }

  async function confirmRemoval() {
    const event = pendingRemoval;
    if (!event || !activeUser || removing) return;
    removing = true;
    try {
      const servers = blossomServersForLicense(
        event,
        getBlossomUploadServers(activeUser.pubkey, eventStore)
      );
      const result = await removeUpload(event, activeUser, { servers });
      if (!result.success) {
        showToast(m.profile_uploads_remove_error(), 'error');
        return;
      }
      const hash = getLicenseHash(event);
      if (hash) removedHashes = new Set([...removedHashes, hash]);
      const failed = result.blossom.filter((r) => r.status === 'failed');
      if (failed.length > 0) {
        showToast(
          m.profile_uploads_remove_partial({ hosts: failed.map((r) => r.server).join(', ') }),
          'warning',
          8000
        );
      } else {
        showToast(m.profile_uploads_remove_success(), 'success');
      }
      pendingRemoval = null;
    } catch (err) {
      console.error('ProfileUploadsTab: removal failed:', err);
      showToast(m.profile_uploads_remove_error(), 'error');
    } finally {
      removing = false;
    }
  }
</script>

<div class="py-4">
  <p class="mb-4 text-sm text-base-content/60">{m.profile_uploads_hint()}</p>

  {#if uploads.length === 0}
    <div class="pf-empty" data-testid="uploads-empty">
      <FilesIcon class_="w-10 h-10" />
      <h3>{m.profile_uploads_empty_title()}</h3>
      <p>{m.profile_uploads_empty_description()}</p>
    </div>
  {:else}
    <ul class="space-y-3">
      {#each uploads as event (getLicenseHash(event))}
        {@const url = getLicenseUrl(event)}
        {@const title = tag(event, 'title') || tag(event, 'alt') || ''}
        <li
          class="flex items-center gap-3 rounded-xl border border-base-300 bg-base-100 p-3"
          data-testid="upload-row"
          data-hash={getLicenseHash(event)}
        >
          <div
            class="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-base-200"
          >
            {#if url && isImage(event)}
              <img
                src={getProxiedImageUrl(url, 'thumbnail')}
                alt={title}
                class="h-full w-full object-cover"
                loading="lazy"
              />
            {:else}
              <FilesIcon class_="w-6 h-6 text-base-content/40" />
            {/if}
          </div>
          <div class="min-w-0 flex-1">
            {#if title}
              <div class="truncate font-semibold text-base-content">{title}</div>
            {/if}
            <div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-base-content/60">
              <span>{formatTimestamp(event.created_at)}</span>
              {#if url}
                <a href={url} target="_blank" rel="noopener noreferrer" class="link truncate">
                  {shortUrl(url)}
                </a>
              {/if}
            </div>
            {#if tag(event, 'license')}
              <!-- Plain NIP-94 file metadata (no license tag) gets no pill. -->
              <div class="relative mt-1.5 h-6">
                <ImageLicenseOverlay
                  licenseEvent={event}
                  status="found"
                  position="absolute left-0 top-0"
                />
              </div>
            {/if}
          </div>
          <button
            type="button"
            class="btn shrink-0 btn-outline btn-sm"
            data-testid="upload-remove"
            disabled={!activeUser}
            onclick={() => {
              pendingRemoval = event;
            }}
          >
            {m.common_remove()}
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</div>

{#if pendingRemoval}
  <div class="modal-open modal" role="dialog">
    <div class="modal-box max-w-sm">
      <h3 class="text-lg font-extrabold">{m.profile_uploads_remove_title()}</h3>
      <p class="my-3 text-sm text-base-content/70">{m.profile_uploads_remove_body()}</p>
      <div class="modal-action">
        <button
          type="button"
          class="btn btn-ghost"
          data-testid="upload-remove-cancel"
          disabled={removing}
          onclick={() => {
            pendingRemoval = null;
          }}
        >
          {m.common_cancel()}
        </button>
        <button
          type="button"
          class="btn btn-error"
          data-testid="upload-remove-confirm"
          disabled={removing}
          onclick={confirmRemoval}
        >
          {#if removing}<span class="loading loading-sm loading-spinner"></span>{/if}
          {m.common_remove()}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .pf-empty {
    background: var(--c-paper);
    border: 1.5px dashed var(--c-rule);
    border-radius: 14px;
    padding: 40px 24px;
    text-align: center;
    color: var(--c-ink-soft);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
  }
  .pf-empty h3 {
    font-family: var(--pf-display);
    font-weight: 700;
    font-size: 16px;
    color: var(--c-ink);
    margin: 0;
  }
  .pf-empty p {
    margin: 0;
    font-size: 14px;
    max-width: 420px;
  }
</style>
