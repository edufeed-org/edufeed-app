<!--
  HiddenSourcesToggle — "N importierte Termine ausgeblendet – anzeigen".
  Bulk calendar sources (CALENDAR_HIDDEN_PUBKEYS, NIP-24 bot profiles) are
  hidden from the global calendar surfaces by default; this flips the
  per-device setting. Renders nothing while no event is affected.
-->
<script>
  import { appSettings } from '$lib/stores/app-settings.svelte.js';
  import * as m from '$lib/paraglide/messages';

  /** @type {{ hidden: number }} */
  let { hidden } = $props();
</script>

{#if hidden > 0}
  <button
    type="button"
    class="btn text-base-content/70 btn-ghost btn-sm"
    data-testid="hidden-sources-toggle"
    onclick={() => (appSettings.showHiddenCalendarSources = !appSettings.showHiddenCalendarSources)}
  >
    {appSettings.showHiddenCalendarSources
      ? m.calendar_hidden_sources_hide()
      : m.calendar_hidden_sources_show({ count: hidden })}
  </button>
{/if}
