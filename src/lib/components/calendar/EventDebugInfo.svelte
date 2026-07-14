<!--
  EventDebugInfo Component
  Collapsible debug information panel for calendar events
-->

<script>
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { profileLink } from '$lib/helpers/nostrUtils';

  /**
   * @typedef {import('../../types/calendar.js').CalendarEvent} CalendarEvent
   */

  // Props using Svelte 5 runes syntax
  let { event } = $props();

  // Debug panel state
  let isDebugVisible = $state(false);
  let isJsonExpanded = $state(false);

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
   * Copy text to clipboard
   * @param {string} text
   * @param {string} label
   */
  async function copyToClipboard(text, label) {
    try {
      await navigator.clipboard.writeText(text);
      // Could add toast notification here if desired
    } catch (err) {
      console.error(`Failed to copy ${label}:`, err);
    }
  }

  /**
   * Copy event ID to clipboard
   */
  async function copyEventId() {
    if (event?.id) {
      await copyToClipboard(event.id, 'Event ID');
    }
  }

  /**
   * Copy created by pubkey to clipboard
   */
  async function copyCreatedBy() {
    if (event?.pubkey) {
      await copyToClipboard(event.pubkey, 'Created By Pubkey');
    }
  }

  /**
   * Copy full JSON to clipboard
   * Note: Currently unused - available for future debug features
   */
  async function _copyFullJson() {
    if (event) {
      const jsonString = JSON.stringify(event, null, 2);
      await copyToClipboard(jsonString, 'Event JSON');
    }
  }

  /**
   * Open event in njump.me
   */
  function openInNjump() {
    if (event?.id) {
      window.open(`https://njump.me/${event.id}`, '_blank');
    }
  }

  /**
   * Navigate to profile page
   */
  function goToProfile() {
    if (event?.pubkey) {
      goto(resolve(profileLink(event.pubkey)));
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
      31922: 'Date-based Calendar Event',
      31923: 'Time-based Calendar Event',
      31924: 'Calendar',
      31925: 'Calendar Event RSVP'
    });
    return kindMap[kind] || `Unknown (${kind})`;
  }
</script>

