<script>
  /**
   * Launch card + sandboxed stage for a webxdc/H5P package. Verifies the
   * archive hash before execution; state persists locally (Phase 1 AppSync).
   */
  import { onDestroy } from 'svelte';
  import * as m from '$lib/paraglide/messages';
  import { nip19 } from 'nostr-tools';
  import { manager } from '$lib/stores/accounts.svelte';
  import { fetchAndVerifyXdc, unzipXdc, XdcIntegrityError } from './xdc-archive.js';
  import { sandboxSubdomain } from './subdomain.js';
  import { createLocalSync } from './local-sync.js';
  import { createWebxdcHost } from './webxdc-host.js';
  import SandboxFrame from './SandboxFrame.svelte';

  let { url = '', sha256 = '', bytes = null, name = '', iconUrl = '', appKey } = $props();

  const READY_TIMEOUT_MS = 15000;

  /** @type {'idle' | 'loading' | 'running' | 'error'} */
  let phase = $state('idle');
  let errorKind = $state(/** @type {'fetch'|'integrity'|'invalid'|'timeout'|null} */ (null));
  let fullscreen = $state(false);
  // Archive + host are plain refs — they never drive template updates directly.
  // Invariant: every write to files/host is followed by a $state write in the
  // same tick (keeps template reads fresh despite non-reactive refs).
  /** @type {Map<string, Uint8Array> | null} */
  let files = null;
  /** @type {ReturnType<typeof createWebxdcHost> | null} */
  let host = null;
  /** @type {(() => void) | null} */
  let stopHost = null;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let readyTimer;
  let filesReady = $state(0); // bump to re-render the frame after async load

  const subdomain = $derived(sandboxSubdomain(appKey));

  function identity() {
    const pubkey = manager.active?.pubkey;
    if (!pubkey) return { selfAddr: 'anonymous', selfName: 'Anonymous' };
    const npub = nip19.npubEncode(pubkey);
    return { selfAddr: npub, selfName: npub.slice(0, 12) + '…' };
  }

  async function launch() {
    phase = 'loading';
    errorKind = null;
    try {
      if (bytes) {
        files = unzipXdc(bytes);
        if (!files.get('index.html')) throw new Error('missing index.html');
      } else {
        files = await fetchAndVerifyXdc(url, sha256);
      }
      const sync = createLocalSync(`webxdc:state:${appKey}`);
      host = createWebxdcHost(sync, identity());
      filesReady++;
      phase = 'running';
      // A frame that never completes the ready/init handshake would leave a
      // blank stage — surface it as a retryable error instead.
      clearTimeout(readyTimer);
      readyTimer = setTimeout(() => {
        if (phase === 'running' && !stopHost) {
          close();
          errorKind = 'timeout';
          phase = 'error';
        }
      }, READY_TIMEOUT_MS);
    } catch (err) {
      errorKind =
        err instanceof XdcIntegrityError
          ? 'integrity'
          : /index\.html/.test(String(err))
            ? 'invalid'
            : 'fetch';
      phase = 'error';
    }
  }

  /** Exposed on the component instance (bind:this) so callers elsewhere on
   *  the page — e.g. the uploaded-files row's "Anzeigen" action — can launch
   *  the same player instead of duplicating the launch flow. */
  export function launchApp() {
    return launch();
  }

  function close() {
    clearTimeout(readyTimer);
    stopHost?.();
    stopHost = null;
    host = null;
    files = null;
    fullscreen = false;
    phase = 'idle';
  }

  /** @param {(msg: object) => void} post */
  function onFrameReady(post) {
    clearTimeout(readyTimer);
    stopHost?.();
    stopHost = host?.start(post) ?? null;
  }

  // Unmounting mid-run must not leak the ready timer or the sync subscription.
  onDestroy(() => close());
</script>

{#if phase === 'running' && files && host}
  <div
    class={fullscreen
      ? 'fixed inset-0 z-50 flex flex-col bg-base-100'
      : 'overflow-hidden rounded-xl border border-base-300'}
  >
    <div class="flex items-center gap-2 bg-base-200 px-3 py-1.5">
      <span class="flex-1 truncate text-sm font-semibold">{name || m.webxdc_app_type()}</span>
      <button class="btn btn-xs" onclick={() => (fullscreen = !fullscreen)}
        >{m.webxdc_fullscreen()}</button
      >
      <button class="btn btn-xs" onclick={close}>{m.webxdc_close()}</button>
    </div>
    {#key filesReady}
      <SandboxFrame
        id={subdomain}
        {files}
        bridgeScript={host.bridgeScript}
        onRpc={host.handleRpc}
        {onFrameReady}
        class_={fullscreen ? 'flex-1 w-full' : 'w-full aspect-[4/3]'}
      />
    {/key}
  </div>
{:else if phase === 'error'}
  <div class="rounded-xl border border-error/40 bg-error/5 p-4 text-sm">
    {#if errorKind === 'integrity'}{m.webxdc_error_integrity()}
    {:else if errorKind === 'invalid'}{m.webxdc_error_invalid()}
    {:else if errorKind === 'timeout'}{m.webxdc_error_timeout()}
    {:else}{m.webxdc_error_fetch()}{/if}
    <button class="btn mt-2 btn-sm" onclick={launch}>{m.webxdc_retry()}</button>
  </div>
{:else}
  <div class="flex max-w-md items-center gap-3 rounded-xl border border-base-300 bg-base-100 p-3">
    <div
      class="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-primary/10"
    >
      {#if iconUrl}<img src={iconUrl} alt="" class="size-full object-cover" />{:else}▦{/if}
    </div>
    <div class="min-w-0 flex-1">
      <p class="truncate text-sm font-semibold">{name || m.webxdc_app_type()}</p>
      <p class="text-xs text-base-content/60">{m.webxdc_app_type()}</p>
    </div>
    <button class="btn btn-sm btn-primary" onclick={launch} disabled={phase === 'loading'}>
      {phase === 'loading' ? m.webxdc_loading() : m.webxdc_launch()}
    </button>
  </div>
{/if}
