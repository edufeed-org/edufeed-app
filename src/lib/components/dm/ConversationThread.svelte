<script>
  import { resolve } from '$app/paths';
  import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
  import { useActiveUser } from '$lib/stores/accounts.svelte';
  import { useProfileMap } from '$lib/stores/profile-map.svelte.js';
  import { useUserEmojiSets } from '$lib/stores/user-emoji-sets.svelte.js';
  import { WrappedMessagesGroup, LegacyMessagesGroup } from 'applesauce-common/models';
  import { getWrappedMessageParent } from 'applesauce-common/helpers/wrapped-messages';
  import { getLegacyMessageParent } from 'applesauce-common/helpers/legacy-messages';
  import { getEncryptedContent } from 'applesauce-core/helpers/encrypted-content';
  import {
    SendWrappedMessage,
    ReplyToWrappedMessage,
    SendLegacyMessage,
    ReplyToLegacyMessage
  } from 'applesauce-actions/actions';
  import { actionRunnerOptimistic } from '$lib/stores/action-runner.svelte.js';
  import {
    markConversationAsRead,
    ensureLegacyMessagesUnlocked,
    fetchLegacyConversationHistory
  } from '$lib/services/dm-service.svelte.js';
  import {
    isLegacyConversationId,
    normalizeLegacyMessage,
    looksLikeNip04Ciphertext
  } from '$lib/helpers/dm.js';
  import { ensureDmRelayList } from '$lib/services/dm-relay-backfill.js';
  import { ensureRecipientDmRelays } from '$lib/services/dm-recipient-relays.js';
  import {
    formatMessageTimestamp,
    getUserDisplayName as getDisplayName,
    groupMessagesByDate
  } from '$lib/helpers/message-utils.js';
  import { showToast } from '$lib/helpers/toast.js';
  import { swipeable } from '$lib/helpers/swipe.js';
  import NostrContentRenderer from '$lib/components/shared/NostrContentRenderer.svelte';
  import ProfileAvatar from '$lib/components/shared/ProfileAvatar.svelte';
  import EmojiPicker from '$lib/components/shared/EmojiPicker.svelte';
  import {
    SmilePlusIcon,
    SendIcon,
    ReplyIcon,
    ChevronLeftIcon,
    AlertIcon
  } from '$lib/components/icons';
  import * as m from '$lib/paraglide/messages';
  import { profileLink } from '$lib/helpers/nostrUtils.js';

  /**
   * @type {{
   *   conversationId: string,
   *   participants: string[],
   *   onBack?: () => void
   * }}
   */
  let { conversationId, participants, onBack } = $props();

  const getActiveUser = useActiveUser();

  // Legacy (NIP-04) conversations are marked insecure and use the kind-4
  // send/decrypt path (still writable, so NIP-04-only peers can be answered).
  // The `legacy:`-prefixed conversation id is the single signal the page passes
  // through, so we derive the mode from it here.
  let isLegacy = $derived(isLegacyConversationId(conversationId));

  // Message state.
  // `rawMessages` holds the events as they come from the applesauce model:
  // decrypted rumors for NIP-17, or raw kind-4 events for legacy (whose
  // plaintext lives on a cached symbol, resolved in the `messages` derivation).
  /** @type {any[]} */
  let rawMessages = $state.raw([]);
  // Legacy-only: ids whose NIP-04 decrypt threw, so the thread renders a
  // placeholder instead of a blank bubble. Reset on conversation switch.
  /** @type {Set<string>} */
  let failedLegacyIds = $state.raw(new Set());
  // Legacy-only: bumped after an async unlock resolves. unlockLegacyMessage
  // writes plaintext to a non-reactive symbol cache without re-emitting the
  // model, so the `messages` derivation must be retriggered explicitly or the
  // freshly-decrypted bubbles stay blank until the next open.
  let legacyDecryptTick = $state(0);
  let newMessage = $state('');
  let isSending = $state(false);
  let showEmojiPicker = $state(false);
  /** @type {any} */
  let replyingTo = $state(null);
  /** @type {HTMLTextAreaElement | undefined} */
  let messageInput = $state(undefined);

  // Custom emoji state
  const getUserEmojiSets = useUserEmojiSets();
  let customEmojiSets = $derived(getUserEmojiSets());
  /** @type {Record<string, { shortcode: string, url: string }>} */
  let usedCustomEmojis = {};

  // Track last-marked timestamp to avoid redundant markConversationAsRead calls
  // (plain let, not $state, to avoid reactive tracking)
  let lastMarkedTimestamp = 0;

  // Subscribe to conversation messages.
  // Locally-sent gift wraps are added to EventStore by actionRunnerOptimistic and
  // expose their rumor synchronously via getGiftWrapRumor() (see applesauce
  // gift-wrap symbol contract — covered by giftwrap-rumor-contract.test.js),
  // so we don't need a parallel "pending" optimistic state.
  $effect(() => {
    const user = getActiveUser();
    if (!user || !conversationId) return;

    lastMarkedTimestamp = 0; // Reset on conversation switch
    failedLegacyIds = new Set();

    if (isLegacy) {
      // Legacy NIP-04 thread: subscribe to the kind-4 group for the single
      // correspondent and store the raw events. The service NIP-04-decrypts
      // each one (it holds the signer); unlock writes plaintext back to the
      // EventStore and re-emits, so locked messages resolve on a later tick.
      // Ids that fail to decrypt are tracked so the derivation can flag them.
      const correspondent = participants.find((p) => p !== user.pubkey) ?? participants[0];
      // Backfill the peer's inbound kind-4 history from *their* relays. The
      // standing gift-wrap subscription only covers the user's own relays, so
      // a NIP-04-only peer's messages (published to their write relays) would
      // otherwise never reach the store. Fire-and-forget; the model emits again
      // as events land.
      fetchLegacyConversationHistory(user.pubkey, correspondent);
      const sub = eventStore
        .model(LegacyMessagesGroup, user.pubkey, correspondent)
        .subscribe((msgs) => {
          // timeline is newest-first; reverse to oldest-first for display
          const list = (msgs || []).toReversed();
          console.debug('[dm] legacy thread emission', {
            correspondent: correspondent?.slice(0, 8),
            count: list.length,
            // 'in' = authored by the correspondent, 'out' = authored by us. If
            // the partner's messages never appear, the kind-4 inbound events
            // aren't in the store (relay coverage), not a render bug.
            directions: list.map((m) => (m.pubkey === user.pubkey ? 'out' : 'in'))
          });
          rawMessages = list;
          ensureLegacyMessagesUnlocked(list).then((failed) => {
            if (failed.size > 0) failedLegacyIds = new Set([...failedLegacyIds, ...failed]);
            // Retrigger the derivation so newly-cached plaintext is read, even
            // when nothing failed (the unlock mutates a non-reactive cache).
            legacyDecryptTick++;
          });
        });
      return () => sub.unsubscribe();
    }

    const sub = eventStore
      .model(WrappedMessagesGroup, user.pubkey, participants)
      .subscribe((msgs) => {
        // WrappedMessagesGroup returns newest-first, we need oldest-first
        const next = (msgs || []).toReversed();
        console.debug('[dm] ConversationThread emission', {
          conversationId,
          count: next.length
        });
        rawMessages = next;
      });

    return () => sub.unsubscribe();
  });

  // Resolve the rendered message list. For legacy threads the plaintext lives on
  // a cached symbol set asynchronously by the unlock flow; the unlock re-emits
  // the model via notifyEventUpdate, and `legacyDecryptTick` is a belt-and-braces
  // retrigger for the case where the cached plaintext lands without a fresh
  // emission. `failedLegacyIds` covers the decrypt-failure case. Cached content
  // that still looks like NIP-04 ciphertext (a bad/stale cache entry) is treated
  // as a failed decrypt so we never render raw ciphertext. NIP-17 rumors are
  // already plaintext, passed through.
  /** @type {any[]} */
  let messages = $derived.by(() => {
    if (!isLegacy) return rawMessages;
    void legacyDecryptTick; // dependency: retrigger after an async unlock resolves
    return rawMessages.map((ev) => {
      const cached = getEncryptedContent(ev);
      const isStaleCiphertext = looksLikeNip04Ciphertext(cached);
      const plaintext = isStaleCiphertext ? undefined : cached;
      const decryptFailed =
        isStaleCiphertext || (plaintext === undefined && failedLegacyIds.has(ev.id));
      return normalizeLegacyMessage(ev, plaintext ?? '', decryptFailed);
    });
  });

  // Prefetch recipients' kind 10050 DM relays into the EventStore as soon as the
  // conversation opens, so by send time SendWrappedMessage can route gift wraps
  // to the recipient's chosen relays (it resolves relays from the store only).
  $effect(() => {
    const user = getActiveUser();
    if (!user) return;
    const recipients = participants.filter((p) => p !== user.pubkey);
    if (recipients.length === 0) return;
    ensureRecipientDmRelays(recipients).catch((err) =>
      console.warn('[dm] recipient relay prefetch failed', err)
    );
  });

  // Mark conversation as read when messages load or update
  $effect(() => {
    if (messages.length > 0 && conversationId) {
      const latestTimestamp = messages[messages.length - 1]?.created_at;
      if (latestTimestamp && latestTimestamp > lastMarkedTimestamp) {
        lastMarkedTimestamp = latestTimestamp;
        markConversationAsRead(conversationId, latestTimestamp);
      }
    }
  });

  // Profile loading for participants + message authors
  const getProfiles = useProfileMap(() => [...participants, ...messages.map((msg) => msg.pubkey)]);
  let userProfiles = $derived(getProfiles());

  // Group messages by date
  let groupedMessages = $derived(groupMessagesByDate(messages));

  /** @param {string} pubkey */
  function getUserDisplayName(pubkey) {
    return getDisplayName(pubkey, userProfiles.get(pubkey));
  }

  // Auto-scroll
  /** @type {HTMLElement} */
  let chatContainer;
  let prevMessageCount = 0;
  $effect(() => {
    const totalCount = messages.length;
    if (chatContainer && totalCount > 0) {
      const isNewMessage = totalCount > prevMessageCount;
      const isNearBottom =
        chatContainer.scrollHeight - chatContainer.scrollTop - chatContainer.clientHeight < 100;
      if (prevMessageCount === 0 || (isNewMessage && isNearBottom)) {
        requestAnimationFrame(() => {
          if (chatContainer) chatContainer.scrollTop = chatContainer.scrollHeight;
        });
      }
      prevMessageCount = totalCount;
    }
  });

  /** @param {Event} event */
  async function sendMessage(event) {
    event.preventDefault();

    const user = getActiveUser();
    if (!user || !newMessage.trim()) return;

    const content = newMessage.trim();
    newMessage = '';
    isSending = true;

    try {
      if (isLegacy) {
        // Legacy NIP-04 reply: send a kind-4 back to the correspondent so their
        // (NIP-04-only) client can read it. ensureRecipientDmRelays loads the
        // correspondent's kind 10002/10050 into the store so SendLegacyMessage
        // can route to their inbox relays. The signed kind-4 is added to the
        // EventStore by the action runner; the service decrypts our own outgoing
        // message on the next tick so it renders.
        const correspondent = participants.find((p) => p !== user.pubkey) ?? participants[0];
        await ensureRecipientDmRelays([correspondent]);
        if (replyingTo) {
          await actionRunnerOptimistic.run(ReplyToLegacyMessage, replyingTo, content);
        } else {
          await actionRunnerOptimistic.run(SendLegacyMessage, correspondent, content);
        }
      } else {
        // Backfill the sender's kind 10050 DM relay list if they predate the
        // signup-time default, so replies can reach them.
        await ensureDmRelayList();
        // Ensure recipient DM relays are in the EventStore so the action can route
        // the gift wrap per NIP-17 (the prefetch effect may not have settled yet).
        await ensureRecipientDmRelays(participants.filter((p) => p !== user.pubkey));
        // actionRunnerOptimistic returns as soon as the gift wrap is signed and
        // added to EventStore — WrappedMessagesGroup picks it up immediately via
        // the synchronous rumor symbol, giving the user instant feedback without
        // a parallel pending state. Relay publish runs in the background.
        if (replyingTo) {
          await actionRunnerOptimistic.run(ReplyToWrappedMessage, replyingTo, content);
        } else {
          await actionRunnerOptimistic.run(SendWrappedMessage, participants, content);
        }
      }
      replyingTo = null;
      usedCustomEmojis = {};
    } catch (err) {
      console.error('Failed to send DM:', err);
      newMessage = content;
      showToast(m.dm_send_failed(), 'error');
    } finally {
      isSending = false;
    }
  }

  /** @param {KeyboardEvent} event */
  function handleKeydown(event) {
    // Enter sends, Shift+Enter inserts a newline
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      sendMessage(event);
    }
  }

  /** @param {string} emoji */
  function insertEmoji(emoji) {
    newMessage += emoji;
    showEmojiPicker = false;
    messageInput?.focus();
  }

  /** @param {{ shortcode: string, url: string }} emoji */
  function insertCustomEmoji(emoji) {
    newMessage += `:${emoji.shortcode}:`;
    usedCustomEmojis[emoji.shortcode] = emoji;
    showEmojiPicker = false;
    messageInput?.focus();
  }

  /**
   * Get the conversation display name (other participants).
   * @returns {string}
   */
  function getHeaderName() {
    const user = getActiveUser();
    const others = participants.filter((p) => p !== user?.pubkey);
    if (others.length === 0) return m.dm_self_note();
    return others.map((p) => getDisplayName(p, userProfiles.get(p))).join(', ');
  }

  /**
   * Get the primary other participant's pubkey for the header avatar.
   * @returns {string | undefined}
   */
  function getHeaderPubkey() {
    const activeUser = getActiveUser();
    const others = participants.filter((p) => p !== activeUser?.pubkey);
    return others[0] || participants[0];
  }