<!-- Debug Information Panel -->
<div class="border-t border-base-300 pt-4">
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
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
      </svg>
      <span class="flex items-center gap-1">
        🔧 Debug Information
        {#if isDebugVisible}
          <span class="badge badge-xs badge-primary">Active</span>
        {/if}
      </span>
    </button>
  </div>

  <!-- Debug Content (Collapsible) -->
  {#if isDebugVisible}
    <div class="space-y-4 rounded-lg bg-base-200 p-4">
      <!-- Basic Information -->
      <div>
        <h4 class="mb-2 text-sm font-semibold text-base-content">Basic Information</h4>
        <div class="grid grid-cols-1 gap-3 text-xs md:grid-cols-2">
          <div class="flex items-center justify-between rounded bg-base-100 p-2">
            <span class="text-base-content/70">Event ID:</span>
            <div class="flex items-center gap-2">
              <code class="font-mono text-xs">{event.id.slice(0, 8)}...{event.id.slice(-4)}</code>
              <button
                class="btn text-base-content/50 btn-ghost btn-xs hover:text-base-content"
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
                class="btn text-base-content/50 btn-ghost btn-xs hover:text-base-content"
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
          <div class="flex items-center justify-between rounded bg-base-100 p-2">
            <span class="text-base-content/70">Kind:</span>
            <code class="font-mono text-xs" title={getKindDescription(event.kind)}
              >{event.kind}</code
            >
          </div>
          <div class="flex items-center justify-between rounded bg-base-100 p-2">
            <span class="text-base-content/70">Created by:</span>
            <div class="flex items-center gap-2">
              <code class="font-mono text-xs"
                >{event.pubkey.slice(0, 8)}...{event.pubkey.slice(-4)}</code
              >
              <button
                class="btn text-base-content/50 btn-ghost btn-xs hover:text-base-content"
                onclick={copyCreatedBy}
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
                class="btn text-base-content/50 btn-ghost btn-xs hover:text-base-content"
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
          {#if event.dTag}
            <div class="flex items-center justify-between rounded bg-base-100 p-2">
              <span class="text-base-content/70">dTag:</span>
              <code class="font-mono text-xs">{event.dTag}</code>
            </div>
          {/if}
        </div>
      </div>

      <!-- Technical Details -->
      <div>
        <h4 class="mb-2 text-sm font-semibold text-base-content">Technical Details</h4>
        <div class="space-y-2 text-xs">
          <div class="flex items-center justify-between rounded bg-base-100 p-2">
            <span class="text-base-content/70">Created:</span>
            <code class="font-mono text-xs">{formatTimestamp(event.createdAt)}</code>
          </div>
          {#if event.start}
            <div class="flex items-center justify-between rounded bg-base-100 p-2">
              <span class="text-base-content/70">Start (raw):</span>
              <code class="font-mono text-xs">{formatTimestamp(event.start)}</code>
            </div>
          {/if}
          {#if event.end}
            <div class="flex items-center justify-between rounded bg-base-100 p-2">
              <span class="text-base-content/70">End (raw):</span>
              <code class="font-mono text-xs">{formatTimestamp(event.end)}</code>
            </div>
          {/if}
          {#if event.geohash}
            <div class="flex items-center justify-between rounded bg-base-100 p-2">
              <span class="text-base-content/70">Geohash:</span>
              <code class="font-mono text-xs">{event.geohash}</code>
            </div>
          {/if}
          {#if /** @type {any} */ (event).signature}
            <div class="flex items-center justify-between rounded bg-base-100 p-2">
              <span class="text-base-content/70">Signature:</span>
              <code class="font-mono text-xs"
                >{/** @type {any} */ (event).signature.slice(0, 8)}...{/** @type {any} */ (
                  event
                ).signature.slice(-4)}</code
              >
            </div>
          {/if}
        </div>
      </div>

      <!-- Tags Information -->
      {#if /** @type {any} */ (event).tags && /** @type {any} */ (event).tags.length > 0}
        <div>
          <h4 class="mb-2 text-sm font-semibold text-base-content">
            Tags ({/** @type {any} */ (event).tags.length})
          </h4>
          <div class="max-h-32 overflow-y-auto rounded bg-base-100 p-2">
            <pre class="font-mono text-xs text-base-content/80">{getFormattedJson(
                /** @type {any} */ (event).tags
              )}</pre>
          </div>
        </div>
      {/if}

      <!-- Raw Content -->
      {#if /** @type {any} */ (event).content}
        <div>
          <h4 class="mb-2 text-sm font-semibold text-base-content">Raw Content</h4>
          <div class="max-h-24 overflow-y-auto rounded bg-base-100 p-2">
            <pre
              class="font-mono text-xs whitespace-pre-wrap text-base-content/80">{/** @type {any} */ (
                event
              ).content}</pre>
          </div>
        </div>
      {/if}

      <!-- Component Event Object -->
      <div>
        <div class="mb-2 flex items-center justify-between">
          <h4 class="text-sm font-semibold text-base-content">Component Event Object</h4>
          <div class="flex items-center gap-2">
            <button
              class="btn btn-ghost btn-xs"
              onclick={() =>
                copyToClipboard(JSON.stringify(event, null, 2), 'Component Event Object')}
              title="Copy component event JSON"
            >
              <svg class="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                />
              </svg>
              Copy
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
          <pre class="font-mono text-xs text-base-content/80">{getFormattedJson(event)}</pre>
        </div>
      </div>

      <!-- Raw Nostr Event -->
      {#if /** @type {any} */ (event).rawEvent}
        <div>
          <div class="mb-2 flex items-center justify-between">
            <h4 class="text-sm font-semibold text-base-content">Raw Nostr Event</h4>
            <div class="flex items-center gap-2">
              <button
                class="btn btn-ghost btn-xs"
                onclick={() =>
                  copyToClipboard(
                    JSON.stringify(/** @type {any} */ (event).rawEvent, null, 2),
                    'Raw Nostr Event'
                  )}
                title="Copy raw Nostr event JSON"
              >
                <svg class="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                  />
                </svg>
                Copy
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
            <pre class="font-mono text-xs text-base-content/80">{getFormattedJson(
                /** @type {any} */ (event).rawEvent
              )}</pre>
          </div>
        </div>
      {/if}
    </div>
  {/if}
</div>
