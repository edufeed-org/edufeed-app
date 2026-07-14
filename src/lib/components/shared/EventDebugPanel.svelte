<!--
  EventDebugPanel Component
  Generic debug information panel for any Nostr event
  Works with raw events, calendar events, AMB resources, etc.
-->

<script>
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { profileLink } from '$lib/helpers/nostrUtils';
  import { appSettings } from '$lib/stores/app-settings.svelte.js';
  import * as m from '$lib/paraglide/messages.js';

  /**
   * @typedef {Object} Props
   * @property {any} event - The event object (raw Nostr event or formatted resource)
   * @property {boolean} [showToggle=true] - Whether to show the collapsible toggle
   */

  /** @type {Props} */
  let { event, showToggle = true } = $props();

  // Debug panel state
  let isDebugVisible = $state(false);
  let isJsonExpanded = $state(false);
  let isCopied = $state(false);

  // Check if debug mode is enabled
  const debugEnabled = $derived(appSettings.debugMode);

  // Get the raw event - prefer rawEvent property if available (from formatted resources)
  const rawEvent = $derived(event?.rawEvent || event);

  /**
   * Toggle debug panel visibility
   */
  function toggleDebugVisibility() {
    isDebugVisible = !isDebugVisible;
  }

  /**
   * Toggle JSON expansion
   */
  function toggleJsonExpansion() {
    isJsonExpanded = !isJsonExpanded;
  }

  /**
   * Copy raw event to clipboard with feedback
   */
  async function copyRawEvent() {
    try {
      const jsonString = JSON.stringify(rawEvent, null, 2);
      await navigator.clipboard.writeText(jsonString);
      isCopied = true;
      setTimeout(() => {
        isCopied = false;
      }, 2000);
    } catch (err) {
      console.error('Failed to copy raw event:', err);
    }
  }

  /**
   * Copy text to clipboard
   * @param {string} text
   * @param {string} label
   */
  async function copyToClipboard(text, label) {
    try {
      await navigator.clipboard.writeText(text);
    } catch (err) {
      console.error(`Failed to copy ${label}:`, err);
    }
  }

  /**
   * Copy event ID to clipboard
   */
  async function copyEventId() {
    if (rawEvent?.id) {
      await copyToClipboard(rawEvent.id, 'Event ID');
    }
  }

  /**
   * Copy pubkey to clipboard
   */
  async function copyPubkey() {
    if (rawEvent?.pubkey) {
      await copyToClipboard(rawEvent.pubkey, 'Pubkey');
    }
  }

  /**
   * Open event in njump.me
   */
  function openInNjump() {
    if (rawEvent?.id) {
      window.open(`https://njump.me/${rawEvent.id}`, '_blank');
    }
  }

  /**
   * Navigate to profile page
   */
  function goToProfile() {
    if (rawEvent?.pubkey) {
      goto(resolve(profileLink(rawEvent.pubkey)));
    }
  }

  /**
   * Format timestamp for display
   * @param {number} timestamp
   * @returns {string}
   */
  function formatTimestamp(timestamp) {
    if (!timestamp) return 'N/A';
    const date = new Date(timestamp * 1000);
    return `${date.toLocaleString()} (${timestamp})`;
  }

  /**
   * Get formatted JSON string
   * @param {any} obj
   * @returns {string}
   */
  function getFormattedJson(obj) {
    return JSON.stringify(obj, null, 2);
  }

  /**
   * Get event kind description
   * @param {number} kind
   * @returns {string}
   */
  function getKindDescription(kind) {
    const kindMap = /** @type {Record<number, string>} */ ({
      0: 'Metadata (Profile)',
      1: 'Short Text Note',
      3: 'Follows',
      5: 'Event Deletion',
      7: 'Reaction',
      30023: 'Long-form Article',
      30142: 'AMB Educational Resource',
      30222: 'Targeted Publication',
      31922: 'Date-based Calendar Event',
      31923: 'Time-based Calendar Event',
      31924: 'Calendar',
      31925: 'Calendar Event RSVP'
    });
    return kindMap[kind] || `Kind ${kind}`;
  }

  /**
   * Get the d-tag (identifier) from the event
   * @param {any} event
   * @returns {string|null}
   */
  function getDTag(event) {
    if (event?.tags) {
      const dTag = event.tags.find((/** @type {string[]} */ t) => t[0] === 'd');
      return dTag?.[1] || null;
    }
    return null;
  }

  // Derived values from raw event
  const eventId = $derived(rawEvent?.id);
  const pubkey = $derived(rawEvent?.pubkey);
  const kind = $derived(rawEvent?.kind);
  const dTag = $derived(getDTag(rawEvent));
  const createdAt = $derived(rawEvent?.created_at);
</script>

