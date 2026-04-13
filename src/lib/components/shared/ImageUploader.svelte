<script>
  import * as m from '$lib/paraglide/messages';
  import ImageWithFallback from './ImageWithFallback.svelte';

  let { userData, errors = $bindable({}) } = $props();

  // UI state
  let uploadingImage = $state(false);
  let _imageFile = $state(/** @type {File | null} */ (null));

  /**
   * @param {File} file
   */
  async function uploadImageToBlossom(file) {
    const formData = new FormData();
    formData.append('file', file);

    // Try nstart.me first, fallback to blossom.primal.net
    const endpoints = ['https://nstart.me/a/step-end', 'https://blossom.primal.net/upload'];

    for (const endpoint of endpoints) {
      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          body: formData
        });

        if (response.ok) {
          const result = await response.json();
          return result.url || result.data?.url;
        }
      } catch (error) {
        console.error('Image upload failed:', error);
        errors.image = m.image_uploader_error_upload_failed();
      }
    }

    throw new Error('Failed to upload image to any Blossom service');
  }

  /**
   * @param {Event} event
   */
  async function handleImageUpload(event) {
    const target = /** @type {HTMLInputElement} */ (event.target);
    const file = target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      errors.image = m.image_uploader_error_invalid_file();
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      // 5MB limit
      errors.image = m.image_uploader_error_too_large({ size: 5 });
      return;
    }

    try {
      uploadingImage = true;
      errors.image = '';
      _imageFile = file;

      const imageUrl = await uploadImageToBlossom(file);
      userData.picture = imageUrl;
    } catch (error) {
      console.error('Image upload failed:', error);
      errors.image = 'Failed to upload image. Please try again.';
    } finally {
      uploadingImage = false;
    }
  }
</script>

<div class="form-control">
  <label class="label" for="img-uploader-file">
    <span class="label-text">{m.image_uploader_label()}</span>
  </label>
  <div class="flex items-center gap-4">
    {#if userData.picture}
      <div class="avatar">
        <div class="w-16 rounded-full">
          <ImageWithFallback
            src={userData.picture}
            alt="Profile"
            size="avatar_lg"
            class="h-full w-full rounded-full object-cover"
          />
        </div>
      </div>
    {/if}
    <input
      id="img-uploader-file"
      type="file"
      accept="image/*"
      class="file-input-bordered file-input w-full max-w-xs"
      onchange={handleImageUpload}
      disabled={uploadingImage}
    />
    {#if uploadingImage}
      <span class="loading loading-sm loading-spinner"></span>
    {/if}
  </div>
  {#if errors.image}
    <div class="label">
      <span class="label-text-alt text-error">{errors.image}</span>
    </div>
  {/if}
</div>
