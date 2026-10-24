<!--
  HiddenSourcesToggle — inline fragment for a count line:
    "Oktober 2026 · 22 Events · 918 importierte ausgeblendet · anzeigen"
    "Oktober 2026 · 940 Events · inkl. 918 importierte · ausblenden"
  Bulk calendar sources (CALENDAR_HIDDEN_PUBKEYS, NIP-24 bot profiles) are
  hidden from the global calendar surfaces by default; the link flips the
  per-device setting. It lives in the count line (design round 2026-10-24,
  option 1e) rather than the filter chrome, so the chrome row never changes
  width when the count drops to zero. Renders nothing while no event is
  affected. `hidden` is the number of imported events in the current set,
  whether they are shown or not.
-->
<script>
  import { appSettings } from '$lib/stores/app-settings.svelte.js';
  import * as m from '$lib/paraglide/messages';

  /** @type {{ hidden: number }} */
  let { hidden } = $props();

  const shown = $derived(appSettings.showHiddenCalendarSources);
</script>

{#if hidden > 0}
  <span class="font-normal text-base-content/60" data-testid="hidden-sources-toggle">
    · {shown
      ? m.calendar_hidden_sources_included({ count: hidden })
      : m.calendar_hidden_sources_hidden({ count: hidden })}
    ·
    <button
      type="button"
      class="link font-medium link-primary"
      onclick={() => (appSettings.showHiddenCalendarSources = !shown)}
    >
      {shown ? m.calendar_hidden_sources_hide() : m.calendar_hidden_sources_show()}
    </button>
  </span>
{/if}
