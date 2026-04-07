<!--
  WebcalQRCodeModal Component
  Modal for displaying webcal URL as a QR code for easy mobile scanning
-->

<script>
  import QRCode from 'qrcode';
  import { modalStore } from '../../stores/modal.svelte.js';
  import { CloseIcon } from '$lib/components/icons';
  import { showToast } from '$lib/helpers/toast.js';
  import * as m from '$lib/paraglide/messages';

  /**
   * @typedef {Object} WebcalQRCodeModalProps
   * @property {string} webcalUrl - The webcal URL to display as QR code
   * @property {string} [calendarTitle] - Optional title of the calendar
   */

  // Get modal store
  const modal = modalStore;

  // Generate unique modal ID
  const modalId = 'webcal-qr-code-modal';

  // Canvas element for QR code
  let qrCanvas = $state(/** @type {HTMLCanvasElement | null} */ (null));

  /**
   * Sync modal close with store state
   * This effect ensures that when the dialog closes (via ESC, backdrop, etc.),
   * the modal store state is updated accordingly
   */
  $effect(() => {
    const dialog = /** @type {HTMLDialogElement} */ (document.getElementById(modalId));
    if (!dialog) return;

    const handleDialogClose = () => {
      // Only update store if this modal is currently active
      if (modal.activeModal === 'webcalQRCode') {
        console.log('WebcalQRCodeModal: Dialog closed, syncing with store');
        modal.closeModal();
      }
    };

    dialog.addEventListener('close', handleDialogClose);
    return () => {
      dialog.removeEventListener('close', handleDialogClose);
    };
  });

  // Get props from modal store
  let webcalUrl = $derived(
    modal.modalProps && /** @type {WebcalQRCodeModalProps} */ (modal.modalProps).webcalUrl
      ? /** @type {WebcalQRCodeModalProps} */ (modal.modalProps).webcalUrl
      : ''
  );

  let calendarTitle = $derived(
    modal.modalProps && /** @type {WebcalQRCodeModalProps} */ (modal.modalProps).calendarTitle
      ? /** @type {WebcalQRCodeModalProps} */ (modal.modalProps).calendarTitle
      : 'Calendar'
  );

  /**
   * Reactive effect to handle modal opening/closing and QR code generation
   */
  $effect(() => {
    const currentModal = modal.activeModal;
    const dialog = /** @type {HTMLDialogElement} */ (document.getElementById(modalId));

    if (currentModal === 'webcalQRCode' && dialog && !dialog.open) {
      console.log('WebcalQRCodeModal: Opening QR code modal');
      dialog.showModal();

      // Generate QR code when modal opens
      if (qrCanvas && webcalUrl) {
        generateQRCode();
      }
    } else if (currentModal !== 'webcalQRCode' && dialog && dialog.open) {
      console.log('WebcalQRCodeModal: Closing QR code modal');
      dialog.close();
    }
  });

  /**
   * Generate QR code on canvas
   */
  async function generateQRCode() {
    if (!qrCanvas || !webcalUrl) return;

    try {
      await QRCode.toCanvas(qrCanvas, webcalUrl, {
        width: 300,
        margin: 2,
        color: {
          dark: '#000000',
          light: '#FFFFFF'
        }
      });
    } catch (error) {
      console.error('Error generating QR code:', error);
      showToast(m.webcal_qr_modal_toast_qr_failed(), 'error');
    }
  }

  /**
   * Copy webcal URL to clipboard
   */
  async function handleCopyUrl() {
    try {
      await navigator.clipboard.writeText(webcalUrl);
      showToast(m.webcal_qr_modal_toast_copied(), 'success');
    } catch (error) {
      console.error('Error copying URL:', error);
      showToast(m.webcal_qr_modal_toast_copy_failed(), 'error');
    }
  }

  /**
   * Download QR code as PNG image
   */
  function handleDownloadQR() {
    if (!qrCanvas) return;

    try {
      // Convert canvas to blob and download
      qrCanvas.toBlob((blob) => {
        if (!blob) {
          showToast(m.webcal_qr_modal_toast_image_failed(), 'error');
          return;
        }

        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${calendarTitle.replace(/[^a-z0-9]/gi, '-').toLowerCase()}-qr-code.png`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);

        showToast(m.webcal_qr_modal_toast_downloaded(), 'success');
      });
    } catch (error) {
      console.error('Error downloading QR code:', error);
      showToast(m.webcal_qr_modal_toast_download_failed(), 'error');
    }
  }

  /**
   * Handle modal close
   */
  function handleClose() {
    modal.closeModal();
  }
</script>

<!-- QR Code Modal -->
{#if modal.activeModal === 'webcalQRCode'}
  <dialog id={modalId} class="modal" aria-labelledby="qr-modal-title">
    <div class="modal-box w-full max-w-md">
      <!-- Modal Header -->
      <div class="mb-6 flex items-center justify-between">
        <h2 id="qr-modal-title" class="text-2xl font-bold text-base-content">
          {m.webcal_qr_modal_title()}
        </h2>
        <button
          class="btn btn-circle btn-ghost btn-sm"
          onclick={handleClose}
          aria-label={m.aria_close_modal()}
        >
          <CloseIcon class_="w-6 h-6" />
        </button>
      </div>

      <!-- Instructions -->
      <div class="mb-4 rounded-lg bg-info/10 p-4 text-sm text-base-content">
        <p class="mb-2 font-semibold">{m.webcal_qr_modal_instructions_header()}</p>
        <ol class="ml-4 list-decimal space-y-1">
          <li>{m.webcal_qr_modal_step_1()}</li>
          <li>{m.webcal_qr_modal_step_2()}</li>
          <li>{m.webcal_qr_modal_step_3()}</li>
          <li>{m.webcal_qr_modal_step_4()}</li>
        </ol>
      </div>

      <!-- QR Code Canvas -->
      <div class="mb-6 flex justify-center rounded-lg bg-white p-6">
        <canvas
          bind:this={qrCanvas}
          class="rounded-lg shadow-lg"
          aria-label="QR code for calendar subscription"
        ></canvas>
      </div>

      <!-- Webcal URL Display -->
      <div class="mb-6">
        <label for="webcal-qr-url-input" class="mb-2 block text-sm font-semibold text-base-content">
          {m.webcal_qr_modal_url_label()}
        </label>
        <div class="flex gap-2">
          <input
            id="webcal-qr-url-input"
            type="text"
            class="input-bordered input flex-1 text-xs"
            value={webcalUrl}
            readonly
            onclick={(e) => e.currentTarget.select()}
          />
          <button
            class="btn btn-square btn-outline btn-sm"
            onclick={handleCopyUrl}
            aria-label={m.webcal_qr_modal_copy_button()}
            title={m.webcal_qr_modal_copy_button()}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              class="h-5 w-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
              />
            </svg>
          </button>
        </div>
        <p class="mt-2 text-xs text-base-content/60">
          {m.webcal_qr_modal_help_text()}
        </p>
      </div>

      <!-- Action Buttons -->
      <div class="flex justify-end gap-3">
        <button class="btn btn-outline" onclick={handleClose}> {m.common_close()} </button>
        <button class="btn btn-primary" onclick={handleDownloadQR}>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            class="mr-2 h-5 w-5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
            />
          </svg>
          {m.webcal_qr_modal_download_button()}
        </button>
      </div>
    </div>
    <form method="dialog" class="modal-backdrop"><button>close</button></form>
  </dialog>
{/if}
