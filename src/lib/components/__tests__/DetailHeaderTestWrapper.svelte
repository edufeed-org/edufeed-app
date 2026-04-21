<script>
  import DetailHeader from '../shared/DetailHeader.svelte';
  import EventTags from '../calendar/EventTags.svelte';

  /** @type {{ title?: string, subtitle?: string, showMetadata?: boolean, tags?: string[], authorPubkey?: string }} */
  let {
    title = 'Test Title',
    subtitle = undefined,
    showMetadata = false,
    tags = [],
    authorPubkey = ''
  } = $props();

  // Minimal mock event for DetailHeader
  const event = {
    id: 'test-id',
    kind: 1,
    pubkey: 'a'.repeat(64),
    tags: [],
    created_at: 0,
    content: '',
    sig: 'a'.repeat(128)
  };
</script>

{#if showMetadata}
  <DetailHeader {title} {subtitle} {event} {authorPubkey}>
    {#snippet metadata()}
      <div data-testid="metadata-content">
        <EventTags {tags} size="xs" maxDisplay={3} targetRoute="/discover" />
      </div>
    {/snippet}
  </DetailHeader>
{:else}
  <DetailHeader {title} {subtitle} {event} {authorPubkey} />
{/if}
