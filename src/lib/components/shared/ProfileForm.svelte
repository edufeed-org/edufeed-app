<script>
  import * as m from '$lib/paraglide/messages';

  let {
    userData = $bindable(),
    errors = $bindable({}),
    hideBanner = false,
    // The create-community modal replaces the raw URL field with
    // LicensedImageInput; the form steps aside like it does for the banner.
    hidePicture = false
  } = $props();

  function validateStep() {
    errors = {};

    if (!userData.name.trim()) {
      errors.name = m.profile_form_name_required();
      return false;
    }

    // Validate URLs if provided
    if (userData.website && userData.website.trim()) {
      try {
        new URL(userData.website);
      } catch {
        errors.website = m.profile_form_invalid_url();
        return false;
      }
    }

    if (userData.picture && userData.picture.trim()) {
      try {
        new URL(userData.picture);
      } catch {
        errors.picture = m.profile_form_invalid_image_url();
        return false;
      }
    }

    if (userData.banner && userData.banner.trim()) {
      try {
        new URL(userData.banner);
      } catch {
        errors.banner = m.profile_form_invalid_image_url();
        return false;
      }
    }

    return true;
  }

  // Expose validation function for parent components
  // @ts-ignore
  $effect.root(() => {
    // This makes validateStep available to parent components
    if (typeof window !== 'undefined') {
      // @ts-ignore
      window.profileFormValidate = validateStep;
    }
  });
</script>

<div class="space-y-4">
  <!-- Name -->
  <div class="form-control flex flex-col">
    <label class="label" for="profile-name">
      <span class="label-text w-full text-center">{m.profile_form_name_label()}</span>
    </label>
    <input
      id="profile-name"
      type="text"
      bind:value={userData.name}
      placeholder={m.profile_form_name_placeholder()}
      class="input-bordered input w-full"
      class:input-error={errors.name}
    />
    {#if errors.name}
      <div class="label" aria-live="polite">
        <span class="label-text-alt w-full text-center text-error">{errors.name}</span>
      </div>
    {/if}
  </div>

  <!-- About -->
  <div class="form-control flex flex-col">
    <label class="label" for="profile-about">
      <span class="label-text w-full text-center">{m.profile_form_about_label()}</span>
    </label>
    <textarea
      id="profile-about"
      bind:value={userData.about}
      placeholder={m.profile_form_about_placeholder()}
      class="textarea-bordered textarea h-24 w-full"
    ></textarea>
  </div>

  <!-- Profile Picture URL -->
  {#if !hidePicture}
    <div class="form-control flex flex-col">
      <label class="label" for="profile-picture">
        <span class="label-text w-full text-center">{m.profile_form_picture_label()}</span>
      </label>
      <input
        id="profile-picture"
        type="url"
        bind:value={userData.picture}
        placeholder={m.profile_form_picture_placeholder()}
        class="input-bordered input w-full"
        class:input-error={errors.picture}
      />
      {#if errors.picture}
        <div class="label" aria-live="polite">
          <span class="label-text-alt w-full text-center text-error">{errors.picture}</span>
        </div>
      {/if}
    </div>
  {/if}

  <!-- Banner Image URL -->
  {#if !hideBanner}
    <div class="form-control flex flex-col">
      <label class="label" for="profile-banner">
        <span class="label-text w-full text-center">{m.profile_form_banner_label()}</span>
      </label>
      <input
        id="profile-banner"
        type="url"
        bind:value={userData.banner}
        placeholder={m.profile_form_banner_placeholder()}
        class="input-bordered input w-full"
        class:input-error={errors.banner}
      />
      {#if errors.banner}
        <div class="label" aria-live="polite">
          <span class="label-text-alt w-full text-center text-error">{errors.banner}</span>
        </div>
      {/if}
    </div>
  {/if}

  <!-- Website -->
  <div class="form-control flex flex-col">
    <label class="label" for="profile-website">
      <span class="label-text w-full text-center">{m.profile_form_website_label()}</span>
    </label>
    <input
      id="profile-website"
      type="url"
      bind:value={userData.website}
      placeholder={m.profile_form_website_placeholder()}
      class="input-bordered input w-full"
      class:input-error={errors.website}
    />
    {#if errors.website}
      <div class="label" aria-live="polite">
        <span class="label-text-alt w-full text-center text-error">{errors.website}</span>
      </div>
    {/if}
  </div>
</div>
