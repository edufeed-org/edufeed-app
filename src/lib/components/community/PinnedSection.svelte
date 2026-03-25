<script>
  import * as m from '$lib/paraglide/messages.js';
  import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
  import { addressLoader, eventLoader } from '$lib/loaders';
  import { CommunityPinListModel } from '$lib/models/pin-list.js';
  import { getFeedCardData } from '$lib/helpers/feedCardData.js';
  import { unpinEvent, reorderPins, pinEvent } from '$lib/services/pin-list-service.js';
  import { showToast } from '$lib/helpers/toast.js';
  import { getCommunikeyRelays } from '$lib/helpers/relay-helper.js';
  import { nip19 } from 'nostr-tools';

  let { communityId, isAdmin = false, onNavigateToEvent } = $props();

  /** @type {Array<any>} */
  let pinPointers = $state.raw([]);

  /** @type {Array<any>} */
  let pinnedEvents = $state.raw([]);

  let isEditing = $state(false);
  let addInput = $state('');

  // Load kind 10001 and subscribe to pin list model
  $effect(() => {
    const pubkey = communityId;
    if (!pubkey) return;

    const relays = getCommunikeyRelays();

    const lSub = addressLoader({ kind: 10001, pubkey, relays }).subscribe();
    const mSub = eventStore.model(CommunityPinListModel, pubkey).subscribe((pointers) => {
      pinPointers = pointers || [];
    });

    return () => {
      lSub.unsubscribe();
      mSub.unsubscribe();
    };
  });

  // Resolve pinned events from pointers
  $effect(() => {
    if (pinPointers.length === 0) {
      pinnedEvents = [];
      return;
    }

    /** @type {Array<import('rxjs').Subscription>} */
    const subs = [];
    /** @type {Record<string, any>} */
    const resolved = {};
    let resolvedCount = 0;

    for (const pointer of pinPointers) {
      if (pointer.id) {
        // Event pointer - try EventStore first, then load
        const existing = eventStore.getEvent(pointer.id);
        if (existing) {
          resolved[pointer.id] = existing;
          resolvedCount++;
        } else {
          const sub = eventLoader(pointer.id, pointer.relays).subscribe();
          subs.push(sub);
        }
      } else if (pointer.kind !== undefined) {
        // Address pointer - try EventStore first, then load
        const existing = eventStore.getReplaceable(
          pointer.kind,
          pointer.pubkey,
          pointer.identifier
        );
        if (existing) {
          const key = `${pointer.kind}:${pointer.pubkey}:${pointer.identifier}`;
          resolved[key] = existing;
          resolvedCount++;
        } else {
          const relays = pointer.relays?.length > 0 ? pointer.relays : getCommunikeyRelays();
          const sub = addressLoader({
            kind: pointer.kind,
            pubkey: pointer.pubkey,
            identifier: pointer.identifier,
            relays
          }).subscribe();
          subs.push(sub);
        }
      }
    }

    // Build initial pinnedEvents from what we have
    updatePinnedEvents(resolved);

    // Periodically check for newly loaded events (simple approach)
    const checkInterval = setInterval(() => {
      let changed = false;
      for (const pointer of pinPointers) {
        if (pointer.id) {
          if (!(pointer.id in resolved)) {
            const ev = eventStore.getEvent(pointer.id);
            if (ev) {
              resolved[pointer.id] = ev;
              resolvedCount++;
              changed = true;
            }
          }
        } else if (pointer.kind !== undefined) {
          const key = `${pointer.kind}:${pointer.pubkey}:${pointer.identifier}`;
          if (!(key in resolved)) {
            const ev = eventStore.getReplaceable(pointer.kind, pointer.pubkey, pointer.identifier);
            if (ev) {
              resolved[key] = ev;
              resolvedCount++;
              changed = true;
            }
          }
        }
      }
      if (changed) updatePinnedEvents(resolved);
      // Stop checking once all resolved
      if (resolvedCount === pinPointers.length) clearInterval(checkInterval);
    }, 500);

    return () => {
      subs.forEach((s) => s.unsubscribe());
      clearInterval(checkInterval);
    };
  });

  /**
   * @param {Record<string, any>} resolved
   */
  function updatePinnedEvents(resolved) {
    // Preserve pointer order
    /** @type {Array<any>} */
    const ordered = [];
    for (const pointer of pinPointers) {
      if (pointer.id) {
        const ev = resolved[pointer.id];
        if (ev) ordered.push(ev);
      } else if (pointer.kind !== undefined) {
        const key = `${pointer.kind}:${pointer.pubkey}:${pointer.identifier}`;
        const ev = resolved[key];
        if (ev) ordered.push(ev);
      }
    }
    pinnedEvents = ordered;
  }

  /**
   * @param {number} fromIndex
   * @param {number} toIndex
   */
  async function handleReorder(fromIndex, toIndex) {
    try {
      await reorderPins(communityId, fromIndex, toIndex);
      showToast(m.pinned_reordered_toast(), 'success');
    } catch (err) {
      console.error('Reorder failed:', err);
    }
  }

  /**
   * @param {any} event
   */
  async function handleRemove(event) {
    try {
      await unpinEvent(event);
      showToast(m.pinned_removed_toast(), 'success');
    } catch (err) {
      console.error('Unpin failed:', err);
    }
  }

  async function handleAdd() {
    const input = addInput.trim();
    if (!input) return;

    try {
      const decoded = nip19.decode(input);

      if (decoded.type === 'naddr') {
        const { kind, pubkey, identifier } = /** @type {any} */ (decoded.data);
        const relays = getCommunikeyRelays();
        const sub = addressLoader({ kind, pubkey, identifier, relays }).subscribe();

        // Wait briefly for the event to load, then check EventStore
        setTimeout(async () => {
          sub.unsubscribe();
          const event = eventStore.getReplaceable(kind, pubkey, identifier);
          if (event) {
            await pinEvent(event);
            showToast(m.pinned_added_toast(), 'success');
            addInput = '';
          } else {
            showToast(m.pinned_not_found(), 'error');
          }
        }, 2000);
      } else if (decoded.type === 'nevent' || decoded.type === 'note') {
        const id =
          decoded.type === 'nevent'
            ? /** @type {any} */ (decoded.data).id
            : /** @type {string} */ (decoded.data);
        const sub = eventLoader(id).subscribe();

        setTimeout(async () => {
          sub.unsubscribe();
          const event = eventStore.getEvent(id);
          if (event) {
            await pinEvent(event);
            showToast(m.pinned_added_toast(), 'success');
            addInput = '';
          } else {
            showToast(m.pinned_not_found(), 'error');
          }
        }, 2000);
      } else {
        showToast(m.pinned_invalid_identifier(), 'error');
      }
    } catch {
      showToast(m.pinned_invalid_identifier(), 'error');
    }
  }
