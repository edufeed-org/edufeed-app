<script>
  import { onMount, tick } from 'svelte';
  import { nip19 } from 'nostr-tools';
  // Imports directly from the concord submodule (not the barrel) — same
  // convention as PrivateChannelsView.svelte: bridge.svelte.js has no
  // top-level package imports, so this stays SSR-clean. The c/[pubkey]
  // community route already disables SSR (see src/routes/c/+layout.js), so
  // this buys defense-in-depth + consistency with the rest of channels/, not
  // a load-bearing SSR requirement for this component specifically.
  import { useObservable } from '$lib/concord/bridge.svelte.js';
  import {
    saveScrollPosition,
    recallScrollPosition,
    isNearBottom
  } from '$lib/helpers/scroll-memory.js';
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
  import {
    aggregateChannelReactions,
    getConcordReplyParentId,
    detectMentionQuery,
    applyMention
  } from '$lib/concord/chat-helpers.js';
  import { getMessageAttachments, stripAttachmentUrls } from '$lib/concord/attachments.js';
  import { aggregateThreads } from '$lib/concord/threads.js';
  import {
    parsePoll,
    collectVotes,
    tallyPollVotes,
    buildVoteTemplate,
    isPollEnded
  } from '$lib/concord/polls.js';
  import {
    parseChannelEvents,
    collectRsvps,
    buildRsvpTemplate
  } from '$lib/concord/channel-events.js';
  import { verifyZapRumor, verifyOnchainZapRumor, tallyZaps } from '$lib/concord/zaps.js';
  import ChatMessageList from '$lib/components/chat/ChatMessageList.svelte';
  import ChatMessageRow from '$lib/components/chat/ChatMessageRow.svelte';
  import MessageAttachments from './MessageAttachments.svelte';
  import ThreadPanel from './ThreadPanel.svelte';
  import PollMessage from './PollMessage.svelte';
  import ChannelEventsBar from './ChannelEventsBar.svelte';
  import ReactionChips from '$lib/components/reactions/ReactionChips.svelte';
  import MentionAutocomplete from './MentionAutocomplete.svelte';
  import { showToast } from '$lib/helpers/toast';
  import { getChannelLevel, setChannelLevel } from '$lib/concord/notifications.svelte.js';
  import * as m from '$lib/paraglide/messages';

  let {
    community,
    channel,
    dissolved = false,
    isOwner = false,
    canCreateInvite = false,
    canManageChannels = false,
    channelCount = 1,
    openOverlay,
    onBack
  } = $props();

  const communityId = $derived(community?.material?.community_id ?? '');
  const notifLevel = $derived(getChannelLevel(communityId, channel.channel_id));
  const LEVELS = /** @type {const} */ ([
    ['all', m.concord_notif_level_all],
    ['mentions', m.concord_notif_level_mentions],
    ['nothing', m.concord_notif_level_nothing]
  ]);

  const getActiveUser = useActiveUser();
  // ConcordRumorStore#timeline() returns Observable<Rumor[]> (verified against
  // applesauce-core-concord's EventModels#timeline — same TimelineModel the
  // rest of the app uses) — newest-first, like every other TimelineModel
  // consumer (see Chat.svelte), so we reverse before rendering.
  // Kind-1068 NIP-88 polls are timeline rows alongside kind-9 messages
  // (Armada renders both in the main chat; votes stay side events).
  const getMessages = useObservable(
    () => community?.channelStore(channel.channel_id).timeline([{ kinds: [9, 1068] }]),
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

  // Kind-1111 thread comments live in the same per-channel store; they are
  // NOT timeline rows (NIP-C7 keeps threads out of the main chat) — only the
  // per-root badge and the ThreadPanel consume them.
  const getComments = useObservable(
    () => community?.channelStore(channel.channel_id).timeline([{ kinds: [1111] }]),
    /** @type {any[]} */ ([])
  );
  const threadsByRoot = $derived(aggregateThreads(getComments()));
  /** Root rumor of the open thread, or null. @type {any} */
  let threadRoot = $state(null);

  // Kind-1018 poll votes, bucketed by the poll they e-reference. The tally
  // itself (latest-per-pubkey, endsAt cutoff) happens per poll row below.
  const getVotes = useObservable(
    () => community?.channelStore(channel.channel_id).timeline([{ kinds: [1018] }]),
    /** @type {any[]} */ ([])
  );
  const votesByPoll = $derived(collectVotes(getVotes()));

  /** @param {import('$lib/concord/polls.js').ParsedPoll} poll @param {string[]} optionIds */
  async function votePoll(poll, optionIds) {
    try {
      await community.sendEvent(channel.channel_id, buildVoteTemplate(poll.id, optionIds));
    } catch (err) {
      console.error('poll vote failed', err);
      showToast(m.concord_send_failed(), 'error');
    }
  }

  // NIP-52 events (31922/31923) + RSVPs (31925) — surfaced in the events bar
  // above the chat, never as timeline rows (CORD.md "Calendar Events").
  const getChannelEvents = useObservable(
    () => community?.channelStore(channel.channel_id).timeline([{ kinds: [31922, 31923] }]),
    /** @type {any[]} */ ([])
  );
  const channelEvents = $derived(parseChannelEvents(getChannelEvents()));
  const getRsvps = useObservable(
    () => community?.channelStore(channel.channel_id).timeline([{ kinds: [31925] }]),
    /** @type {any[]} */ ([])
  );
  const rsvpsByEvent = $derived(collectRsvps(getRsvps()));

  /** @param {string} eventId @param {import('$lib/concord/channel-events.js').RsvpStatus} status */
  async function sendRsvp(eventId, status) {
    try {
      await community.sendEvent(channel.channel_id, buildRsvpTemplate(eventId, status));
    } catch (err) {
      console.error('rsvp failed', err);
      showToast(m.concord_send_failed(), 'error');
    }
  }

  // CORD.md zaps (9735 payer receipts + 8333 on-chain). Verification is
  // async (WebCrypto sha256 of the preimage) and a rumor's tags never
  // change, so verdicts cache per rumor id; only VERIFIED payments reach
  // the tally, deduped by payment proof (hash/txid), never by rumor id.
  const getZapRumors = useObservable(
    () => community?.channelStore(channel.channel_id).timeline([{ kinds: [9735, 8333] }]),
    /** @type {any[]} */ ([])
  );
  /** rumor id -> verified zap entry | null (failed). @type {Record<string, any>} */
  let zapVerdicts = $state({});
  // Deliberately NOT a SvelteSet: the $effect below both reads and mutates
  // it — a reactive set would make the effect depend on its own writes.
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  const zapInFlight = new Set();
  $effect(() => {
    for (const rumor of getZapRumors()) {
      if (rumor.id in zapVerdicts || zapInFlight.has(rumor.id)) continue;
      zapInFlight.add(rumor.id);
      resolveZap(rumor).then((verdict) => {
        zapVerdicts[rumor.id] = verdict;
      });
    }
  });
  /** @param {any} rumor */
  async function resolveZap(rumor) {
    const target = rumor.tags?.find((/** @type {string[]} */ t) => t[0] === 'e')?.[1];
    if (!target) return null;
    const amount = Number(rumor.tags?.find((/** @type {string[]} */ t) => t[0] === 'amount')?.[1]);
    const ms = rumor.ms ?? (rumor.created_at ?? 0) * 1000;
    if (rumor.kind === 8333) {
      const txid = verifyOnchainZapRumor(rumor);
      // on-chain amounts are whole sats; tallies are msat-denominated
      return txid ? { target, proof: txid, pubkey: rumor.pubkey, msats: amount * 1000, ms } : null;
    }
    const hash = await verifyZapRumor(rumor);
    return hash ? { target, proof: hash, pubkey: rumor.pubkey, msats: amount, ms } : null;
  }
  const zapTallies = $derived(tallyZaps(Object.values(zapVerdicts).filter(Boolean)));

  let text = $state('');
  let sending = $state(false);
  let menuOpen = $state(false);
  /** @type {{id: string, author: string, preview: string}|null} */
  let replyTo = $state(null);
  /** @type {HTMLElement|undefined} */
  let scrollContainer;

  /** @type {HTMLInputElement | undefined} */
  let inputEl = $state(undefined);
  let mention = $state(/** @type {{start: number, query: string} | null} */ (null));
  let mentionIndex = $state(0);
  // Member profiles for the @-picker (getProfiles above only covers message
  // authors; lurkers must be mentionable too).
  const getMemberProfiles = useProfileMap(() => [...getMembers()]);
  const mentionCandidates = $derived.by(() => {
    if (!mention) return [];
    const q = mention.query.toLowerCase();
    const me = getActiveUser()?.pubkey;
    return [...getMembers()]
      .filter((pubkey) => pubkey !== me)
      .map((pubkey) => ({
        pubkey,
        name: getUserDisplayName(pubkey, getMemberProfiles().get(pubkey)),
        profile: getMemberProfiles().get(pubkey)
      }))
      .filter((c) => !q || c.name.toLowerCase().includes(q))
      .slice(0, 8);
  });

  function refreshMention() {
    mention = inputEl ? detectMentionQuery(text, inputEl.selectionStart ?? text.length) : null;
    mentionIndex = 0;
  }

  /** @param {string} pubkey */
  async function pickMention(pubkey) {
    if (!mention || !inputEl) return;
    const caret = inputEl.selectionStart ?? text.length;
    const result = applyMention(text, mention.start, caret, nip19.npubEncode(pubkey));
    text = result.text;
    mention = null;
    inputEl.focus();
    // Restore the caret via tick(), which resolves on the microtask queue
    // right after Svelte flushes the new value into the DOM — ahead of any
    // next keystroke. A rAF-deferred restore demonstrably loses that race
    // (Task 11 live smoke: 0/8 restored with instant typing after a pick).
    await tick();
    inputEl?.setSelectionRange(result.caret, result.caret);
  }

  /** @param {KeyboardEvent} event */
  function onComposerKeydown(event) {
    if (!mention || mentionCandidates.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      mentionIndex = (mentionIndex + 1) % mentionCandidates.length;
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      mentionIndex = (mentionIndex - 1 + mentionCandidates.length) % mentionCandidates.length;
    } else if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault();
      pickMention(mentionCandidates[mentionIndex].pubkey);
    } else if (event.key === 'Escape') {
      mention = null;
    }
  }

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

  // Scroll behaviour (laoc, 2026-08-11): pinned to the newest message until
  // the reader scrolls away — the timeline can rebuild non-monotonically
  // while messages stream in, so a one-shot "scroll when messages arrive"
  // lands mid-stream. A saved position from this session is restored instead
  // when they left mid-scroll.
  const scrollKey = $derived(channel?.channel_id ? `concord:${channel.channel_id}` : null);
  let pinnedToBottom = true;
  let restored = false;

  // Late-loading media (authed blobs on buzz resolve seconds after the last
  // message lands) grows the content without a count change and would strand
  // the view above the bottom. `load` doesn't bubble, but a capture-phase
  // listener on the container sees every descendant image/video finish.
  function handleContentLoad() {
    if (pinnedToBottom && scrollContainer) {
      scrollContainer.scrollTop = scrollContainer.scrollHeight;
    }
  }

  // Reactive mirror of pinnedToBottom, for the jump-to-bottom helper button
  // (common chat UX — laoc, 2026-08-11).
  let atBottom = $state(true);

  function handleScroll() {
    if (!scrollContainer) return;
    pinnedToBottom = isNearBottom(scrollContainer);
    atBottom = pinnedToBottom;
  }

  function jumpToBottom() {
    if (!scrollContainer) return;
    pinnedToBottom = true;
    atBottom = true;
    scrollContainer.scrollTop = scrollContainer.scrollHeight;
  }

  $effect(() => {
    // Read the reactive dep BEFORE any early return (project gotcha: an
    // effect that returns before reading state captures no dependency and
    // never re-runs).
    const count = messages.length;
    if (count === 0 || !scrollContainer) return;
    if (!restored) {
      restored = true;
      const saved = recallScrollPosition(scrollKey);
      if (saved && !saved.atBottom) {
        pinnedToBottom = false;
        scrollContainer.scrollTop = saved.top;
        return;
      }
    }
    if (pinnedToBottom) scrollContainer.scrollTop = scrollContainer.scrollHeight;
  });
  $effect(() => {
    return () => {
      if (!scrollContainer || !restored) return;
      saveScrollPosition(scrollKey, {
        top: scrollContainer.scrollTop,
        atBottom: isNearBottom(scrollContainer)
      });
    };
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
  {#if !dissolved && canCreateInvite}
    <button
      class="btn btn-ghost btn-sm"
      data-testid="concord-header-invite"
      onclick={() => openOverlay('invite')}
    >
      ✉ {m.concord_menu_invite()}
    </button>
  {/if}
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
        {#if !dissolved && canCreateInvite}
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
        <li class="menu-title text-xs">{m.concord_notif_level_label()}</li>
        {#each LEVELS as [level, label] (level)}
          <li>
            <button
              class={notifLevel === level ? 'active' : ''}
              onclick={() => setChannelLevel(communityId, channel.channel_id, level)}
            >
              {notifLevel === level ? '✓' : ''}
              {label()}
            </button>
          </li>
        {/each}
        {#if canManageChannels && !dissolved && channelCount > 1}
          <li>
            <button
              class="text-error"
              data-testid="concord-menu-delete-channel"
              onclick={() => {
                menuOpen = false;
                openOverlay('delete-channel');
              }}>{m.concord_menu_delete_channel()}</button
            >
          </li>
        {/if}
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
  <div
    class="flex items-center gap-3 border-b border-base-300 bg-base-200 px-4 py-2 text-sm text-base-content/70"
  >
    <span class="flex-1">{m.concord_dissolved_banner()}</span>
    {#if isOwner}
      <button
        class="btn btn-xs btn-neutral"
        data-testid="concord-dissolved-recover"
        onclick={() => openOverlay('create')}>{m.concord_dissolved_recover()}</button
      >
    {/if}
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
<ChannelEventsBar
  events={channelEvents}
  {rsvpsByEvent}
  myPubkey={getActiveUser()?.pubkey}
  readOnly={dissolved}
  onRsvp={sendRsvp}
/>
<div
  class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4"
  bind:this={scrollContainer}
  onscroll={handleScroll}
  onloadcapture={handleContentLoad}
>
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
      {@const atts = getMessageAttachments(message)}
      <ChatMessageRow
        message={atts.length > 0
          ? { ...message, content: stripAttachmentUrls(message.content, atts) }
          : message}
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
        {#snippet attachments()}
          {#if atts.length > 0}
            <MessageAttachments attachments={atts} />
          {/if}
          {#if message.kind === 1068}
            {@const poll = parsePoll(message)}
            <PollMessage
              {poll}
              tally={tallyPollVotes(
                votesByPoll.get(poll.id) ?? [],
                poll.options,
                poll.endsAt,
                getActiveUser()?.pubkey
              )}
              ended={isPollEnded(poll.endsAt)}
              onVote={(optionIds) => votePoll(poll, optionIds)}
            />
          {/if}
        {/snippet}
        {#snippet reactions(/** @type {any} */ msg)}
          {@const thread = threadsByRoot.get(msg.id)}
          {@const zaps = zapTallies.get(msg.id)}
          <div class="flex items-center gap-2">
            {#if zaps}
              <span
                class="badge gap-0.5 badge-ghost text-xs"
                data-testid="zap-tally"
                title="{zaps.count}×">⚡ {Math.floor(zaps.totalMsats / 1000)}</span
              >
            {/if}
            <ReactionChips
              aggregated={reactionsByTarget.get(msg.id) ?? new Map()}
              addButtonOnHover
              onToggle={(emoji, summary) => toggleReaction(msg, emoji, summary)}
              onPick={(emoji) => react(msg, emoji)}
            />
            {#if thread}
              <button
                type="button"
                class="btn gap-1 text-xs text-primary btn-ghost btn-xs"
                data-testid="thread-badge"
                onclick={() => (threadRoot = message)}
              >
                💬 {m.concord_thread_replies({ count: thread.count })}
              </button>
            {:else}
              <button
                type="button"
                class="btn opacity-0 btn-ghost transition-opacity btn-xs group-hover:opacity-70 hover:!opacity-100"
                data-testid="thread-start"
                title={m.concord_thread_open()}
                onclick={() => (threadRoot = message)}
              >
                💬
              </button>
            {/if}
          </div>
        {/snippet}
      </ChatMessageRow>
    {/snippet}
  </ChatMessageList>
  {#if !atBottom}
    <!-- sticky inside the scroller: floats at the bottom edge while reading
         history, takes no layout height -->
    <div class="sticky bottom-2 z-10 flex h-0 justify-end overflow-visible pr-2">
      <button
        type="button"
        data-testid="chat-jump-to-bottom"
        class="btn btn-circle -translate-y-full shadow-md btn-sm"
        title={m.chat_jump_to_bottom()}
        aria-label={m.chat_jump_to_bottom()}
        onclick={jumpToBottom}>↓</button
      >
    </div>
  {/if}
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
  <div class="relative">
    <MentionAutocomplete
      candidates={mentionCandidates}
      highlightIndex={mentionIndex}
      onSelect={pickMention}
    />
    <!-- Beige pill on the paper pane — same treatment as the public
      community chat's composer (Chat.svelte). -->
    <form
      class="m-4 mt-0 flex shrink-0 items-center gap-2 rounded-full border border-base-300 bg-base-200 p-1.5"
      onsubmit={(e) => {
        e.preventDefault();
        // Enter-while-picking never reaches here (onComposerKeydown
        // preventDefaults it), so any submit — notably a Send-button click
        // with the picker still open — must close the picker and send.
        mention = null;
        send();
      }}
    >
      <input
        class="input flex-1 input-ghost focus:outline-none"
        data-testid="concord-chat-input"
        bind:this={inputEl}
        bind:value={text}
        oninput={refreshMention}
        onclick={refreshMention}
        onkeydown={onComposerKeydown}
        placeholder={m.concord_input_placeholder({ name: channel.name })}
      />
      <button
        class="btn btn-circle btn-sm btn-neutral"
        type="submit"
        disabled={sending || !text.trim()}>➤</button
      >
    </form>
  </div>
{/if}

{#if threadRoot}
  <ThreadPanel
    {community}
    {channel}
    root={threadRoot}
    readOnly={dissolved}
    onClose={() => (threadRoot = null)}
  />
{/if}