{#if debugEnabled}
  <!-- Debug Information Panel -->
  <div class="mt-4 border-t border-base-300 pt-4">
    {#if showToggle}
      <!-- Debug Toggle Header -->
      <div class="mb-3 flex items-center justify-between">
        <button
          class="flex items-center gap-2 text-sm font-medium text-base-content transition-colors hover:text-primary"
          onclick={toggleDebugVisibility}
        >
          <svg
            class="h-4 w-4 transition-transform duration-200 {isDebugVisible ? 'rotate-90' : ''}"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M9 5l7 7-7 7"
            />
          </svg>
          <span class="flex items-center gap-1">
            🔧 Debug Info
            {#if isDebugVisible}
              <span class="badge badge-xs badge-primary">Active</span>
            {/if}
          </span>
        </button>
      </div>
    {/if}

    <!-- Debug Content (Collapsible or Always Visible) -->
    {#if !showToggle || isDebugVisible}
      <div class="space-y-4 rounded-lg bg-base-200 p-4 text-xs">
        <!-- Basic Information -->
        <div>
          <h4 class="mb-2 text-sm font-semibold text-base-content">Basic Information</h4>
          <div class="grid grid-cols-1 gap-2 md:grid-cols-2">
            <!-- Event ID -->
            {#if eventId}
              <div class="flex items-center justify-between rounded bg-base-100 p-2">
                <span class="text-base-content/70">Event ID:</span>
                <div class="flex items-center gap-1">
                  <code class="font-mono">{eventId.slice(0, 8)}...{eventId.slice(-4)}</code>
                  <button
                    class="btn p-1 btn-ghost btn-xs"
                    onclick={copyEventId}
                    title="Copy full event ID"
                  >
                    <svg class="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                      />
                    </svg>
                  </button>
                  <button
                    class="btn p-1 btn-ghost btn-xs"
                    onclick={openInNjump}
                    title="Open in njump.me"
                  >
                    <svg class="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                      />
                    </svg>
                  </button>
                </div>
              </div>
            {/if}

            <!-- Kind -->
            {#if kind !== undefined}
              <div class="flex items-center justify-between rounded bg-base-100 p-2">
                <span class="text-base-content/70">Kind:</span>
                <code class="font-mono" title={getKindDescription(kind)}
                  >{kind} ({getKindDescription(kind)})</code
                >
              </div>
            {/if}

            <!-- Pubkey -->
            {#if pubkey}
              <div class="flex items-center justify-between rounded bg-base-100 p-2">
                <span class="text-base-content/70">Pubkey:</span>
                <div class="flex items-center gap-1">
                  <code class="font-mono">{pubkey.slice(0, 8)}...{pubkey.slice(-4)}</code>
                  <button
                    class="btn p-1 btn-ghost btn-xs"
                    onclick={copyPubkey}
                    title="Copy full pubkey"
                  >
                    <svg class="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                      />
                    </svg>
                  </button>
                  <button
                    class="btn p-1 btn-ghost btn-xs"
                    onclick={goToProfile}
                    title="View profile"
                  >
                    <svg class="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                      />
                    </svg>
                  </button>
                </div>
              </div>
            {/if}

            <!-- D-Tag (Identifier) -->
            <div class="flex items-center justify-between rounded bg-base-100 p-2">
              <span class="text-base-content/70">d-tag:</span>
              {#if dTag}
                <code class="max-w-[200px] truncate font-mono" title={dTag}>{dTag}</code>
              {:else}
                <span class="font-medium text-error">⚠️ MISSING</span>
              {/if}
            </div>

            <!-- Created At -->
            {#if createdAt}
              <div class="flex items-center justify-between rounded bg-base-100 p-2 md:col-span-2">
                <span class="text-base-content/70">Created:</span>
                <code class="font-mono">{formatTimestamp(createdAt)}</code>
              </div>
            {/if}
          </div>
        </div>

        <!-- Raw Nostr Event JSON -->
        <div>
          <div class="mb-2 flex items-center justify-between">
            <h4 class="text-sm font-semibold text-base-content">
              {m.debug_panel_raw_nostr_event()}
            </h4>
            <div class="flex items-center gap-2">
              <button
                class="btn btn-xs {isCopied ? 'btn-success' : 'btn-ghost'}"
                onclick={copyRawEvent}
                title="Copy raw event JSON"
              >
                <svg class="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                  />
                </svg>
                {isCopied ? m.common_copied() : m.common_copy()}
              </button>
              <button class="btn btn-ghost btn-xs" onclick={toggleJsonExpansion}>
                {isJsonExpanded ? 'Collapse' : 'Expand'}
              </button>
            </div>
          </div>
          <div
            class="rounded bg-base-100 p-2 {isJsonExpanded
              ? 'max-h-96'
              : 'max-h-32'} overflow-y-auto transition-all duration-200"
          >
            <pre class="font-mono text-base-content/80">{getFormattedJson(rawEvent)}</pre>
          </div>
        </div>
      </div>
    {/if}
  </div>
{/if}
