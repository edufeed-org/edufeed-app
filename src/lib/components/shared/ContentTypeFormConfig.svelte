<!--
  ContentTypeFormConfig Component
  Per-content-type configuration for form-based access gating
-->

<script>
  import EditableList from './EditableList.svelte';
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
   *   showAdvanced?: boolean
   * }}
   */
  let { contentType = $bindable(), formTemplates, showAdvanced = false } = $props();

  /**
   * Validate relay URL format
   * @param {string} url
   */
  function validateRelayUrl(url) {
    if (!url.startsWith('wss://') && !url.startsWith('ws://')) {
      return (
        m.create_community_modal_relays_validation?.() ||
        'Relay URL must start with wss:// or ws://'
      );
    }
    try {
      new URL(url);
      return null;
    } catch {
      return m.create_community_modal_error_invalid_url?.() || 'Invalid URL format';
    }
  }
</script>

<div class="card mb-4 bg-base-200 p-4">
  <h4 class="mb-3 font-semibold">{contentType.name}</h4>

  <!-- Form-based access gate -->
  <div class="form-control">
    <label class="label" for="form-config-{contentType.name}">
      <span class="label-text">{m.form_config_access_label?.() || 'Access Control'}</span>
    </label>
    <select
      id="form-config-{contentType.name}"
      class="select-bordered select"
      bind:value={contentType.formRef}
    >
      <option value="">{m.form_config_open?.() || 'Open — anyone can publish'}</option>
      {#each formTemplates as template (template.id)}
        {@const parsed = parseFormTemplate(template)}
        <option value="{template.kind}:{template.pubkey}:{parsed.dTag}">
          {parsed.name || parsed.dTag}
        </option>
      {/each}
    </select>
    <p class="mt-1 text-xs opacity-70">
      {m.form_config_help?.() || 'Select a form to require for publishing to this section'}
    </p>
  </div>

  <!-- Per-Content-Type Relays (Advanced) -->
  {#if showAdvanced}
    <div class="mt-4 border-t border-base-300 pt-4">
      <EditableList
        bind:items={contentType.relays}
        label={m.content_relay_label?.() || 'Content-Specific Relays'}
        placeholder="wss://premium-relay.example.com"
        buttonText={m.create_community_modal_relays_button?.() || 'Add Relay'}
        itemType="relay"
        validator={validateRelayUrl}
        helpText={m.content_relay_help?.() ||
          'Gated content will use these relays instead of community relays'}
      />
    </div>
  {/if}
</div>
