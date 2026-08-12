<!--
  ContentTypesAndACL Component
  Compact content type chips + unified ACL with default form and per-type overrides.
  formRef per type is the source of truth — defaultFormRef is a UI convenience.
-->

<script>
  import { parseFormTemplate, formCoordinateToNaddr } from '$lib/helpers/forms.js';
  import { applyDefaultFormRef } from '$lib/helpers/communityFormDefaults.js';
  import { getCommunikeyRelays } from '$lib/helpers/relay-helper.js';
  import { resolve } from '$app/paths';
  import ContentTypeFormConfig from './ContentTypeFormConfig.svelte';
  import { ExternalLinkIcon } from '$lib/components/icons';
  import * as m from '$lib/paraglide/messages';

  /**
   * @typedef {Object} ContentTypeConfig
   * @property {string} name
   * @property {boolean} enabled
   * @property {{read: string|null, write: string|null}} badges
   * @property {string[]} relays
   * @property {string} formRef
   */

  /**
   * @type {{
   *   contentTypes: Record<string, ContentTypeConfig>,
   *   formTemplates: any[],
   *   showAccessConfig: boolean,
   *   defaultFormRef: string,
   *   onCreateDefaultForm?: () => Promise<string>,
   *   errors?: Record<string, string>,
   *   hideAccessToggle?: boolean
   * }}
   */
  let {
    contentTypes = $bindable(),
    formTemplates,
    showAccessConfig = $bindable(),
    defaultFormRef = $bindable(),
    onCreateDefaultForm,
    errors = {},
    hideAccessToggle = false
  } = $props();

  let isCreatingDefault = $state(false);

  /** Content type display names from i18n
   * @type {Record<string, () => string>}
   */
  const contentTypeLabels = {
    calendar: () => m.create_community_modal_content_calendar(),
    chat: () => m.create_community_modal_content_chat(),
    articles: () => m.create_community_modal_content_articles(),
    posts: () => m.create_community_modal_content_posts(),
    wikis: () => m.create_community_modal_content_wikis(),
    learning: () => m.create_community_modal_content_learning(),
    polls: () => m.create_community_modal_content_polls(),
    bookmarks: () => m.create_community_modal_content_bookmarks(),
    meet: () => m.create_community_modal_content_meet()
  };

  /** Whether per-type overrides section is expanded */
  let showOverrides = $state(false);

  /**
   * Handle default form change — bulk-update types matching old default.
   * @param {Event} e
   */
  function handleDefaultChange(e) {
    const newDefault = /** @type {HTMLSelectElement} */ (e.currentTarget).value;
    const oldDefault = defaultFormRef;
    contentTypes = applyDefaultFormRef(contentTypes, oldDefault, newDefault);
    defaultFormRef = newDefault;
  }

  /**
   * Build a form template coordinate string.
   * @param {any} template
   * @returns {string}
   */
  function getTemplateValue(template) {
    const parsed = parseFormTemplate(template);
    return `${template.kind}:${template.pubkey}:${parsed.dTag}`;
  }
</script>

