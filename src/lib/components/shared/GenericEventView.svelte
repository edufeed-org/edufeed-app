<!--
  GenericEventView — detail page for any event kind the app has no dedicated
  view for (the three detail routes fall back to it).

  Shows what every Nostr event carries regardless of kind: author strip with
  date (DetailHeader), a title from `title`/`name`/`subject`/NIP-31 `alt`, the
  content (JSON as a code block, text through NostrContentRenderer), reactions,
  NIP-89 "open in another app" links and NIP-22 comments.
-->
<script>
  import * as m from '$lib/paraglide/messages';
  import { useActiveUser } from '$lib/stores/accounts.svelte.js';
  import { deleteEvent } from '$lib/helpers/eventDeletion.js';
  import { showToast } from '$lib/helpers/toast.js';
  import { formatRelativeTime } from '$lib/helpers/calendar.js';
  import { getGenericEventTitle, parseJsonContent } from '$lib/helpers/nip89.js';
  import DetailHeader from './DetailHeader.svelte';
  import NostrContentRenderer from './NostrContentRenderer.svelte';
  import AppHandlerList from './AppHandlerList.svelte';
  import ReactionBar from '../reactions/ReactionBar.svelte';
  import CommentList from '../comments/CommentList.svelte';

  /**
   * @typedef {Object} Props
   * @property {any} event - Any Nostr event
   * @property {string} [communityPubkey] - Community hex pubkey for #h tag on comments
   */

  /** @type {Props} */
  let { event, communityPubkey = undefined } = $props();

  const getActiveUser = useActiveUser();
  const activeUser = $derived(getActiveUser());
  const isAuthor = $derived(activeUser?.pubkey === event.pubkey);

  const kindLabel = $derived(m.generic_event_kind_label({ kind: event.kind }));
  const title = $derived(getGenericEventTitle(event));
  const json = $derived(parseJsonContent(event.content));
  const hasText = $derived(typeof event.content === 'string' && event.content.trim().length > 0);
  const relativeDate = $derived(formatRelativeTime(event.created_at));

  async function handleDelete() {
    if (!activeUser || !event) return;
    const result = await deleteEvent(event, activeUser);
    if (result.success) {
      showToast(m.thread_detail_delete_success(), 'success');
      history.back();
    } else {
      showToast(result.error || m.thread_detail_delete_failed(), 'error');
      throw new Error(result.error || 'Delete failed');
    }
  }
</script>

<article class="generic-event mx-auto max-w-4xl">
  <DetailHeader
    title={title ?? kindLabel}
    {event}
    authorPubkey={event.pubkey}
    date={relativeDate}
    onDelete={isAuthor ? handleDelete : undefined}
    deleteTitle={m.thread_detail_delete_confirm_title()}
    deleteItemName={title ?? kindLabel}
  >
    {#snippet metadata()}
      {#if title}
        <span class="badge badge-outline badge-sm" data-testid="generic-event-kind"
          >{kindLabel}</span
        >
      {/if}
    {/snippet}
  </DetailHeader>

  <p class="mb-6 text-sm text-base-content/60">
    {m.generic_event_limited_notice({ kind: event.kind })}
  </p>

  <!-- Content -->
  <div class="mb-6">
    {#if json}
      <pre
        class="overflow-x-auto rounded-box bg-base-200 p-4 text-xs"
        data-testid="generic-event-json"><code>{JSON.stringify(json, null, 2)}</code></pre>
    {:else if hasText}
      <NostrContentRenderer {event} />
    {:else}
      <p class="text-base-content/60">{m.generic_event_no_content()}</p>
    {/if}
  </div>

  <!-- Reactions -->
  <div class="mb-6" id="reactions">
    <ReactionBar {event} />
  </div>

  <!-- Other apps that can open this kind (NIP-89) -->
  <div class="mb-6">
    <AppHandlerList {event} />
  </div>

  <!-- Comments -->
  <div class="mt-6">
    <CommentList rootEvent={event} {activeUser} collapsedReplies={true} {communityPubkey} />
  </div>
</article>
