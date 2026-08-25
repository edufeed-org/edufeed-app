<!--
  WebxdcAttachmentCard — launch card for a shared webxdc app inside a channel
  chat bubble. Renders the app icon (if any), its name (from the imeta `alt`
  tag, "Webxdc app: <name>"), and a button that hands the raw attachment back
  to the caller via `onLaunch` — GroupChat turns that into `activeSession`.
-->
<script>
  import * as m from '$lib/paraglide/messages';

  /**
   * @typedef {Object} Props
   * @property {{url: string, sha256: string, webxdc: string, alt?: string, image?: string}} attachment
   * @property {(attachment: any) => void} onLaunch
   */

  /** @type {Props} */
  let { attachment, onLaunch } = $props();

  const appName = $derived(
    attachment.alt?.replace(/^Webxdc app: /, '') || m.webxdc_session_shared_app()
  );
</script>

<div
  class="mt-1 flex max-w-xs items-center gap-2 rounded-lg border border-base-300 bg-base-100 p-2"
>
  <div
    class="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded bg-primary/10"
  >
    {#if attachment.image}
      <img src={attachment.image} alt="" class="size-full object-cover" />
    {:else}
      ▦
    {/if}
  </div>
  <span class="min-w-0 flex-1 truncate text-sm font-semibold text-base-content">{appName}</span>
  <button type="button" class="btn btn-sm btn-primary" onclick={() => onLaunch(attachment)}>
    {m.webxdc_session_launch()}
  </button>
</div>
