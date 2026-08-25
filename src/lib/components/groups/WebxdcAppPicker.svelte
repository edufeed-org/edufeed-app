<!--
  WebxdcAppPicker — modal opened by ChatComposer's "+" apps button. Lists the
  curated "pad" app (from config, when set) first, then a one-shot discovery
  REQ across the educational relays for published kind-1063 webxdc apps
  (NIP-DC discovery, see CLAUDE.md's Interactive Resources section). Picking a
  row hands the app back to the caller (GroupChat.shareApp), which mints a
  session and publishes the kind-9 share.
-->
<script>
  import { pool } from '$lib/stores/nostr-infrastructure.svelte';
  import { getEducationalRelays } from '$lib/helpers/relay-helper.js';
  import { WEBXDC_MIME } from '$lib/webxdc/session-events.js';
  import { timer } from 'rxjs';
  import { takeUntil, toArray } from 'rxjs/operators';
  import * as m from '$lib/paraglide/messages';

  /**
   * @typedef {{url: string, sha256: string, name: string, iconUrl: string}} XdcApp
   * @typedef {Object} Props
   * @property {XdcApp | null} padApp
   * @property {(app: XdcApp) => void} onSelect
   * @property {() => void} onClose
   */

  /** @type {Props} */
  let { padApp, onSelect, onClose } = $props();

  /** @type {XdcApp[]} */
  let discovered = $state.raw([]);
  let loading = $state(true);

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
          const tag = (/** @type {string} */ n) =>
            ev.tags.find((/** @type {any} */ t) => t[0] === n)?.[1];
          const x = tag('x');
          const url = tag('url');
          if (!x || !url || byHash.has(x)) continue;
          byHash.set(x, {
            url,
            sha256: x,
            name:
              tag('alt')?.replace(/^Webxdc app: /, '') ||
              tag('title') ||
              url.split('/').pop() ||
              url,
            iconUrl: tag('image') || ''
          });
        }
        discovered = [...byHash.values()];
        loading = false;
      });
    return () => sub.unsubscribe();
  });
</script>

<div class="modal-open modal" data-testid="webxdc-app-picker">
  <div class="modal-box max-w-sm">
    <h3 class="text-lg font-bold">{m.webxdc_apps_pick_title()}</h3>

    <div class="mt-4 flex flex-col gap-1">
      {#if padApp}
        <button
          type="button"
          class="btn justify-start btn-ghost"
          data-testid="webxdc-app-picker-pad"
          onclick={() => onSelect(padApp)}
        >
          {#if padApp.iconUrl}
            <img src={padApp.iconUrl} alt="" class="h-5 w-5 rounded" />
          {/if}
          {m.webxdc_apps_start_pad()}
        </button>
      {/if}

      {#each discovered as app (app.sha256)}
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

      {#if !loading && !padApp && discovered.length === 0}
        <p class="px-2 py-4 text-center text-sm opacity-70">{m.webxdc_apps_none()}</p>
      {/if}
    </div>

    <div class="modal-action">
      <button type="button" class="btn btn-sm" onclick={onClose}>{m.webxdc_close()}</button>
    </div>
  </div>
</div>
