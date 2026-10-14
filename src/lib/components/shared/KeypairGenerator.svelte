<script>
  import { generateSecretKey, getPublicKey, nip19 } from 'nostr-tools';
  import { downloadRecoveryFile } from '$lib/helpers/recoveryFile.js';
  import { runtimeConfig } from '$lib/stores/config.svelte.js';
  import CopyIcon from '../icons/actions/CopyIcon.svelte';
  import CheckIcon from '../icons/ui/CheckIcon.svelte';
  import * as m from '$lib/paraglide/messages';

  let { userData, errors = $bindable({}) } = $props();

  // UI state
  let isGeneratingKeys = $state(false);

  // Generate keypair when component mounts
  $effect(() => {
    if (!userData.privateKey) {
      generateKeypair();
    }
  });

  function generateKeypair() {
    try {
      isGeneratingKeys = true;
      const privateKey = generateSecretKey();
      const publicKey = getPublicKey(privateKey);

      userData.privateKey = privateKey;
      userData.publicKey = publicKey;
      userData.nsec = nip19.nsecEncode(privateKey);
      userData.npub = nip19.npubEncode(publicKey);
    } catch (error) {
      console.error('Error generating keypair:', error);
      errors.keyGeneration = 'Failed to generate keys. Please try again.';
    } finally {
      isGeneratingKeys = false;
    }
  }

  // Which backup(s) were taken — one flag per button, so downloading the
  // plain file no longer shows the encrypted one as "Heruntergeladen" too.
  let nsecDownloaded = $state(false);
  let ncryptsecDownloaded = $state(false);

  /** Identity that goes into the file name and header (shared helper, so
   * a community key is never saved under the same name as a personal one). */
  function identity() {
    return {
      label: userData.name || '',
      npub: userData.npub,
      appName: runtimeConfig.appName || 'Edufeed',
      kind: /** @type {const} */ ('community')
    };
  }

  function downloadNsec() {
    downloadRecoveryFile({ privateKey: userData.privateKey, nsec: userData.nsec, ...identity() });
    nsecDownloaded = true;
    userData.downloadConfirmed = true;
    errors.download = '';
  }

  function downloadNcryptsec() {
    if (!userData.ncryptsecPassword) {
      errors.password = m.keypair_generator_error_password_required();
      return;
    }

    if (!userData.privateKey) {
      errors.password = m.keypair_generator_error_private_key_missing();
      return;
    }

    try {
      downloadRecoveryFile({
        privateKey: userData.privateKey,
        nsec: userData.nsec,
        password: userData.ncryptsecPassword,
        ...identity()
      });
      ncryptsecDownloaded = true;
      userData.downloadConfirmed = true;
      errors.password = '';
      errors.download = '';
    } catch (error) {
      console.error('Error generating keypair:', error);
      errors.keyGeneration = m.keypair_generator_error_generation_failed();
    }
  }

  /**
   * @param {string} text
   */
  function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => {
      // Could add a toast notification here
    });
  }
</script>

<div class="space-y-6">
  <div class="prose max-w-none">
    <h3 class="mb-4 text-lg font-semibold">
      {m.keypair_generator_title()}
    </h3>
    <p class="mb-4">
      {m.keypair_generator_description_1()}
    </p>
    <p class="mb-6">
      {m.keypair_generator_description_2()}
    </p>
    <p class="mb-6 font-semibold text-warning">
      {m.keypair_generator_warning()}
    </p>
  </div>

  {#if isGeneratingKeys}
    <div class="flex items-center justify-center py-8">
      <span class="loading loading-lg loading-spinner"></span>
      <span class="ml-2">{m.keypair_generator_generating()}</span>
    </div>
  {:else}
    <!-- Public Key Display -->
    <div class="card bg-base-200">
      <div class="card-body">
        <h3 class="card-title text-sm">{m.keypair_generator_public_key_title()}</h3>
        <div class="flex items-center gap-2">
          <code class="flex-1 rounded bg-base-300 p-2 text-xs break-all">
            {userData.npub}
          </code>
          <button class="btn btn-square btn-sm" onclick={() => copyToClipboard(userData.npub)}>
            <CopyIcon />
          </button>
        </div>
      </div>
    </div>

    <!-- Private Key Download -->
    <div class="card bg-base-200">
      <div class="card-body">
        <h3 class="card-title text-sm">{m.keypair_generator_private_key_title()}</h3>

        <div class="space-y-4">
          <!-- Plain nsec download -->
          <div>
            <button class="btn btn-primary" onclick={downloadNsec} disabled={nsecDownloaded}>
              {#if nsecDownloaded}
                <CheckIcon />
                {m.keypair_generator_downloaded()}
              {:else}
                {m.keypair_generator_download_nsec()}
              {/if}
            </button>
          </div>

          <!-- Encrypted option -->
          <div class="divider">{m.auth_login_modal_or()}</div>

          <div class="space-y-2">
            <label class="label" for="keypair-password">
              <span class="label-text">{m.keypair_generator_encrypted_backup_label()}</span>
            </label>
            <div class="flex gap-2">
              <input
                id="keypair-password"
                type="password"
                bind:value={userData.ncryptsecPassword}
                placeholder={m.keypair_generator_password_placeholder()}
                class="input-bordered input flex-1"
                class:input-error={errors.password}
              />
              <button
                class="btn btn-secondary"
                onclick={downloadNcryptsec}
                disabled={!userData.ncryptsecPassword || ncryptsecDownloaded}
              >
                {#if ncryptsecDownloaded}
                  <CheckIcon />
                  {m.keypair_generator_downloaded()}
                {:else}
                  {m.keypair_generator_download_ncryptsec()}
                {/if}
              </button>
            </div>
            {#if errors.password}
              <div class="label">
                <span class="label-text-alt text-error">{errors.password}</span>
              </div>
            {/if}
          </div>
        </div>
      </div>
    </div>

    {#if errors.download}
      <div class="alert alert-error">
        <span>{errors.download}</span>
      </div>
    {:else if !userData.downloadConfirmed}
      <p class="text-sm text-base-content/70" data-testid="keypair-download-hint">
        {m.create_community_modal_error_download_required()}
      </p>
    {/if}
  {/if}
</div>
