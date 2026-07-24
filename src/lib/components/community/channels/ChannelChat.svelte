<script>
  import { onMount } from 'svelte';
  // Imports directly from the concord submodule (not the barrel) — same
  // convention as PrivateChannelsView.svelte: bridge.svelte.js has no
  // top-level package imports, so this stays SSR-clean. The c/[pubkey]
  // community route already disables SSR (see src/routes/c/+layout.js), so
  // this buys defense-in-depth + consistency with the rest of channels/, not
  // a load-bearing SSR requirement for this component specifically.
  import { useObservable } from '$lib/concord/bridge.svelte.js';
  import { sendChannelMessage } from '$lib/concord/send-message.js';
  import { useProfileMap } from '$lib/stores/profile-map.svelte.js';
  import { useActiveUser } from '$lib/stores/accounts.svelte';
  import {
    formatMessageTimestamp,
    getUserDisplayName,
    groupMessagesByDate
  } from '$lib/helpers/message-utils.js';
  // NOTE: message-utils.js's getReplyParentId() is NOT used here — concord
  // replies carry a NIP-C7 `q` tag, not a NIP-10 marked `e` tag. See the
  // rationale (with dist references) in chat-helpers.js.
  import { aggregateChannelReactions, getConcordReplyParentId } from '$lib/concord/chat-helpers.js';
  import ChatMessageList from '$lib/components/chat/ChatMessageList.svelte';
  import ChatMessageRow from '$lib/components/chat/ChatMessageRow.svelte';
  import ReactionChips from '$lib/components/reactions/ReactionChips.svelte';
  import { showToast } from '$lib/helpers/toast';
  import * as m from '$lib/paraglide/messages';

  let { community, channel, dissolved = false, isOwner = false, openOverlay, onBack } = $props();

  const getActiveUser = useActiveUser();
  // ConcordRumorStore#timeline() returns Observable<Rumor[]> (verified against
  // applesauce-core-concord's EventModels#timeline — same TimelineModel the
  // rest of the app uses) — newest-first, like every other TimelineModel
  // consumer (see Chat.svelte), so we reverse before rendering.
  const getMessages = useObservable(
    () => community?.channelStore(channel.channel_id).timeline([{ kinds: [9] }]),
    /** @type {any[]} */ ([])
  );
  const messages = $derived([...getMessages()].reverse());
  const getProfiles = useProfileMap(() => messages.map((r) => r.pubkey));
  // groupMessagesByDate returns a FLAT array of
  // {type:'separator', date} | {type:'message', message} items (verified
  // against message-utils.js — NOT nested {date, messages[]} groups as a
  // naive reading might assume). Mirrors the public Chat.svelte rendering.
  const grouped = $derived(groupMessagesByDate(messages));
  const getMembers = useObservable(() => community?.members$, new Set());

  // Kind-7 reaction rumors live in the same per-channel store as kind-9
  // messages (community.react() publishes to the same {plane:'channel'}
  // target as sendMessage — verified in
  // applesauce-concord/dist/client/community.js).
  const getReactions = useObservable(
    () => community?.channelStore(channel.channel_id).timeline([{ kinds: [7] }]),
    /** @type {any[]} */ ([])
  );
  /** message id → Map<emoji, ReactionSummary> — pure aggregation, tested in
   *  concord-chat-helpers.test.js. Same summary shape as the public chat's
   *  aggregateReactions() (helpers/reactions.js) so both feed the identical
   *  ReactionChips presentational component (full reply/reaction parity). */
  const reactionsByTarget = $derived(
    aggregateChannelReactions(getReactions(), getActiveUser()?.pubkey)
  );

  let text = $state('');
  let sending = $state(false);
  let menuOpen = $state(false);
  /** @type {{id: string, author: string, preview: string}|null} */
  let replyTo = $state(null);
  /** @type {HTMLElement|undefined} */
  let scrollContainer;

  // Dismissible "back up your key" bar. localStorage is read inside
  // onMount (not module scope), which only runs client-side post-mount —
  // belt and suspenders even though the c/[pubkey] route already disables
  // SSR. onMount (not $effect) because there's no reactive dependency to
  // track — an effect that only assigns from a non-reactive read trips
  // eslint's svelte/prefer-writable-derived, and a $derived can't also be
  // set imperatively from dismissKeyBar() below.
  //
  // Namespaced per pubkey (final review, MINOR): a shared 'concord:keybar-
  // dismissed' key would leak across accounts on a shared browser profile —
  // account B would silently inherit account A's dismissal (or vice versa).
  // Undefined pubkey (no active user) skips the bar entirely rather than
  // falling back to an unnamespaced key.
  let showKeyBar = $state(false);
  onMount(() => {
    const pubkey = getActiveUser()?.pubkey;
    showKeyBar = !!pubkey && !localStorage.getItem(`concord:keybar-dismissed:${pubkey}`);
  });
  function dismissKeyBar() {
    const pubkey = getActiveUser()?.pubkey;
    if (pubkey) localStorage.setItem(`concord:keybar-dismissed:${pubkey}`, '1');
    showKeyBar = false;
  }

  $effect(() => {
    // Read the reactive dep BEFORE any early return (project gotcha: an
    // effect that returns before reading state captures no dependency and
    // never re-runs).
    const count = messages.length;
    if (count > 0 && scrollContainer) scrollContainer.scrollTop = scrollContainer.scrollHeight;
  });

  async function send() {
    const body = text.trim();
    if (!body || sending) return;
    sending = true;
    try {
      await sendChannelMessage(
        community,
        channel.channel_id,
        body,
        replyTo ?? undefined,
        getActiveUser()?.pubkey ?? ''
      );
      text = '';
      replyTo = null;
    } catch (error) {
      // The dist (applesauce-concord/dist/helpers/keys.js `planeKeyFor`)
      // throws a plain `Error("unknown channel")` when the caller doesn't
      // hold the channel's key — there is no `MissingChannelKeyError` class
      // in the shipped dist, so we match by message rather than by name.
      // In practice ChannelChat only renders for accessible (key-holding)
      // channels, so this is a defensive fallback (e.g. a mid-session Rekey
      // that revokes access while the pane is still open).
      const errorMessage = error instanceof Error ? error.message : '';
      if (errorMessage === 'unknown channel') showToast(m.concord_no_key_error(), 'error');
      else showToast(m.concord_send_failed(), 'error');
      console.error('concord: send failed', error);
    } finally {
      sending = false;
    }
  }

  /**
   * Publish a reaction to a channel message. `community.react()` accepts a
   * plain unicode emoji or a NIP-30 custom-emoji object ({shortcode, url}),
   * matching ReactionFactory.create's `string | Emoji` signature (verified
   * against applesauce-concord/dist/client/community.js + applesauce-core's
   * Emoji type) — same shape EmojiPicker's onSelectCustom hands to onPick.
   *
   * @param {any} message
   * @param {string | { shortcode: string, url: string }} emoji
   */
  async function react(message, emoji) {
    try {
      await community.react(channel.channel_id, { id: message.id, author: message.pubkey }, emoji);
    } catch (error) {
      console.error('concord: react failed', error);
    }
  }

  /**
   * ReactionChips' onToggle for an EXISTING chip. There is no retract/unreact
   * method on ConcordCommunity yet (see chat-helpers.js's aggregateChannelReactions
   * doc comment), so re-clicking an emoji the user already reacted with is a
   * silent no-op rather than publishing a duplicate reaction rumor.
   *
   * @param {any} message
   * @param {string} emoji
   * @param {import('$lib/concord/chat-helpers.js').ChannelReactionSummary} summary
   */
  function toggleReaction(message, emoji, summary) {
    if (summary.userReacted) return;
    react(message, emoji);
  }