<!-- Content Type Chips -->
<div class="form-control">
  <div class="label">
    <span class="label-text font-semibold">{m.create_community_modal_content_types_label()}</span>
    <span class="label-text-alt text-sm">{m.create_community_modal_content_types_alt()}</span>
  </div>
  <div class="flex flex-wrap gap-2">
    {#each Object.entries(contentTypes) as [key, ct] (key)}
      <button
        type="button"
        class="btn rounded-full btn-sm {ct.enabled
          ? 'btn-primary'
          : 'opacity-60 btn-ghost btn-outline'}"
        onclick={() => (contentTypes[key].enabled = !contentTypes[key].enabled)}
      >
        {#if ct.enabled}
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            class="h-4 w-4"
          >
            <path
              fill-rule="evenodd"
              d="M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.05-.143Z"
              clip-rule="evenodd"
            />
          </svg>
        {/if}
        {contentTypeLabels[key]?.() || ct.name}
      </button>
    {/each}
  </div>
  {#if errors.contentTypes}
    <div class="label">
      <span class="label-text-alt text-error">{errors.contentTypes}</span>
    </div>
  {/if}
</div>

<!-- Access Control Toggle -->
{#if !hideAccessToggle}
  <div class="form-control mt-4">
    <label class="label cursor-pointer justify-start gap-3">
      <input type="checkbox" class="toggle toggle-primary" bind:checked={showAccessConfig} />
      <span class="label-text">{m.form_config_toggle?.() || 'Configure access control'}</span>
    </label>
    <p class="ml-12 text-xs opacity-70">
      {m.form_config_toggle_help?.() ||
        'Require a form submission for publishing to specific content types'}
    </p>
  </div>
{/if}

<!-- Access Control Section -->
{#if showAccessConfig}
  <div class="mt-4 rounded-lg bg-base-200 p-4">
    <!-- Default Form Picker -->
    <div class="form-control">
      <label class="label" for="acl-default-form">
        <span class="label-text font-semibold"
          >{m.form_config_default_form_label?.() || 'Default form'}</span
        >
      </label>
      {#if formTemplates.length === 0 && onCreateDefaultForm}
        <p class="mb-2 text-sm opacity-70">
          {m.form_config_no_forms_hint?.() || 'No form templates available.'}
        </p>
        <button
          type="button"
          class="btn btn-sm btn-primary"
          disabled={isCreatingDefault}
          onclick={async () => {
            isCreatingDefault = true;
            try {
              const coordinate = await onCreateDefaultForm();
              const oldDefault = defaultFormRef;
              contentTypes = applyDefaultFormRef(contentTypes, oldDefault, coordinate);
              defaultFormRef = coordinate;
            } finally {
              isCreatingDefault = false;
            }
          }}
        >
          {#if isCreatingDefault}
            <span class="loading loading-xs loading-spinner"></span>
            {m.form_config_creating_default?.() || 'Creating form…'}
          {:else}
            {m.form_config_create_default?.() || 'Create default membership form'}
          {/if}
        </button>
      {:else}
        <div class="flex items-center gap-2">
          <select
            id="acl-default-form"
            class="select-bordered select flex-1"
            value={defaultFormRef}
            onchange={handleDefaultChange}
          >
            <option value="">{m.form_config_open?.() || 'Open — anyone can publish'}</option>
            {#each formTemplates as template (template.id)}
              {@const parsed = parseFormTemplate(template)}
              <option value={getTemplateValue(template)}>
                {parsed.name || parsed.dTag}
              </option>
            {/each}
          </select>
          {#if defaultFormRef}
            <a
              href={resolve(
                `/forms/${formCoordinateToNaddr(defaultFormRef, getCommunikeyRelays().slice(0, 2))}`
              )}
              target="_blank"
              rel="noopener noreferrer"
              class="btn btn-square btn-ghost btn-sm"
              title={m.form_config_view_form?.() || 'View form in new tab'}
            >
              <ExternalLinkIcon class_="w-4 h-4" title="" />
            </a>
          {/if}
        </div>
      {/if}
      <p class="mt-1 text-xs opacity-70">
        {m.form_config_default_form_help?.() || 'Applies to all enabled content types'}
      </p>
    </div>

    <!-- Per-Type Overrides (collapsible) -->
    <div class="mt-4 border-t border-base-300 pt-4">
      <button
        type="button"
        class="btn gap-1 px-0 btn-ghost btn-sm"
        onclick={() => (showOverrides = !showOverrides)}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 20 20"
          fill="currentColor"
          class="h-4 w-4 transition-transform {showOverrides ? 'rotate-90' : ''}"
        >
          <path
            fill-rule="evenodd"
            d="M7.21 14.77a.75.75 0 0 1 .02-1.06L11.168 10 7.23 6.29a.75.75 0 1 1 1.04-1.08l4.5 4.25a.75.75 0 0 1 0 1.08l-4.5 4.25a.75.75 0 0 1-1.06-.02Z"
            clip-rule="evenodd"
          />
        </svg>
        {m.form_config_customize_per_type?.() || 'Customize per content type'}
      </button>

      {#if showOverrides}
        <div class="mt-3 space-y-3">
          {#each Object.entries(contentTypes) as [key, ct] (key)}
            {#if ct.enabled}
              <ContentTypeFormConfig
                bind:contentType={contentTypes[key]}
                {formTemplates}
                {defaultFormRef}
              />
            {/if}
          {/each}
        </div>
      {/if}
    </div>
  </div>
{/if}
