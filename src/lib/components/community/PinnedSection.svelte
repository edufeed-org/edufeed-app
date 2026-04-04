<script>
  import * as m from '$lib/paraglide/messages.js';
  import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
  import { addressLoader, eventLoader } from '$lib/loaders';
  import { CommunityPinListModel } from '$lib/models/pin-list.js';
  import { getFeedCardData } from '$lib/helpers/feedCardData.js';
  import { unpinEvent, reorderPins, pinEvent } from '$lib/services/pin-list-service.js';
  import { showToast } from '$lib/helpers/toast.js';
  import { getCommunikeyRelays } from '$lib/helpers/relay-helper.js';
  import { generateKindColorRGB } from '$lib/helpers/nostrUtils.js';
  import { nip19 } from 'nostr-tools';

  let { communityId, isAdmin = false, onNavigateToEvent } = $props();

  /**
   * @param {string} startStr
   * @returns {string}
   */
  function formatCalendarSubtitle(startStr) {
    const num = Number(startStr);
    if (!isNaN(num) && num > 0) {
      return new Date(num * 1000).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit'
      });
    }
    return startStr;
  }

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
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- local to $effect, not reactive
    const resolved = new Map();
    let unresolvedEventPointers = 0;

    function rebuildPinnedEvents() {
      /** @type {Array<any>} */
      const ordered = [];
      for (const pointer of pinPointers) {
        const key = pointer.id || `${pointer.kind}:${pointer.pubkey}:${pointer.identifier}`;
        const ev = resolved.get(key);
        if (ev) ordered.push(ev);
      }
      ordered.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
      pinnedEvents = ordered;
    }

    for (const pointer of pinPointers) {
      if (pointer.id) {
        // Event pointer — load via eventLoader, check synchronously
        const existing = eventStore.getEvent(pointer.id);
        if (existing) {
          resolved.set(pointer.id, existing);
        } else {
          unresolvedEventPointers++;
          const loaderSub = eventLoader({ id: pointer.id, relays: pointer.relays }).subscribe();
          subs.push(loaderSub);
        }
      } else if (pointer.kind !== undefined) {
        // Address pointer — load + subscribe reactively via replaceable()
        const relays = pointer.relays?.length > 0 ? pointer.relays : getCommunikeyRelays();
        const loaderSub = addressLoader({
          kind: pointer.kind,
          pubkey: pointer.pubkey,
          identifier: pointer.identifier,
          relays
        }).subscribe();
        subs.push(loaderSub);
        const key = `${pointer.kind}:${pointer.pubkey}:${pointer.identifier}`;
        const modelSub = eventStore
          .replaceable(pointer.kind, pointer.pubkey, pointer.identifier)
          .subscribe((ev) => {
            if (ev) {
              resolved.set(key, ev);
              rebuildPinnedEvents();
            }
          });
        subs.push(modelSub);
      }
    }

    rebuildPinnedEvents();

    // For event pointers (no observable API), poll briefly until resolved
    /** @type {ReturnType<typeof setInterval> | undefined} */
    let checkInterval;
    if (unresolvedEventPointers > 0) {
      let checks = 0;
      checkInterval = setInterval(() => {
        let changed = false;
        for (const pointer of pinPointers) {
          if (pointer.id && !resolved.has(pointer.id)) {
            const ev = eventStore.getEvent(pointer.id);
            if (ev) {
              resolved.set(pointer.id, ev);
              unresolvedEventPointers--;
              changed = true;
            }
          }
        }
        if (changed) rebuildPinnedEvents();
        checks++;
        if (unresolvedEventPointers === 0 || checks > 20) clearInterval(checkInterval);
      }, 250);
    }

    return () => {
      subs.forEach((s) => s.unsubscribe());
      if (checkInterval) clearInterval(checkInterval);
    };
  });

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

  let isAdding = $state(false);

  async function handleAdd() {
    const input = addInput.trim();
    if (!input || isAdding) return;

    isAdding = true;

    try {
      const decoded = nip19.decode(input);

      if (decoded.type === 'naddr') {
        const { kind, pubkey, identifier } = /** @type {any} */ (decoded.data);
        const relays = getCommunikeyRelays();
        const event = await loadAndResolve(
          () => addressLoader({ kind, pubkey, identifier, relays }),
          () => eventStore.getReplaceable(kind, pubkey, identifier)
        );
        if (event) {
          await pinEvent(event);
          showToast(m.pinned_added_toast(), 'success');
          addInput = '';
        } else {
          showToast(m.pinned_not_found(), 'error');
        }
      } else if (decoded.type === 'nevent' || decoded.type === 'note') {
        const id =
          decoded.type === 'nevent'
            ? /** @type {any} */ (decoded.data).id
            : /** @type {string} */ (decoded.data);
        const event = await loadAndResolve(
          () => eventLoader(id),
          () => eventStore.getEvent(id)
        );
        if (event) {
          await pinEvent(event);
          showToast(m.pinned_added_toast(), 'success');
          addInput = '';
        } else {
          showToast(m.pinned_not_found(), 'error');
        }
      } else {
        showToast(m.pinned_invalid_identifier(), 'error');
      }
    } catch {
      showToast(m.pinned_invalid_identifier(), 'error');
    } finally {
      isAdding = false;
    }
  }

  /**
   * Start a loader and poll the EventStore until the event appears or timeout.
   * @param {() => {subscribe: Function}} startLoader
   * @param {() => any} getEvent
   * @param {number} [timeout=5000]
   * @returns {Promise<any>}
   */
  function loadAndResolve(startLoader, getEvent, timeout = 5000) {
    return new Promise((resolve) => {
      const sub = startLoader().subscribe();
      const start = Date.now();
      const check = setInterval(() => {
        const ev = getEvent();
        if (ev) {
          clearInterval(check);
          sub.unsubscribe();
          resolve(ev);
        } else if (Date.now() - start > timeout) {
          clearInterval(check);
          sub.unsubscribe();
          resolve(null);
        }
      }, 200);
    });
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
      <div class="flex flex-wrap gap-3">
        {#each pinnedEvents as event (event.id)}
          {@const cardData = getFeedCardData(event)}
          {@const kindColor = generateKindColorRGB(event.kind)}
          <button
            class="w-[200px] max-w-[240px] rounded-lg border border-l-4 border-base-300 bg-base-100 p-3 text-left shadow-sm transition-shadow hover:border-primary hover:shadow-md"
            style:border-left-color="rgb({kindColor.r},{kindColor.g},{kindColor.b})"
            onclick={() => onNavigateToEvent?.(event)}
          >
            <div class="text-xs font-medium text-primary">{cardData.typeKey}</div>
            <div class="mt-1 line-clamp-2 text-sm font-semibold">{cardData.title}</div>
            {#if cardData.typeKey === 'calendar' && cardData.subtitle}
              <div class="mt-1 text-xs text-base-content/60">
                {formatCalendarSubtitle(cardData.subtitle)}
              </div>
            {/if}
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
