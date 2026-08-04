<!--
  ThreadPanel — one message's NIP-22 thread (kind-1111 comments) in a Concord
  channel, Armada-parity: root message on top, replies oldest-first, composer
  at the bottom. Distinct from inline quote-replies (kind-9 `q` tags), which
  stay in the main timeline.

  Sends through community.sendEvent(channelId, template) so the CORD-03
  channel/epoch binding + sealing are identical to every other rumor; the
  template itself (threads.js) matches Armada's buildV2CommentTags tag-for-tag.
-->
<script>
  import { useObservable } from '$lib/concord/bridge.svelte.js';
  import { threadRepliesFor, buildThreadReplyTemplate } from '$lib/concord/threads.js';
  import { getMessageAttachments, stripAttachmentUrls } from '$lib/concord/attachments.js';
  import { useProfileMap } from '$lib/stores/profile-map.svelte.js';
  import { useActiveUser } from '$lib/stores/accounts.svelte';
  import { formatMessageTimestamp, getUserDisplayName } from '$lib/helpers/message-utils.js';
  import ChatMessageRow from '$lib/components/chat/ChatMessageRow.svelte';
  import MessageAttachments from './MessageAttachments.svelte';
  import { showToast } from '$lib/helpers/toast';
  import * as m from '$lib/paraglide/messages';

  /** @type {{community: any, channel: any, root: any, readOnly?: boolean, onClose: () => void}} */
  let { community, channel, root, readOnly = false, onClose } = $props();

  const getActiveUser = useActiveUser();
  const getComments = useObservable(
    () => community?.channelStore(channel.channel_id).timeline([{ kinds: [1111] }]),
    /** @type {any[]} */ ([])
  );
  const replies = $derived(threadRepliesFor(getComments(), root.id));
  const getProfiles = useProfileMap(() => [root.pubkey, ...replies.map((r) => r.pubkey)]);

  let text = $state('');
  let sending = $state(false);

  async function send() {
    const value = text.trim();
    if (!value || sending) return;
    sending = true;
    try {
      await community.sendEvent(channel.channel_id, buildThreadReplyTemplate(root, value));
      text = '';
    } catch (err) {
      console.error('thread reply failed', err);
      showToast(m.concord_send_failed(), 'error');
    } finally {
      sending = false;
    }
  }
</script>

{#snippet threadRow(/** @type {any} */ rumor)}
  {@const atts = getMessageAttachments(rumor)}
  <ChatMessageRow
    message={atts.length > 0
      ? { ...rumor, content: stripAttachmentUrls(rumor.content, atts) }
      : rumor}
    isOwnMessage={rumor.pubkey === getActiveUser()?.pubkey}
    displayName={getUserDisplayName(rumor.pubkey, getProfiles().get(rumor.pubkey))}
    timestamp={formatMessageTimestamp(rumor.created_at)}
    profile={getProfiles().get(rumor.pubkey)}
  >
    {#snippet attachments()}
      {#if atts.length > 0}
        <MessageAttachments attachments={atts} />
      {/if}
    {/snippet}
  </ChatMessageRow>
{/snippet}

<aside
  class="fixed inset-y-0 right-0 z-40 flex w-full max-w-md flex-col border-l border-base-300 bg-base-100 shadow-xl"
  aria-label={m.concord_thread_title()}
>
  <header class="flex items-center justify-between border-b border-base-300 px-4 py-3">
    <h3 class="text-sm font-bold">{m.concord_thread_title()}</h3>
    <button
      type="button"
      class="btn btn-ghost btn-xs"
      onclick={onClose}
      title={m.concord_thread_close()}
    >
      ✕
    </button>
  </header>

  <div class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
    {@render threadRow(root)}
    {#if replies.length > 0}
      <div class="divider my-0 text-xs text-base-content/50">
        {m.concord_thread_replies({ count: replies.length })}
      </div>
      {#each replies as reply (reply.id)}
        {@render threadRow(reply)}
      {/each}
    {/if}
  </div>

  {#if !readOnly}
    <form
      class="flex gap-2 border-t border-base-300 p-3"
      onsubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      <input
        type="text"
        bind:value={text}
        class="input-bordered input input-sm flex-1"
        placeholder={m.concord_thread_reply_placeholder()}
        disabled={sending}
      />
      <button type="submit" class="btn btn-sm btn-primary" disabled={sending || !text.trim()}>
        {m.concord_thread_send()}
      </button>
    </form>
  {/if}
</aside>
