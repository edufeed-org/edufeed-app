<script>
  import * as m from '$lib/paraglide/messages';
  import { formatLicenseUrl } from '$lib/helpers/educational/licenseLabel.js';
  import ProfileAvatar from './ProfileAvatar.svelte';
  import { useProfileMap } from '$lib/stores/profile-map.svelte.js';
  import { getDisplayName } from 'applesauce-core/helpers';

  let {
    open = $bindable(false),
    /** @type {{ event: any, events: any[], meta: any } | null} */
    tile = null,
    /** @type {() => void} */
    onuse = () => {},
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
   * @param {any} event
   * @returns {string | null}
   */
  function getAttestationSource(event) {
    return event?.tags?.find(/** @param {string[]} t */ (t) => t[0] === 'source')?.[1] ?? null;
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

  /**
   * @param {number | undefined} bytes
   * @returns {string}
   */
  function formatSize(bytes) {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function handleUse() {
    open = false;
    onuse();
  }

  function handleCancel() {
    open = false;
    oncancel();
  }

  /**
   * Dedupe attestations by author, newest-wins per pubkey. Since kind 1063 is
   * a regular (not replaceable) event, a single author may publish many
   * attestations for the same hash as they refine credit/license; we surface
   * only the most recent per author so the list reflects unique perspectives.
   */
  const uniqueAttestations = $derived.by(() => {
    const events = tile?.events ?? [];
    if (events.length === 0) return [];
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- ephemeral dedup inside $derived.by, never stored in reactive state
    const byAuthor = new Map();
    for (const event of events) {
      const existing = byAuthor.get(event.pubkey);
      const wins =
        !existing ||
        event.created_at > existing.created_at ||
        (event.created_at === existing.created_at && event.id < existing.id);
      if (wins) byAuthor.set(event.pubkey, event);
    }
    return [...byAuthor.values()].sort((a, b) => b.created_at - a.created_at);
  });

  // Batch-load profiles for every unique-attestation author.
  const getProfiles = useProfileMap(() => uniqueAttestations.map((a) => a.pubkey));

  /**
   * @param {Event} ev
   */
  function swapPlaceholder(ev) {
    const img = /** @type {HTMLImageElement} */ (ev.currentTarget);
    img.src =
      "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><rect width='64' height='64' fill='%23e5e7eb'/><text x='50%' y='54%' fill='%239ca3af' font-family='sans-serif' font-size='10' text-anchor='middle'>?</text></svg>";
  }
</script>

{#if open && tile}
  <dialog class="modal-open modal">
    <div class="modal-box w-11/12 max-w-3xl">
      <h3 class="text-lg font-semibold">{m.image_library_detail_title()}</h3>

      <div class="mt-4 grid gap-4 sm:grid-cols-[200px_1fr]">
        <div>
          <div class="overflow-hidden rounded-lg border bg-base-200">
            <img
              src={tile.meta.url}
              alt={m.image_library_picker_thumbnail_alt()}
              loading="lazy"
              onerror={swapPlaceholder}
              class="h-auto w-full object-contain"
            />
          </div>

          <dl class="mt-3 space-y-1 text-xs">
            {#if tile.meta.type}
              <div class="flex gap-2">
                <dt class="w-20 opacity-70">{m.image_library_detail_type()}</dt>
                <dd>{tile.meta.type}</dd>
              </div>
            {/if}
            {#if tile.meta.size}
              <div class="flex gap-2">
                <dt class="w-20 opacity-70">{m.image_library_detail_size()}</dt>
                <dd>{formatSize(tile.meta.size)}</dd>
              </div>
            {/if}
            {#if tile.meta.dimensions}
              <div class="flex gap-2">
                <dt class="w-20 opacity-70">{m.image_library_detail_dimensions()}</dt>
                <dd>{tile.meta.dimensions}</dd>
              </div>
            {/if}
            <div class="flex gap-2">
              <dt class="w-20 opacity-70">{m.image_library_detail_hash()}</dt>
              <dd class="font-mono text-[10px] break-all">{tile.meta.sha256}</dd>
            </div>
          </dl>
        </div>

        <div>
          <p class="mb-2 text-sm font-medium">
            {m.image_library_picker_attestations_title({ count: uniqueAttestations.length })}
          </p>
          <ul class="max-h-96 space-y-3 overflow-y-auto pr-2 text-xs">
            {#each uniqueAttestations as attestation (attestation.id)}
              {@const license = getAttestationLicense(attestation)}
              {@const credit = getAttestationCredit(attestation)}
              {@const source = getAttestationSource(attestation)}
              <li class="rounded border border-base-200 p-2" data-testid="detail-attestation">
                <div class="mb-2 flex items-center gap-2">
                  <ProfileAvatar
                    pubkey={attestation.pubkey}
                    profile={getProfiles().get(attestation.pubkey)}
                    size="xs"
                    fallbackType="robohash"
                    showHoverCard={false}
                  />
                  <span class="font-medium" title={attestation.pubkey}>
                    {getDisplayName(getProfiles().get(attestation.pubkey), attestation.pubkey)}
                  </span>
                </div>
                {#if license}
                  <div>
                    <span class="font-medium">{m.license_modal_license_label()}:</span>
                    {formatLicenseUrl(license)}
                  </div>
                {/if}
                {#if credit}
                  <div>
                    <span class="font-medium">{m.license_modal_credit_label()}:</span>
                    {credit}
                  </div>
                {/if}
                {#if source}
                  <div class="break-all">
                    <span class="font-medium">{m.license_modal_source_label()}:</span>
                    <a href={source} target="_blank" rel="noopener noreferrer" class="link"
                      >{source}</a
                    >
                  </div>
                {/if}
                <div class="opacity-70">
                  <span class="font-medium">{m.image_library_picker_attestation_date()}:</span>
                  {formatTimestamp(attestation.created_at)}
                </div>
              </li>
            {/each}
          </ul>
        </div>
      </div>

      <div class="modal-action">
        <button type="button" class="btn btn-ghost" onclick={handleCancel}>
          {m.image_source_chooser_cancel()}
        </button>
        <button
          type="button"
          class="btn btn-primary"
          data-testid="detail-use-button"
          onclick={handleUse}
        >
          {m.image_library_detail_use()}
        </button>
      </div>
    </div>
    <button class="modal-backdrop" onclick={handleCancel} aria-label="Close">close</button>
  </dialog>
{/if}
