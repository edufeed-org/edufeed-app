<!--
  InviteLinkQr — a shareable link rendered as text + copy button + QR code.
  Used for community invites: the moderated community's join link (page +
  prefilled invite code, MembershipPane) and an open community's plain page
  link (SettingsView). The QR is generated client-side with `qrcode` (same
  dependency the Concord channel invite sheet and the webcal modal use).
-->
<script>
  import QRCode from 'qrcode';
  import { CopyIcon } from '$lib/components/icons';
  import { showToast } from '$lib/helpers/toast';
  import * as m from '$lib/paraglide/messages';

  /** @type {{ url: string, testid?: string }} */
  let { url, testid = 'invite-link' } = $props();

  let qrDataUrl = $state('');

  $effect(() => {
    const current = url;
    qrDataUrl = '';
    if (!current) return;
    let cancelled = false;
    QRCode.toDataURL(current, { margin: 1, width: 352 })
      .then((/** @type {string} */ dataUrl) => {
        if (!cancelled) qrDataUrl = dataUrl;
      })
      .catch((/** @type {unknown} */ err) => console.error('invite QR generation failed', err));
    return () => {
      cancelled = true;
    };
  });

  async function copy() {
    if (!navigator.clipboard) {
      showToast(
        m.community_invite_link_copy_failed({ reason: m.community_invite_clipboard_unavailable() }),
        'error'
      );
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      showToast(m.community_invite_link_copied(), 'success');
    } catch (error) {
      console.error('clipboard copy failed', error);
      showToast(
        m.community_invite_link_copy_failed({
          reason: error instanceof Error ? error.message : String(error)
        }),
        'error'
      );
    }
  }
</script>

<div class="flex flex-col gap-3 sm:flex-row sm:items-start" data-testid={testid}>
  {#if qrDataUrl}
    <img
      src={qrDataUrl}
      alt={m.community_invite_qr_alt()}
      class="h-44 w-44 shrink-0 rounded-xl border border-base-300 bg-white"
      data-testid="{testid}-qr"
    />
  {/if}
  <div class="min-w-0 flex-1">
    <code
      class="block rounded bg-base-300 px-2 py-1 font-mono text-xs break-all"
      data-testid="{testid}-url"
    >
      {url}
    </code>
    <button
      type="button"
      class="btn mt-2 btn-ghost btn-sm"
      data-testid="{testid}-copy"
      onclick={copy}
    >
      <CopyIcon class_="w-4 h-4" />
      {m.community_invite_link_copy()}
    </button>
  </div>
</div>