</script>

<div class="flex h-full min-h-0 flex-col">
  <!-- Thread header -->
  <div class="flex items-center gap-2 border-b border-base-300 px-4 py-3">
    {#if onBack}
      <button class="btn btn-circle btn-ghost btn-sm" onclick={onBack}>
        <ChevronLeftIcon class_="h-5 w-5" />
      </button>
    {/if}
    {#if getHeaderPubkey()}
      {@const headerPubkey = getHeaderPubkey() ?? ''}
      <ProfileAvatar
        pubkey={headerPubkey}
        profile={userProfiles.get(headerPubkey)}
        size="sm"
        linkToProfile
        showHoverCard
      />
    {/if}
    <h3 class="truncate font-bold">{getHeaderName()}</h3>
  </div>

  <!-- Legacy (NIP-04) insecure notice -->
  {#if isLegacy}
    <div
      class="flex items-start gap-2 border-b border-warning/30 bg-warning/10 px-4 py-2 text-xs text-base-content/80"
      role="note"
    >
      <AlertIcon class_="mt-0.5 h-4 w-4 shrink-0 text-warning" />
      <span>{m.dm_legacy_insecure_banner()}</span>
    </div>
  {/if}

  <!-- Messages -->
  <div bind:this={chatContainer} class="flex-1 space-y-1 overflow-y-auto px-4 py-2">
    {#if messages.length === 0}
      <div class="py-8 text-center text-base-content/50">
        {m.dm_no_messages()}
      </div>
    {:else}
      {#each groupedMessages as item, i (item.type === 'separator' ? `sep-${item.date}-${i}` : item.message.id)}
        {#if item.type === 'separator'}
          <div class="divider text-xs text-base-content/40">{item.date}</div>
        {:else}
          {@const message = item.message}
          {@const isOwnMessage = getActiveUser() && message.pubkey === getActiveUser()?.pubkey}
          {@const parentId = isLegacy
            ? getLegacyMessageParent(message)
            : getWrappedMessageParent(message)}
          <div
            class="group chat {isOwnMessage ? 'chat-end' : 'chat-start'}"
            use:swipeable={{
              onSwipe: () => {
                replyingTo = message;
                messageInput?.focus();
              },
              direction: isOwnMessage ? 'left' : 'right'
            }}
          >
            {#if !isOwnMessage}
              <ProfileAvatar
                pubkey={message.pubkey}
                profile={userProfiles.get(message.pubkey)}
                size="sm"
                linkToProfile
                class="chat-image"
              />
            {/if}

            <div class="chat-header mb-1 flex items-center gap-1 text-xs opacity-70">
              {#if !isOwnMessage}
                <a
                  href={resolve(profileLink(message.pubkey))}
                  class="font-semibold hover:underline"
                >
                  {getUserDisplayName(message.pubkey)}
                </a>
                <span>&middot;</span>
              {/if}
              <time datetime={new Date(message.created_at * 1000).toISOString()}>
                {formatMessageTimestamp(message.created_at)}
              </time>
              <button
                type="button"
                onclick={() => {
                  replyingTo = message;
                  messageInput?.focus();
                }}
                class="ml-1 opacity-0 transition-opacity group-hover:opacity-70 hover:!opacity-100"
                title="Reply"
              >
                <ReplyIcon class="h-3.5 w-3.5" />
              </button>
            </div>

            <div class="chat-bubble {isOwnMessage ? 'chat-bubble-primary' : ''}">
              {#if parentId}
                {@const parent = messages.find((msg) => msg.id === parentId)}
                {#if parent}
                  <div
                    class="mb-1 rounded border-l-2 border-primary/40 bg-base-300/50 px-2 py-1 text-xs text-base-content/70"
                  >
                    <span class="font-semibold">{getUserDisplayName(parent.pubkey)}</span>
                    <p class="truncate">{parent.content}</p>
                  </div>
                {/if}
              {/if}
              {#if message.decryptFailed}
                <span class="text-sm text-base-content/50 italic">{m.dm_decrypt_failed()}</span>
              {:else}
                <NostrContentRenderer event={message} />
              {/if}
            </div>
          </div>
        {/if}
      {/each}
    {/if}
  </div>

  <!-- Legacy (NIP-04) replies are allowed too: we send a kind-4 back so the
       correspondent's client (e.g. Primal, which only reads NIP-04) can see it.
       The insecure banner above keeps the metadata trade-off explicit. -->
  <!-- Spacer for fixed input on mobile -->
  <div class="h-28 shrink-0 lg:hidden"></div>

  <!-- Input: fixed on mobile (above tab bar), relative on desktop -->
  <div
    class="fixed right-0 bottom-[4.5rem] left-0 z-40 bg-base-100 px-4 pt-2 pb-2 lg:relative lg:bottom-auto lg:z-auto lg:bg-transparent lg:pb-4"
  >
    {#if showEmojiPicker}
      <div
        class="absolute bottom-full left-4 z-10 mb-2 flex max-h-80 w-72 flex-col rounded-lg bg-base-200 shadow-xl"
      >
        <EmojiPicker onSelect={insertEmoji} {customEmojiSets} onSelectCustom={insertCustomEmoji} />
      </div>
    {/if}

    {#if replyingTo}
      <div class="flex items-center gap-2 rounded-t-2xl bg-base-200 px-4 py-2 text-sm shadow-md">
        <ReplyIcon class="h-4 w-4 shrink-0 text-base-content/60" />
        <span class="font-medium text-base-content/60">{getUserDisplayName(replyingTo.pubkey)}</span
        >
        <span class="min-w-0 flex-1 truncate text-base-content/80">{replyingTo.content}</span>
        <button type="button" onclick={() => (replyingTo = null)} class="btn btn-ghost btn-xs">
          ✕
        </button>
      </div>
    {/if}

    <form
      onsubmit={sendMessage}
      class="flex items-end gap-2 {replyingTo
        ? 'rounded-t-none rounded-b-3xl'
        : 'rounded-3xl'} bg-base-200 px-2 py-1 shadow-md"
    >
      <button
        type="button"
        onclick={() => (showEmojiPicker = !showEmojiPicker)}
        class="btn btn-circle shrink-0 btn-ghost btn-sm"
        title="Emoji"
      >
        <SmilePlusIcon class="h-5 w-5" />
      </button>

      <textarea
        bind:this={messageInput}
        bind:value={newMessage}
        rows="1"
        placeholder={m.dm_input_placeholder()}
        class="max-h-40 min-h-[2rem] min-w-0 flex-1 resize-none border-none bg-transparent py-1.5 leading-snug focus:outline-none"
        style="field-sizing: content;"
        disabled={isSending}
        onfocus={() => (showEmojiPicker = false)}
        onkeydown={handleKeydown}
        required
      ></textarea>

      <button
        type="submit"
        class="btn btn-circle shrink-0 btn-sm btn-primary"
        disabled={!newMessage.trim() || isSending}
      >
        {#if isSending}
          <span class="loading loading-sm loading-spinner"></span>
        {:else}
          <SendIcon class="h-4 w-4" />
        {/if}
      </button>
    </form>
  </div>
</div>

{#if showEmojiPicker}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 z-[9]"
    onclick={() => (showEmojiPicker = false)}
    onkeydown={(e) => {
      if (e.key === 'Escape') showEmojiPicker = false;
    }}
  ></div>
{/if}
