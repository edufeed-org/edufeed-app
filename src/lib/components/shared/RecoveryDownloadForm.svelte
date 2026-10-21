<!--
  RecoveryDownloadForm — the backup-file chooser shared by
  RecoveryDownloadModal (Termi hint, settings, account menu) and the signup
  wizard's final "Sichern" step. Two modes:
    encrypted → NIP-49 ncryptsec (default; password ≥ 8 chars)
    plain     → raw nsec (the file IS the secret — keep it private)
  The caller passes the key and the identity that goes into the file name
  and header (recoveryFile.js) and hears back through `onDownloaded`.
-->
<script>
  import * as m from '$lib/paraglide/messages';
  import { downloadRecoveryFile } from '$lib/helpers/recoveryFile.js';

  /**
   * @type {{
   *   privateKey: Uint8Array | null | undefined,
   *   nsec: string,
   *   label?: string,
   *   npub?: string,
   *   appName?: string,
   *   onDownloaded?: () => void
   * }}
   */
  let { privateKey, nsec, label = '', npub = '', appName = 'Edufeed', onDownloaded } = $props();

  let mode = $state(/** @type {'encrypted' | 'plain'} */ ('encrypted'));
  let password = $state('');
  let error = $state('');

  function handleDownload() {
    error = '';
    if (!privateKey || !nsec) {
      error = 'No key to back up.';
      return;
    }
    const identity = { label, npub, appName };
    if (mode === 'encrypted') {
      if (!password || password.length < 8) {
        error = m.auth_recovery_modal_password_too_short();
        return;
      }
      downloadRecoveryFile({ privateKey, nsec, password, ...identity });
    } else {
      downloadRecoveryFile({ privateKey, nsec, ...identity });
    }
    onDownloaded?.();
  }
</script>

<div class="space-y-2">
  <label class="label flex cursor-pointer items-center gap-2">
    <input
      data-testid="recovery-mode-encrypted"
      type="radio"
      class="radio radio-sm"
      name="recovery-mode"
      value="encrypted"
      checked={mode === 'encrypted'}
      onchange={() => (mode = 'encrypted')}
    />
    <span class="label-text">{m.auth_recovery_modal_encrypted_label()}</span>
  </label>

  <!-- Always laid out: hiding the field with visibility keeps the download
       button where it was when the user switches to "unverschlüsselt", so
       the first click does not land in the void (issue ddce9cc0, G). -->
  <div class="form-control pl-8" class:invisible={mode !== 'encrypted'}>
    <label class="label" for="recovery-password-input">
      <span class="label-text">{m.auth_recovery_modal_password_label()}</span>
    </label>
    <input
      id="recovery-password-input"
      data-testid="recovery-password"
      type="password"
      class="input-bordered input input-sm w-full"
      bind:value={password}
      minlength="8"
      tabindex={mode === 'encrypted' ? 0 : -1}
    />
  </div>

  <label class="label flex cursor-pointer items-center gap-2">
    <input
      data-testid="recovery-mode-plain"
      type="radio"
      class="radio radio-sm"
      name="recovery-mode"
      value="plain"
      checked={mode === 'plain'}
      onchange={() => (mode = 'plain')}
    />
    <span class="label-text">{m.auth_recovery_modal_plain_label()}</span>
  </label>

  {#if error}
    <div class="mt-3 alert alert-error">
      <span>{error}</span>
    </div>
  {/if}

  <div class="pt-2">
    <button data-testid="recovery-download-btn" class="btn btn-primary" onclick={handleDownload}>
      {m.auth_recovery_modal_download()}
    </button>
  </div>
</div>
