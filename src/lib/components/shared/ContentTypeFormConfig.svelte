<!--
  ContentTypeFormConfig Component
  Per-content-type configuration for form-based access gating
-->

<script>
  import { parseFormTemplate } from '$lib/helpers/forms.js';
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
   *   contentType: ContentTypeConfig,
   *   formTemplates: any[],
   *   defaultFormRef?: string
   * }}
   */
  let { contentType = $bindable(), formTemplates, defaultFormRef = '' } = $props();
</script>

<div class="flex items-center gap-3">
  <span class="min-w-20 text-sm font-medium">{contentType.name}</span>
  <select class="select-bordered select flex-1 select-sm" bind:value={contentType.formRef}>
    <option value="">{m.form_config_open?.() || 'Open — anyone can publish'}</option>
    {#each formTemplates as template (template.id)}
      {@const parsed = parseFormTemplate(template)}
      <option value="{template.kind}:{template.pubkey}:{parsed.dTag}">
        {parsed.name || parsed.dTag}
      </option>
    {/each}
  </select>
  {#if defaultFormRef && contentType.formRef === defaultFormRef}
    <span class="text-xs opacity-50">{m.form_config_same_as_default?.() || 'same as default'}</span>
  {/if}
</div>
