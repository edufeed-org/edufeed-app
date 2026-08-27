<!--
  WebxdcAppPicker — modal opened by ChatComposer's "+" apps button. Two
  sections: "Empfohlen" (curatedApps, resolved from kind-1063 event refs —
  nevent or hex id — via a batched pool.request by id; first entry rendered
  in the prominent "Starten" style) and "Weitere Apps" (a one-shot discovery
  REQ across the educational relays for published kind-1063 webxdc apps,
  minus anything already curated — see CLAUDE.md's Interactive Resources
  section). Picking a row hands the app back to the caller
  (GroupChat.shareApp), which mints a session and publishes the kind-9 share.
-->
<script>
  import { nip19 } from 'nostr-tools';
  import { pool } from '$lib/stores/nostr-infrastructure.svelte';
  import { getEducationalRelays, getAllLookupRelays } from '$lib/helpers/relay-helper.js';
  import { WEBXDC_MIME, appFromFileEvent } from '$lib/webxdc/session-events.js';
  import { timer } from 'rxjs';
  import { takeUntil, toArray } from 'rxjs/operators';
  import * as m from '$lib/paraglide/messages';

  /**
   * @typedef {{url: string, sha256: string, name: string, iconUrl: string}} XdcApp
   * @typedef {Object} Props
   * @property {string[]} curatedApps ordered kind-1063 event refs (nevent or hex id)
   * @property {(app: XdcApp) => void} onSelect
   * @property {() => void} onClose
   */

  /** @type {Props} */
  let { curatedApps, onSelect, onClose } = $props();

  /** @type {XdcApp[]} */
  let curated = $state.raw([]);
  let curatedLoading = $state(true);

  /** @type {XdcApp[]} */
  let discovered = $state.raw([]);
  let loading = $state(true);

  /** @param {string} ref @returns {{id: string, relays: string[]} | null} */
  function decodeRef(ref) {
    if (/^[0-9a-f]{64}$/i.test(ref)) return { id: ref.toLowerCase(), relays: [] };
    try {
      const decoded = nip19.decode(ref);
      if (decoded.type === 'nevent') {
        return { id: decoded.data.id, relays: decoded.data.relays || [] };
      }
    } catch (err) {
      console.warn(`WebxdcAppPicker: could not decode curated ref "${ref}"`, err);
    }
    return null;
  }

  $effect(() => {
    const refs = curatedApps ?? [];
    if (refs.length === 0) {
      curated = [];
      curatedLoading = false;
      return;
    }
    curatedLoading = true;
    const decoded = /** @type {Array<{id: string, relays: string[]}>} */ (
      refs.map(decodeRef).filter(Boolean)
    );
    if (decoded.length === 0) {
      curated = [];
      curatedLoading = false;
      return;
    }
    const relays = [...new Set([...getAllLookupRelays(), ...decoded.flatMap((d) => d.relays)])];
    const sub = pool
      .request(relays, [{ ids: decoded.map((d) => d.id) }])
      .pipe(takeUntil(timer(5000)), toArray())
      .subscribe((events) => {
        /** @type {Map<string, XdcApp>} */
        // eslint-disable-next-line svelte/prefer-svelte-reactivity
        const byId = new Map();
        for (const ev of events) {
          const app = appFromFileEvent(ev);
          if (app) byId.set(ev.id, app);
        }
        /** @type {XdcApp[]} */
        const resolved = [];
        for (const d of decoded) {
          const app = byId.get(d.id);
          if (app) resolved.push(app);
          else console.warn(`WebxdcAppPicker: could not resolve curated app "${d.id}"`);
        }
        curated = resolved;
        curatedLoading = false;
      });
    return () => sub.unsubscribe();
  });

  $effect(() => {
    const sub = pool
      .request(getEducationalRelays(), [{ kinds: [1063], '#m': [WEBXDC_MIME], limit: 50 }])
      .pipe(takeUntil(timer(3000)), toArray())
      .subscribe((events) => {
        // Plain Map, not SvelteMap: local to this one subscription callback,
        // never read reactively — only its final `.values()` snapshot escapes
        // into `discovered` ($state.raw) below.
        /** @type {Map<string, XdcApp>} */
        // eslint-disable-next-line svelte/prefer-svelte-reactivity
        const byHash = new Map();
        for (const ev of [...events].sort((a, b) => b.created_at - a.created_at)) {
          const app = appFromFileEvent(ev);
          if (app && !byHash.has(app.sha256)) byHash.set(app.sha256, app);
        }
        discovered = [...byHash.values()];
        loading = false;
      });
    return () => sub.unsubscribe();
  });

  const curatedHashes = $derived(new Set(curated.map((a) => a.sha256)));
  const discoveredFiltered = $derived(discovered.filter((a) => !curatedHashes.has(a.sha256)));
</script>

<div class="modal-open modal" data-testid="webxdc-app-picker">
  <div class="modal-box max-w-sm">
    <h3 class="text-lg font-bold">{m.webxdc_apps_pick_title()}</h3>

    <div class="mt-4 flex flex-col gap-1">
      {#if curated.length > 0}
        <p class="px-2 text-xs font-semibold tracking-wide uppercase opacity-60">
          {m.webxdc_apps_featured()}
        </p>
        {#each curated as app, i (app.sha256)}
          {#if i === 0}
            <button
              type="button"
              class="btn justify-start btn-primary"
              data-testid="webxdc-app-picker-featured"
              onclick={() => onSelect(app)}
            >
              {#if app.iconUrl}
                <img src={app.iconUrl} alt="" class="h-5 w-5 rounded" />
              {/if}
              <span class="flex-1 truncate text-left">{app.name}</span>
              <span class="text-xs">{m.webxdc_launch()}</span>
            </button>
          {:else}
            <button
              type="button"
              class="btn justify-start btn-ghost"
              data-testid="webxdc-app-picker-row"
              onclick={() => onSelect(app)}
            >
              {#if app.iconUrl}
                <img src={app.iconUrl} alt="" class="h-5 w-5 rounded" />
              {/if}
              {app.name}
            </button>
          {/if}
        {/each}
      {/if}

      {#if discoveredFiltered.length > 0}
        <p class="mt-2 px-2 text-xs font-semibold tracking-wide uppercase opacity-60">
          {m.webxdc_apps_discovered()}
        </p>
        {#each discoveredFiltered as app (app.sha256)}
          <button
            type="button"
            class="btn justify-start btn-ghost"
            data-testid="webxdc-app-picker-row"
            onclick={() => onSelect(app)}
          >
            {#if app.iconUrl}
              <img src={app.iconUrl} alt="" class="h-5 w-5 rounded" />
            {/if}
            {app.name}
          </button>
        {/each}
      {/if}

      {#if !loading && !curatedLoading && curated.length === 0 && discoveredFiltered.length === 0}
        <p class="px-2 py-4 text-center text-sm opacity-70">{m.webxdc_apps_none()}</p>
      {/if}
    </div>

    <div class="modal-action">
      <button type="button" class="btn btn-sm" onclick={onClose}>{m.webxdc_close()}</button>
    </div>
  </div>
</div>