</script>

{#if pinPointers.length > 0 || isAdmin}
  <div class="mb-6">
    <div class="mb-2 flex items-center justify-between">
      <h3 class="text-sm font-semibold">{m.pinned_section_title()}</h3>
      {#if isAdmin}
        <button class="btn btn-ghost btn-xs" onclick={() => (isEditing = !isEditing)}>
          {isEditing ? m.pinned_edit_done() : m.pinned_edit_pins()}
        </button>
      {/if}
    </div>

    {#if pinPointers.length === 0 && isAdmin}
      <p class="text-sm text-base-content/60">{m.pinned_empty_admin()}</p>
    {:else}
      <div class="flex gap-3 overflow-x-auto pb-2">
        {#each pinnedEvents as event (event.id)}
          {@const cardData = getFeedCardData(event)}
          <button
            class="card max-w-[240px] min-w-[200px] flex-shrink-0 bg-base-200 p-3 text-left"
            onclick={() => onNavigateToEvent?.(event)}
          >
            <div class="text-xs font-medium text-primary">{cardData.typeKey}</div>
            <div class="mt-1 line-clamp-2 text-sm font-semibold">{cardData.title}</div>
            {#if cardData.description}
              <div class="mt-1 line-clamp-2 text-xs text-base-content/60">
                {cardData.description}
              </div>
            {/if}
          </button>
        {/each}
      </div>
    {/if}

    {#if isEditing}
      <div class="mt-3 space-y-2">
        {#each pinnedEvents as event, i (event.id)}
          {@const cardData = getFeedCardData(event)}
          <div class="flex items-center gap-2 rounded bg-base-200 px-3 py-2">
            <span class="flex-1 truncate text-sm">{cardData.title}</span>
            <button
              class="btn btn-ghost btn-xs"
              disabled={i === 0}
              onclick={() => handleReorder(i, i - 1)}
              aria-label="Move up"
            >
              &#9650;
            </button>
            <button
              class="btn btn-ghost btn-xs"
              disabled={i === pinnedEvents.length - 1}
              onclick={() => handleReorder(i, i + 1)}
              aria-label="Move down"
            >
              &#9660;
            </button>
            <button
              class="btn text-error btn-ghost btn-xs"
              onclick={() => handleRemove(event)}
              aria-label="Remove pin"
            >
              &#10005;
            </button>
          </div>
        {/each}

        <div class="flex gap-2">
          <input
            type="text"
            class="input-bordered input input-sm flex-1"
            placeholder={m.pinned_add_placeholder()}
            bind:value={addInput}
          />
          <button class="btn btn-sm btn-primary" onclick={handleAdd}>
            {m.pinned_add_button()}
          </button>
        </div>
      </div>
    {/if}
  </div>
{/if}
