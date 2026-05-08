<!--
  AMBResourceSearchInput — inline NIP-50 search picker for AMB resources
  (kind 30142). Mirrors the shape of ContactSearchInput.svelte:

    - debounced search via `ambSearchLoader`
    - synthetic "paste" row when the typed value is a valid kind-30142 naddr
    - keyboard nav (ArrowUp/Down, Enter, Escape)
    - emits a ref object with the coordinate, author, d-tag, optional relay
      hint and the resolved event

  Rows are rendered inline (not via AMBResourceCard) to keep the picker
  self-contained and to avoid AMBResourceCard's built-in `navigateToDetail`
  click handler stealing the row click.
-->
<script>
  import { nip19 } from 'nostr-tools';
  import { getSeenRelays } from 'applesauce-core/helpers';
  import { ambSearchLoader } from '$lib/loaders/amb-search.js';
  import { fetchEventById } from '$lib/helpers/nostrUtils.js';
  import * as m from '$lib/paraglide/messages.js';

  /**
   * @typedef {{
   *   coordinate: string,
   *   pubkey: string,
   *   dTag: string,
   *   relayHint?: string | undefined,
   *   event: import('nostr-tools').NostrEvent
   * }} AMBPickerRef
   */

  /**
   * @type {{
   *   exclude?: string[],
   *   excludeSelf?: string | undefined,
   *   placeholder?: string,
   *   onselect: (ref: AMBPickerRef) => void
   * }}
   */
  let { exclude = [], excludeSelf = undefined, placeholder = '', onselect } = $props();

  /**
   * @typedef {{kind:'result', event: import('nostr-tools').NostrEvent, coordinate: string, name: string}} ResultItem
   * @typedef {{kind:'paste', coordinate: string, pointer: {kind:number,pubkey:string,identifier:string,relays?:string[]}}} PasteItem
   * @typedef {ResultItem | PasteItem} NavItem
   */

  /** @type {import('nostr-tools').NostrEvent[]} */
  let results = $state.raw([]);
  let query = $state('');
  let selectedIndex = $state(-1);
  let showDropdown = $state(false);
  let searching = $state(false);
  /** @type {{kind:number,pubkey:string,identifier:string,relays?:string[]} | null} */
  let pastePointer = $state(null);

  /** @type {import('rxjs').Subscription | undefined} */
  let sub;
  /** @type {any} */
  let timer;

  /** @param {import('nostr-tools').NostrEvent} event */
  function coordinateOf(event) {
    if (!event) return '';
    const dTag = event.tags?.find((t) => t[0] === 'd')?.[1] || '';
    return `${event.kind}:${event.pubkey}:${dTag}`;
  }

  /** @param {string} input */
  function tryDecodeAMBNaddr(input) {
    const trimmed = (input || '').trim();
    if (!trimmed.startsWith('naddr1')) return null;
    try {
      const decoded = nip19.decode(trimmed);
      if (decoded.type !== 'naddr') return null;
      const data = /** @type {any} */ (decoded.data);
      if (data.kind !== 30142) return null;
      return data;
    } catch {
      return null;
    }
  }

  /** @param {string} term */
  function runSearch(term) {
    selectedIndex = -1;
    pastePointer = tryDecodeAMBNaddr(term);

    if (sub) {
      sub.unsubscribe();
      sub = undefined;
    }

    const trimmed = (term || '').trim();
    if (trimmed.length < 2) {
      results = [];
      searching = false;
      showDropdown = false;
      return;
    }

    searching = true;
    /** @type {import('nostr-tools').NostrEvent[]} */
    const collected = [];
    sub = ambSearchLoader({ searchText: trimmed }, 20).subscribe({
      next: (ev) => {
        collected.push(/** @type {any} */ (ev));
      },
      complete: () => {
        searching = false;
        results = collected;
        showDropdown = collected.length > 0 || pastePointer != null;
      },
      error: () => {
        searching = false;
      }
    });
  }

  /** @param {Event} e */
  function onInput(e) {
    const target = /** @type {HTMLInputElement} */ (e.currentTarget);
    query = target.value;
    clearTimeout(timer);
    timer = setTimeout(() => runSearch(query), 300);
  }

  const navItems = $derived.by(() => {
    /** @type {NavItem[]} */
    const items = [];
    for (const ev of results) {
      const coord = coordinateOf(ev);
      if (!coord) continue;
      if (exclude.includes(coord)) continue;
      if (excludeSelf && coord === excludeSelf) continue;
      const name = ev.tags?.find((t) => t[0] === 'name')?.[1] || 'Untitled';
      items.push({ kind: 'result', event: ev, coordinate: coord, name });
    }

    if (pastePointer) {
      const pasteCoord = `${pastePointer.kind}:${pastePointer.pubkey}:${pastePointer.identifier ?? ''}`;
      const already = items.some((it) => it.coordinate === pasteCoord);
      const blocked = exclude.includes(pasteCoord) || (!!excludeSelf && pasteCoord === excludeSelf);
      if (!already && !blocked) {
        items.push({ kind: 'paste', coordinate: pasteCoord, pointer: pastePointer });
      }
    }

    return items;
  });

  /** @param {NavItem} item */
  async function selectItem(item) {
    showDropdown = false;
    selectedIndex = -1;
    query = '';
    results = [];
    pastePointer = null;

    /** @type {import('nostr-tools').NostrEvent | null} */
    let event = null;
    if (item.kind === 'result') {
      event = item.event;
    } else {
      const naddr = nip19.naddrEncode(item.pointer);
      event = /** @type {any} */ (await fetchEventById(naddr));
      if (!event) return;
    }

    const coordinate = coordinateOf(event);
    const dTag = event.tags?.find((t) => t[0] === 'd')?.[1] ?? '';
    const seen = getSeenRelays(/** @type {any} */ (event));
    const relayHint = seen && seen.size > 0 ? seen.values().next().value : undefined;

    onselect({
      coordinate,
      pubkey: event.pubkey,
      dTag,
      relayHint,
      event
    });
  }

  /** @param {KeyboardEvent} e */
  function onKeydown(e) {
    if (!showDropdown || navItems.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectedIndex = Math.min(selectedIndex + 1, navItems.length - 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectedIndex = Math.max(selectedIndex - 1, -1);
    } else if (e.key === 'Enter' && selectedIndex >= 0) {
      e.preventDefault();
      void selectItem(navItems[selectedIndex]);
    } else if (e.key === 'Escape') {
      showDropdown = false;
      selectedIndex = -1;
    }
  }

  function onBlur() {
    setTimeout(() => {
      showDropdown = false;
    }, 200);
  }
</script>

<div class="relative">
  <input
    type="text"
    class="input-bordered input w-full"
    {placeholder}
    bind:value={query}
    oninput={onInput}
    onkeydown={onKeydown}
    onblur={onBlur}
  />

  {#if showDropdown && navItems.length > 0}
    <div
      class="absolute z-50 mt-1 max-h-96 w-full overflow-y-auto rounded-lg border border-base-300 bg-base-100 shadow-lg"
      style="top: 100%;"
    >
      {#each navItems as item, i (item.kind + ':' + item.coordinate)}
        <button
          type="button"
          class="block w-full border-b border-base-200 px-3 py-2 text-left transition-colors last:border-b-0 hover:bg-base-200"
          class:bg-base-200={i === selectedIndex}
          onmousedown={(e) => e.preventDefault()}
          onclick={() => selectItem(item)}
        >
          {#if item.kind === 'result'}
            <div class="truncate text-sm font-medium">{item.name}</div>
            <div class="truncate font-mono text-xs text-base-content/60">{item.coordinate}</div>
          {:else}
            <div class="text-sm font-medium">{m.amb_picker_paste_row_label()}</div>
            <div class="truncate font-mono text-xs text-base-content/60">{item.coordinate}</div>
          {/if}
        </button>
      {/each}
    </div>
  {/if}

  {#if searching}
    <div class="label py-0">
      <span class="label-text-alt flex items-center gap-1 text-xs text-base-content/60">
        <span class="loading loading-xs loading-spinner"></span>
      </span>
    </div>
  {/if}
</div>
