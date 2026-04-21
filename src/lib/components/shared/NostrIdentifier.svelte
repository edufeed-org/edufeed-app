<!--
  NostrIdentifier Component
  Main router component that detects NIP-19 identifier type and delegates to appropriate preview
-->

<script>
  import {
    decodeNostrIdentifier,
    isCalendarEventIdentifier,
    isCalendarIdentifier,
    isWikiIdentifier
  } from '$lib/helpers/nostrUtils.js';
  import CalendarEventPreview from './NostrPreviews/CalendarEventPreview.svelte';
  import CalendarPreview from './NostrPreviews/CalendarPreview.svelte';
  import WikiPreview from './NostrPreviews/WikiPreview.svelte';
  import UserProfilePreview from './NostrPreviews/UserProfilePreview.svelte';
  import NotePreview from './NostrPreviews/NotePreview.svelte';
  import FallbackIdentifier from './NostrPreviews/FallbackIdentifier.svelte';

  let { identifier, inline = false, depth = 0 } = $props();

  let decoded = $derived(decodeNostrIdentifier(identifier));
  let isCalendarEvent = $derived(isCalendarEventIdentifier(decoded));
  let isCalendar = $derived(isCalendarIdentifier(decoded));
  let isWiki = $derived(isWikiIdentifier(decoded));
  let isUser = $derived(
    decoded.success && (decoded.type === 'npub' || decoded.type === 'nprofile')
  );
  let isNote = $derived(decoded.success && (decoded.type === 'note' || decoded.type === 'nevent'));
</script>

{#if isCalendarEvent}
  <CalendarEventPreview {identifier} {decoded} {inline} />
{:else if isCalendar}
  <CalendarPreview {identifier} {decoded} {inline} />
{:else if isUser}
  <UserProfilePreview {identifier} {decoded} />
{:else if isWiki}
  <WikiPreview {identifier} {decoded} {inline} />
{:else if isNote}
  <NotePreview {identifier} {depth} />
{:else}
  <FallbackIdentifier {identifier} {decoded} />
{/if}