</script>

<header class="flex shrink-0 items-center gap-3 border-b border-base-300 bg-base-100 px-4 py-3">
  <button class="btn btn-circle btn-ghost btn-sm md:hidden" onclick={onBack}>←</button>
  <div class="min-w-0 flex-1">
    <h2 class="flex items-center gap-2 font-extrabold">
      {channel.private ? '🔒' : '#'}
      {channel.name} <span class="badge badge-xs font-bold uppercase badge-accent">Beta</span>
    </h2>
    <p class="truncate text-xs text-base-content/60">
      {m.concord_chat_subtitle()}
      <button class="link" onclick={() => openOverlay('explainer')}
        >{m.concord_how_it_works()}</button
      >
    </p>
  </div>
  <button
    class="btn btn-ghost btn-sm"
    data-testid="concord-members-button"
    onclick={() => openOverlay('members')}
  >
    👥 {getMembers().size}
  </button>
  <div class="dropdown dropdown-end">
    <button
      class="btn btn-circle btn-ghost btn-sm"
      data-testid="concord-chat-menu"
      onclick={() => (menuOpen = !menuOpen)}>⋯</button
    >
    {#if menuOpen}
      <ul
        class="dropdown-content menu z-30 w-60 rounded-box border border-base-300 bg-base-100 p-1 shadow-lg"
      >
        {#if !dissolved}
          <li>
            <button
              data-testid="concord-menu-invite"
              onclick={() => {
                menuOpen = false;
                openOverlay('invite');
              }}>{m.concord_menu_invite()}</button
            >
          </li>
        {/if}
        <li>
          <button
            onclick={() => {
              menuOpen = false;
              openOverlay('members');
            }}>{m.concord_menu_members()}</button
          >
        </li>
        <li>
          <button
            onclick={() => {
              menuOpen = false;
              openOverlay('backup');
            }}>{m.concord_menu_backup()}</button
          >
        </li>
        {#if isOwner && !dissolved}
          <li>
            <button
              class="text-error"
              onclick={() => {
                menuOpen = false;
                openOverlay('dissolve');
              }}>{m.concord_menu_dissolve()}</button
            >
          </li>
        {/if}
      </ul>
    {/if}
  </div>
</header>

{#if dissolved}
  <div class="border-b border-base-300 bg-base-200 px-4 py-2 text-sm text-base-content/70">
    {m.concord_dissolved_banner()}
  </div>
{:else if showKeyBar}
  <div
    class="flex shrink-0 items-center gap-3 border-b border-warning/30 bg-warning/10 px-4 py-2 text-sm"
  >
    🔑 <span class="flex-1"><b>{m.concord_keybar_title()}</b> {m.concord_keybar_body()}</span>
    <button class="btn btn-xs btn-neutral" onclick={() => openOverlay('backup')}
      >{m.concord_keybar_action()}</button
    >
    <button class="btn btn-circle btn-ghost btn-xs" onclick={dismissKeyBar}>✕</button>
  </div>
{/if}

<!-- min-h-0 is load-bearing: without it, a flex-col child's default
  min-height:auto lets this grow to full message-list content height instead
  of shrinking to the pane's allotted space, pushing the composer off-screen
  and leaking scroll up to the page/main level on long chats. -->
<div class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4" bind:this={scrollContainer}>
  <div class="mx-auto max-w-md py-3 text-center text-sm text-base-content/60">
    <div class="text-lg">🔒</div>
    <b>{m.concord_genesis_title({ name: channel.name })}</b>
    <p class="mt-1 text-xs">{m.concord_genesis_body()}</p>
  </div>
  <ChatMessageList items={grouped}>
    {#snippet row(/** @type {any} */ message)}
      {@const mine = message.pubkey === getActiveUser()?.pubkey}
      {@const parentId = getConcordReplyParentId(message)}
      {@const replyParent = parentId ? messages.find((p) => p.id === parentId) : null}
      <ChatMessageRow
        {message}
        isOwnMessage={mine}
        displayName={getUserDisplayName(message.pubkey, getProfiles().get(message.pubkey))}
        timestamp={formatMessageTimestamp(message.created_at)}
        profile={getProfiles().get(message.pubkey)}
        replyPreview={replyParent
          ? {
              displayName: getUserDisplayName(
                replyParent.pubkey,
                getProfiles().get(replyParent.pubkey)
              ),
              content: replyParent.content
            }
          : null}
        onReply={(msg) =>
          (replyTo = { id: msg.id, author: msg.pubkey, preview: msg.content.slice(0, 80) })}
        replyTitle={m.concord_reply()}
      >
        {#snippet reactions(/** @type {any} */ msg)}
          <ReactionChips
            aggregated={reactionsByTarget.get(msg.id) ?? new Map()}
            addButtonOnHover
            onToggle={(emoji, summary) => toggleReaction(msg, emoji, summary)}
            onPick={(emoji) => react(msg, emoji)}
          />
        {/snippet}
      </ChatMessageRow>
    {/snippet}
  </ChatMessageList>
</div>

{#if dissolved}
  <div
    class="m-4 shrink-0 rounded-full bg-base-200 p-3 text-center text-sm font-semibold text-base-content/60"
  >
    🔒 {m.concord_read_only()}
  </div>
{:else}
  {#if replyTo}
    <div class="mx-4 flex items-center gap-2 rounded-t-xl bg-base-200 px-3 py-1.5 text-xs">
      ↩ <span class="flex-1 truncate">{replyTo.preview}</span>
      <button class="btn btn-circle btn-ghost btn-xs" onclick={() => (replyTo = null)}>✕</button>
    </div>
  {/if}
  <form
    class="m-4 mt-0 flex shrink-0 items-center gap-2 rounded-full border border-base-300 bg-base-100 p-1.5"
    onsubmit={(e) => {
      e.preventDefault();
      send();
    }}
  >
    <input
      class="input flex-1 input-ghost focus:outline-none"
      data-testid="concord-chat-input"
      bind:value={text}
      placeholder={m.concord_input_placeholder({ name: channel.name })}
    />
    <button
      class="btn btn-circle btn-sm btn-neutral"
      type="submit"
      disabled={sending || !text.trim()}>➤</button
    >
  </form>
{/if}
