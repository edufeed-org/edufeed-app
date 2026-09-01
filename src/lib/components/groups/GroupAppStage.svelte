<script>
  /**
   * Hosts a webxdc session shared in a group channel, above the timeline. The
   * session's AppSync is relay-backed (createGroupSync, Task 3) rather than
   * the solo localStorage sync WebxdcPlayer falls back to — that's what makes
   * this a *shared* session instead of each viewer running their own copy.
   *
   * `selfPubkey` (controller ruling, deviates from the original brief):
   * createGroupSync as merged filters realtime frames by the caller's own
   * pubkey, so it needs to know who "self" is — GroupChat passes its
   * existing `myPubkey`.
   *
   * `authenticate` (optional): forwarded straight into createGroupSync's own
   * one-shot read retry — GroupChat's proactive NIP-42 auth on mount usually
   * wins the race, but this session's own first read can still land before
   * that handshake resolves, and this is the fallback for that case.
   */
  import { onDestroy } from 'svelte';
  import * as m from '$lib/paraglide/messages';
  import { pool } from '$lib/stores/nostr-infrastructure.svelte';
  import { createGroupSync } from '$lib/webxdc/group-sync.js';
  import WebxdcPlayer from '$lib/webxdc/WebxdcPlayer.svelte';

  /** @type {{pointer: any, session: any, selfPubkey?: string,
   *          publish: (t: any) => Promise<any>,
   *          authenticate?: () => Promise<any>,
   *          onShareText: (file: {name: string, plainText: string}) => void,
   *          onClose: () => void,
   *          onOpenInNewTab?: (() => void) | null}} */
  let {
    pointer,
    session,
    selfPubkey,
    publish,
    authenticate,
    onShareText,
    onClose,
    onOpenInNewTab
  } = $props();

  // Read failures (backfill/live-sub) and write failures (state publish) are
  // shown separately: a read failure means the session may be showing stale
  // or empty state, a write failure means a local change didn't make it out
  // — different messages, and no reason for one to clobber the other.
  let loadError = $state('');
  let publishError = $state('');
  const sync = createGroupSync({
    relayConn: pool.relay(pointer.relay),
    groupId: pointer.id,
    sessionId: session.sessionId,
    publish,
    onError: (err, phase) => {
      const message = err instanceof Error ? err.message : String(err);
      if (phase === 'read') loadError = message;
      else publishError = message;
    },
    selfPubkey,
    authenticate
  });
  onDestroy(() => sync.stop());

  /** @type {any} */
  let player;
  // Auto-launch: the stage exists because the user clicked Launch already.
  $effect(() => {
    player?.launchApp();
  });

  /** @param {{name: string, plainText?: string, base64?: string, mime?: string}} file */
  function handleShareFile(file) {
    if (typeof file.plainText === 'string') {
      onShareText({ name: file.name, plainText: file.plainText });
    } else {
      const blob = new Blob([Uint8Array.from(atob(file.base64 ?? ''), (c) => c.charCodeAt(0))], {
        type: file.mime || 'application/octet-stream'
      });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = file.name;
      a.click();
      URL.revokeObjectURL(a.href);
    }
  }
</script>

<!-- The stage IS the channel body while a session is open (issue "Fix layout
     issues in pad app"): a flex column that hands its full height to the
     player, whose single header carries the new-tab/fullscreen/close
     controls — no second title row, no aspect-ratio overflow. -->
<div class="flex min-h-0 flex-1 flex-col" data-testid="group-app-stage">
  {#if loadError}
    <div class="alert rounded-none py-1 text-xs alert-warning">
      {m.webxdc_session_load_failed({ reason: loadError })}
    </div>
  {/if}
  {#if publishError}
    <div class="alert rounded-none py-1 text-xs alert-warning">
      {m.webxdc_session_publish_failed({ reason: publishError })}
    </div>
  {/if}
  <WebxdcPlayer
    bind:this={player}
    url={session.app.url}
    sha256={session.app.sha256}
    name={session.app.name}
    iconUrl={session.app.iconUrl}
    appKey={`session:${session.sessionId}`}
    {sync}
    onShareFile={handleShareFile}
    fill
    {onClose}
    {onOpenInNewTab}
  />
</div>
