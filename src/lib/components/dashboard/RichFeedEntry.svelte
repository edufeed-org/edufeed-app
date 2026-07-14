<!--
  RichFeedEntry — renders a feed event with its kind-specific rich card via
  the shared FeedEntryCard resolver. Kinds without a rich renderer fall back
  to the snippet passed by the parent (compact FeedCard in the dashboard feed).
-->
<script>
  import FeedEntryCard from '$lib/components/shared/FeedEntryCard.svelte';

  /**
   * @type {{
   *   event: any,
   *   authorProfile?: any,
   *   authorProfiles?: Map<string, any>,
   *   activeUser?: any,
   *   fallback?: import('svelte').Snippet
   * }}
   */
  let {
    event,
    authorProfile = null,
    authorProfiles = new Map(),
    activeUser = null,
    fallback
  } = $props();
</script>

<FeedEntryCard {event} {authorProfile} {authorProfiles} {activeUser} {fallback} />
