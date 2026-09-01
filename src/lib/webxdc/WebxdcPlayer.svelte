<script>
  /**
   * Launch card + sandboxed stage for a webxdc/H5P package. Verifies the
   * archive hash before execution; state persists locally (Phase 1 AppSync).
   */
  import { onDestroy } from 'svelte';
  import * as m from '$lib/paraglide/messages';
  import { nip19 } from 'nostr-tools';
  import { manager } from '$lib/stores/accounts.svelte';
  import { useUserProfile } from '$lib/stores/user-profile.svelte.js';
  import { getDisplayName } from 'applesauce-core/helpers';
  import { fetchAndVerifyXdc, unzipXdc, XdcIntegrityError } from './xdc-archive.js';
  import { sandboxSubdomain } from './subdomain.js';
  import { createLocalSync } from './local-sync.js';
  import { createWebxdcHost } from './webxdc-host.js';
  import SandboxFrame from './SandboxFrame.svelte';
  import { CloseIcon, ExpandIcon, CollapseIcon, ExternalLinkIcon } from '$lib/components/icons';

  let {
    url = '',
    sha256 = '',
    bytes = null,
    name = '',
    iconUrl = '',
    appKey,
    sync = null,
    onShareFile = null,
    // `fill`: stretch the running stage to the height a flex parent grants it
    // (channel takeover) instead of the standalone 4/3 card.
    fill = false,
    // Host-owned close (e.g. GroupAppStage unmounts the whole stage). The
    // player then renders ONE close button instead of stacking its own under
    // the host's.
    onClose = null,
    onOpenInNewTab = null
  } = $props();

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

  // Reactive profile for the active pubkey; identity() reads it synchronously
  // at launch time (see below).
  const getOwnProfile = useUserProfile(() => manager.active?.pubkey);

  function identity() {
    const pubkey = manager.active?.pubkey;
    if (!pubkey) return { selfAddr: 'anonymous', selfName: 'Anonymous' };
    const npub = nip19.npubEncode(pubkey);
    // selfAddr stays the full npub — STABLE identity the editor derives user
    // colors from; do not change. selfName MAY map to the user's display
    // name (NIP-DC flow §6) and is captured once per launch: a profile that
    // loads mid-session applies on the next launch, which is acceptable.
    return {
      selfAddr: npub,
      selfName: getDisplayName(getOwnProfile(), npub.slice(0, 12) + '…')
    };
  }

  /** Default sendToChat handling outside a channel: save the file locally.
   * @param {{name: string, plainText?: string, base64?: string, mime?: string}} file */
  function downloadShare(file) {
    const blob =
      typeof file.plainText === 'string'
        ? new Blob([file.plainText], { type: 'text/plain' })
        : new Blob([Uint8Array.from(atob(file.base64 ?? ''), (c) => c.charCodeAt(0))], {
            type: file.mime || 'application/octet-stream'
          });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = file.name;
    a.click();
    URL.revokeObjectURL(a.href);
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
      const appSync = sync ?? createLocalSync(`webxdc:state:${appKey}`);
      host = createWebxdcHost(appSync, identity(), { onShareFile: onShareFile ?? downloadShare });
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

<svelte:window
  onkeydown={(e) => {
    if (fullscreen && e.key === 'Escape') fullscreen = false;
  }}
/>

{#snippet header(/** @type {boolean} */ running)}
  <div class="flex items-center gap-2 border-b border-base-300 bg-base-200 px-3 py-1.5">
    {#if iconUrl}<img src={iconUrl} alt="" class="size-5 shrink-0 rounded" />{/if}
    <span class="flex-1 truncate text-sm font-semibold">{name || m.webxdc_app_type()}</span>
    {#if running && onOpenInNewTab && !fullscreen}
      <button
        type="button"
        class="btn btn-square btn-ghost btn-xs"
        data-testid="webxdc-newtab"
        title={m.webxdc_open_new_tab()}
        aria-label={m.webxdc_open_new_tab()}
        onclick={onOpenInNewTab}
      >
        <ExternalLinkIcon class_="w-4 h-4" title="" />
      </button>
    {/if}
    {#if running}
      <button
        type="button"
        class="btn btn-square btn-ghost btn-xs"
        data-testid="webxdc-fullscreen"
        title={fullscreen ? m.webxdc_exit_fullscreen() : m.webxdc_fullscreen()}
        aria-label={fullscreen ? m.webxdc_exit_fullscreen() : m.webxdc_fullscreen()}
        onclick={() => (fullscreen = !fullscreen)}
      >
        {#if fullscreen}<CollapseIcon class_="w-4 h-4" title="" />{:else}<ExpandIcon
            class_="w-4 h-4"
            title=""
          />{/if}
      </button>
    {/if}
    <button
      type="button"
      class="btn btn-square btn-ghost btn-xs"
      data-testid="webxdc-close"
      title={m.webxdc_close()}
      aria-label={m.webxdc_close()}
      onclick={onClose ?? close}
    >
      <CloseIcon class_="w-4 h-4" title="" />
    </button>
  </div>
{/snippet}

{#if phase === 'running' && files && host}
  <div
    class={fullscreen
      ? 'fixed inset-0 z-[80] flex flex-col bg-base-100'
      : fill
        ? 'flex min-h-0 flex-1 flex-col overflow-hidden'
        : 'overflow-hidden rounded-xl border border-base-300'}
  >
    {@render header(true)}
    {#key filesReady}
      <SandboxFrame
        id={subdomain}
        {files}
        bridgeScript={host.bridgeScript}
        onRpc={host.handleRpc}
        {onFrameReady}
        class_={fullscreen || fill ? 'min-h-0 w-full flex-1' : 'w-full aspect-[4/3]'}
      />
    {/key}
  </div>
{:else if phase === 'error'}
  <!-- fill hosts auto-launch, so their error/launch states must still offer
       the header's close — otherwise a failed launch strands the stage. -->
  {#if fill && onClose}{@render header(false)}{/if}
  <div class="rounded-xl border border-error/40 bg-error/5 p-4 text-sm" class:m-3={fill}>
    {#if errorKind === 'integrity'}{m.webxdc_error_integrity()}
    {:else if errorKind === 'invalid'}{m.webxdc_error_invalid()}
    {:else if errorKind === 'timeout'}{m.webxdc_error_timeout()}
    {:else}{m.webxdc_error_fetch()}{/if}
    <button class="btn mt-2 btn-sm" onclick={launch}>{m.webxdc_retry()}</button>
  </div>
{:else}
  {#if fill && onClose}{@render header(false)}{/if}
  <div
    class="flex max-w-md items-center gap-3 rounded-xl border border-base-300 bg-base-100 p-3"
    class:m-3={fill}
  >
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
