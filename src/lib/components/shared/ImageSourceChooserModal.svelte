<script>
  import * as m from '$lib/paraglide/messages';

  let {
    open = $bindable(false),
    /** @type {() => void} */
    onupload = () => {},
    /** @type {() => void} */
    onlibrary = () => {},
    /** @type {() => void} */
    oncancel = () => {}
  } = $props();

  function handleUpload() {
    open = false;
    onupload();
  }

  function handleLibrary() {
    open = false;
    onlibrary();
  }

  function handleCancel() {
    open = false;
    oncancel();
  }
</script>

{#if open}
  <div class="modal-open modal" role="dialog" aria-modal="true">
    <div class="modal-box max-w-md">
      <h3 class="text-lg font-semibold">{m.image_source_chooser_title()}</h3>

      <div class="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <button
          type="button"
          class="btn h-auto flex-col gap-1 py-4 btn-lg"
          onclick={handleUpload}
          data-testid="chooser-upload"
        >
          <span class="text-2xl" aria-hidden="true">📤</span>
          <span class="font-medium">{m.image_source_chooser_upload_label()}</span>
          <span class="text-xs opacity-70">{m.image_source_chooser_upload_desc()}</span>
        </button>
        <button
          type="button"
          class="btn h-auto flex-col gap-1 py-4 btn-lg"
          onclick={handleLibrary}
          data-testid="chooser-library"
        >
          <span class="text-2xl" aria-hidden="true">🖼️</span>
          <span class="font-medium">{m.image_source_chooser_library_label()}</span>
          <span class="text-xs opacity-70">{m.image_source_chooser_library_desc()}</span>
        </button>
      </div>

      <p class="mt-4 text-xs opacity-70">{m.image_source_chooser_paste_hint()}</p>

      <div class="modal-action">
        <button type="button" class="btn btn-ghost" onclick={handleCancel}>
          {m.image_source_chooser_cancel()}
        </button>
      </div>
    </div>
    <div class="modal-backdrop" onclick={handleCancel} role="presentation"></div>
  </div>
{/if}
