<!--
  GroupChat — NIP-29 relay-group chat (Armada parity). One group = one relay
  (`host'id`): metadata (39000), admins (39001), and members (39002) are
  relay-authored addressables read from THAT relay only, chat is kind 9 with
  an `h` tag — the exact shape the public community chat speaks — so the
  rendering stack is the shared ChatMessageList/ChatMessageRow/ReactionChips.

  Everything publishes to the group's relay ONLY (never the user's outbox
  relays): messages, kind-7 reactions, and 9021/9022 join/leave requests.
  applesauce-relay answers NIP-42 AUTH challenges via relay.authenticate();
  closed groups that close the REQ with auth-required are surfaced as a
  banner v1 (join first, then reload).
-->
<script>
  import { goto } from '$app/navigation';
  import { eventStore, pool } from '$lib/stores/nostr-infrastructure.svelte';
  import { useActiveUser, manager } from '$lib/stores/accounts.svelte';
  import { useProfileMap } from '$lib/stores/profile-map.svelte.js';
  import { storeEvents } from 'applesauce-relay/operators';
  import { TimelineModel } from 'applesauce-core/models';
  import {
    GROUP_METADATA_KIND,
    GROUP_ADMINS_KIND,
    GROUP_MEMBERS_KIND,
    getGroupMetadata,
    getGroupAdmins,
    getGroupMembers
  } from 'applesauce-common/helpers/groups';
  import {
    buildGroupMessageTemplate,
    buildJoinRequestTemplate,
    buildLeaveRequestTemplate,
    isMembershipRefusal
  } from '$lib/groups/groups.js';
  import { updatePersonalGroupsList } from '$lib/groups/personal-groups-list.js';
  import { publishToGroupRelay } from '$lib/groups/group-management.js';
  import { unique } from '$lib/helpers/unique.js';
  import { setContext } from 'svelte';
  import { GROUP_MEDIA_AUTH } from '$lib/groups/authed-media.js';
  import {
    saveScrollPosition,
    recallScrollPosition,
    isNearBottom
  } from '$lib/helpers/scroll-memory.js';
  import { relayBadges, channelBadges } from '$lib/groups/group-badges.js';
  import { relayHref, relayLabel } from '$lib/groups/relay-directory.js';
  import { authenticateOnce } from '$lib/groups/relay-auth.js';
  import GroupBadges from '$lib/components/groups/GroupBadges.svelte';
  import GroupMembersModal from '$lib/components/groups/GroupMembersModal.svelte';
  import GroupSettingsSheet from '$lib/components/groups/GroupSettingsSheet.svelte';
  import { useRelayInformation } from '$lib/groups/relay-information.svelte.js';
  import { detachGroupChannel } from '$lib/groups/community-attach.js';
  import { parseGroupPointers, channelKey } from '$lib/groups/community-pointer.js';
  import { useJoinedCommunikeyEvents } from '$lib/helpers/joined-communikey-events.svelte.js';
  import { channelAccessLevel } from '$lib/groups/channel-access.js';
  import { relayRequiresAuth } from '$lib/groups/relay-directory.js';
  import { aggregateChannelReactions } from '$lib/concord/chat-helpers.js';
  import {
    formatMessageTimestamp,
    getUserDisplayName,
    getReplyParentId,
    groupMessagesByDate
  } from '$lib/helpers/message-utils.js';
  import { buildThreadIndex } from '$lib/helpers/threading.js';
  import ChatMessageList from '$lib/components/chat/ChatMessageList.svelte';
  import ChatMessageRow from '$lib/components/chat/ChatMessageRow.svelte';
  import ChatComposer from '$lib/components/chat/ChatComposer.svelte';
  import ThreadPanel from '$lib/components/chat/ThreadPanel.svelte';
  import ReactionChips from '$lib/components/reactions/ReactionChips.svelte';
  import { showToast } from '$lib/helpers/toast';
  import * as m from '$lib/paraglide/messages';

  /** @type {{pointer: import('$lib/groups/groups.js').GroupPointer}} */
  let { pointer } = $props();

  const getActiveUser = useActiveUser();
  // At component init, not inside a handler — hooks cannot be called from
  // async handlers (CLAUDE.md). Feeds the post-delete detach cascade below.
  const getJoinedCommunities = useJoinedCommunikeyEvents();

  // Media on this host is membership-gated (buzz answers 401 anonymously):
  // every ImageWithFallback below fetches same-host URLs with a signed
  // Blossom get auth instead of the anonymous proxy chain.
  setContext(GROUP_MEDIA_AUTH, { relay: pointer.relay, getUser: getActiveUser });

  /** @type {any} */ let metadata = $state(null);
  // The RAW kind:39000 as well as the parsed metadata: the access badges read
  // the tags directly, because applesauce's parser drops `restricted`/`hidden`
  // and reads openness from the inverse tags of an older NIP-29 draft.
  /** @type {any} */ let metadataEvent = $state.raw(null);

  // Small labels on the group's home (laoc, design round 1). Two sources:
  // what the HOST announces about itself, and what THIS group says about
  // getting in.
  const getRelayInfo = useRelayInformation(() => pointer.relay);
  const hostBadges = $derived(relayBadges(getRelayInfo()));
  const accessBadges = $derived(channelBadges(metadataEvent));

  // The disclosure line's access slot: when this group is linked into a
  // community, use THAT community's intent for it (members vs invited — the
  // relay's own kind:39000 cannot express the split, see access-choice.js);
  // a standalone group has no such pointer and falls back to `undefined`,
  // which channelAccessLevel reads as the stricter 'invited'.
  const linkedAccess = $derived.by(() => {
    const target = channelKey({ id: pointer.id, relay: pointer.relay });
    if (!target) return undefined;
    for (const communikeyEvent of getJoinedCommunities()) {
      const match = parseGroupPointers(communikeyEvent).find((p) => channelKey(p) === target);
      if (match) return match.access;
    }
    return undefined;
  });
  /** @type {Set<string>} */ let members = $state(new Set());
  // Same accounting as the rail's access glyph (channel-access.js): a group
  // without `private` on a host that gates every read behind NIP-42 is
  // readable by whoever the relay admits, not by the world — overstating
  // openness is the harmful direction.
  const disclosureLevel = $derived(
    channelAccessLevel(metadataEvent, { access: linkedAccess }, relayRequiresAuth(getRelayInfo()))
  );
  // The numeric members/invited line reads "0" while the roster hasn't
  // arrived yet (or is genuinely empty) — indistinguishable from "not
  // answered", so hide it rather than print a wrong number. The 'world' line
  // carries no count and is unaffected.
  const disclosure = $derived(
    disclosureLevel !== 'world' && members.size === 0 ? 'unknown' : disclosureLevel
  );
  /** @type {import('applesauce-common/helpers/groups').GroupAdmin[]} */
  let admins = $state.raw([]);
  let authRequired = $state(false);
  let isLoading = $state(true);
  /** @type {any[]} */ let messages = $state([]);
  /** @type {any[]} */ let reactionEvents = $state([]);

  // Bump to re-run the roster request below (e.g. after an admin action
  // changes the 39001/39002 events) without touching the chat subscription.
  let rosterSeq = $state(0);

  // Group metadata/roster: relay-authored addressables with d = group id,
  // requested from the group's own relay only.
  $effect(() => {
    rosterSeq; // read first: an effect that early-returns before reading
    // reactive state captures no deps and never re-runs on a bump.
    const sub = pool
      .relay(pointer.relay)
      .request(
        { kinds: [GROUP_METADATA_KIND, GROUP_ADMINS_KIND, GROUP_MEMBERS_KIND], '#d': [pointer.id] },
        { timeout: 8000 }
      )
      .subscribe({
        next: (/** @type {any} */ event) => {
          if (event.kind === GROUP_METADATA_KIND) {
            metadata = getGroupMetadata(event);
            metadataEvent = event;
          }
          if (event.kind === GROUP_ADMINS_KIND) {
            admins = getGroupAdmins(event) ?? [];
          }
          if (event.kind === GROUP_MEMBERS_KIND) {
            members = new Set(getGroupMembers(event) ?? []);
          }
        },
        error: () => {}
      });
    return () => sub.unsubscribe();
  });

  // One-shot NIP-42 retry: when the relay closes the REQ auth-required,
  // authenticate with the active signer and re-run the subscription effect.
  let retrySeq = $state(0);

  // Live chat + reactions from the group relay (same storeEvents +
  // TimelineModel pattern as the public community chat). NOTE: the model
  // filter keys on `#h` only — two groups sharing an id on DIFFERENT relays
  // would merge here; acceptable v1, ids are relay-scoped in practice.
  $effect(() => {
    retrySeq; // re-run after a successful NIP-42 authenticate
    isLoading = true;
    authRequired = false;
    const filter = { kinds: [9], '#h': [pointer.id] };
    const fallbackTimer = setTimeout(() => (isLoading = false), 4000);

    const subSub = pool
      .relay(pointer.relay)
      .subscription([
        { ...filter, limit: 100 },
        { kinds: [7], '#h': [pointer.id], limit: 200 }
      ])
      .pipe(storeEvents(eventStore))
      .subscribe({
        error: (/** @type {any} */ err) => {
          isLoading = false;
          if (String(err?.message ?? err).includes('auth-required')) {
            authRequired = true;
            const user = getActiveUser();
            if (user?.signer) {
              // Shared guard, not a local flag: the sidebar's directory hook
              // authenticates against this same relay on this same route, and
              // a second AUTH would make applesauce mark the connection
              // unauthenticated and block every read on it.
              authenticateOnce(pool.relay(pointer.relay), user.signer).then((response) => {
                // A refusal used to land here as success, because
                // authenticate() RESOLVES with {ok:false} rather than
                // throwing — so the chat cleared its own warning and retried
                // against a relay that had just said no.
                if (!response.ok) return;
                authRequired = false;
                retrySeq++;
              });
            }
          }
        }
      });

    const modelSub = eventStore.model(TimelineModel, filter).subscribe((events) => {
      messages = events;
      if (events.length > 0) isLoading = false;
    });
    const reactionsSub = eventStore
      .model(TimelineModel, { kinds: [7], '#h': [pointer.id] })
      .subscribe((events) => {
        reactionEvents = events;
      });

    return () => {
      clearTimeout(fallbackTimer);
      subSub.unsubscribe();
      modelSub.unsubscribe();
      reactionsSub.unsubscribe();
    };
  });

  const displayed = $derived(
    messages.filter((event) => event && event.id && event.pubkey).toReversed()
  );
  // Replies live in their thread, not in the timeline. An orphan — a reply
  // whose root fell outside the 100-event window — stays in the timeline
  // rather than disappearing.
  const threads = $derived(buildThreadIndex(displayed));
  const grouped = $derived(groupMessagesByDate(threads.timeline));

  // Scroll behaviour (laoc, 2026-08-11): the view starts PINNED to the newest
  // message and stays pinned through the streaming load — the timeline
  // rebuilds non-monotonically while the relay replays (thread folding), so
  // "scroll once when messages arrive" lands mid-stream and sticks at the
  // top. Only the reader's own scrolling away from the bottom unpins; a saved
  // position from this session is restored instead when they left mid-scroll.
  /** @type {HTMLDivElement | undefined} */
  let scrollContainer;
  const scrollKey = $derived(channelKey({ id: pointer.id, relay: pointer.relay }));
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
    // Self-correcting: a programmatic pin lands at the bottom and keeps the
    // flag; only a reader moving away clears it.
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
    const count = threads.timeline.length; // dep first — see effect gotcha
    if (!scrollContainer || count === 0) return;
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

  const getProfiles = useProfileMap(() => displayed.map((event) => event.pubkey));

  // Profiles for authors + roster, from the GROUP relay itself: members of a
  // closed host often have no kind-0 on our lookup relays, but the host has
  // them (Armada asks the same source). Value-stable key + debounce so the
  // streaming timeline cannot reopen the REQ per event (see host-unread).
  const profileAuthorsKey = $derived.by(() =>
    unique([
      ...displayed.map((event) => event.pubkey),
      ...admins.map((/** @type {any} */ admin) => admin.pubkey),
      ...members
    ])
      .sort()
      .join('\x1f')
  );
  $effect(() => {
    const key = profileAuthorsKey;
    if (!key) return;
    const authors = key.split('\x1f');
    /** @type {import('rxjs').Subscription | undefined} */ let sub;
    const timer = setTimeout(() => {
      sub = pool
        .relay(pointer.relay)
        .request({ kinds: [0], authors }, { timeout: 8000 })
        .pipe(storeEvents(eventStore))
        .subscribe({ error: () => {} });
    }, 300);
    return () => {
      clearTimeout(timer);
      sub?.unsubscribe();
    };
  });
  const reactionsByTarget = $derived(
    aggregateChannelReactions(reactionEvents, getActiveUser()?.pubkey)
  );
  const myPubkey = $derived(getActiveUser()?.pubkey);
  const isMember = $derived(!!myPubkey && members.has(myPubkey));
  const isAdmin = $derived(!!myPubkey && admins.some((a) => a.pubkey === myPubkey));

  // Management entry points: the members modal (Task 7) and the admin-only
  // settings sheet (Task 8) mount here once they exist.
  let membersOpen = $state(false);
  let settingsOpen = $state(false);
  // Wired to GroupMembersModal's onRosterChanged prop below. Bumps rosterSeq
  // immediately for a snappy UI, then schedules one more bump ~800ms later:
  // the relay's OK for a 9000/9001/9002 admin op doesn't guarantee the
  // 39001/39002 addressables it materialises are already updated by the time
  // the immediate re-request lands, so a stale roster from that first
  // request would otherwise never self-heal.
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let rosterHealTimer;
  const onRosterChanged = () => {
    rosterSeq++;
    clearTimeout(rosterHealTimer);
    rosterHealTimer = setTimeout(() => {
      rosterSeq++;
    }, 800);
  };
  $effect(() => {
    return () => clearTimeout(rosterHealTimer);
  });

  let text = $state('');
  let sending = $state(false);
  // The WHOLE message, not a {id, pubkey} projection: the thread root is read
  // off its tags. `$state.raw` because applesauce events must never be wrapped
  // in a deep state proxy (state_unsafe_mutation).
  /** @type {any} */
  let replyTo = $state.raw(null);

  // Thread panel: which root is open, plus its own draft and reply target.
  /** @type {string | null} */
  let openThreadId = $state(null);
  // Sticky for the session: expanding one thread panel expands the next too.
  let threadExpanded = $state(false);
  let threadText = $state('');
  /** @type {any} */
  let threadReplyTo = $state.raw(null);

  // Derived from the live index, so the panel follows the data: if the root
  // falls out of the window the panel closes itself rather than showing a
  // thread whose head is gone.
  const openThreadRoot = $derived(
    openThreadId ? (threads.timeline.find((event) => event.id === openThreadId) ?? null) : null
  );
  const openThreadReplies = $derived(openThreadId ? threads.repliesFor(openThreadId) : []);

  /** @param {number} count */
  const replyCountLabel = (count) =>
    count === 1 ? m.chat_thread_reply_one() : m.chat_thread_reply_many({ count });

  /** @param {any} message */
  function openThread(message) {
    openThreadId = message.id;
    threadReplyTo = null;
    threadText = '';
  }

  function closeThread() {
    openThreadId = null;
    threadReplyTo = null;
    threadText = '';
  }

  /**
   * Sign a template and publish it to the group relay only, with the shared
   * one-shot NIP-42 retry: relays like groups.hzrd149.com only recognise
   * members on AUTHed connections, and a write before the handshake comes
   * back "blocked: unknown member".
   * @param {any} template
   */
  async function signAndPublish(template) {
    const user = getActiveUser();
    if (!user) throw new Error('no active user');
    return publishToGroupRelay(pool.relay(pointer.relay), template, user);
  }

  /**
   * @param {string} value
   * @param {any} replyTarget the message being replied to, tags included
   * @returns {Promise<boolean>} whether it went out
   */
  async function publishMessage(value, replyTarget) {
    try {
      const signed = await signAndPublish(
        buildGroupMessageTemplate(pointer.id, value, replyTarget)
      );
      eventStore.add(signed);
      return true;
    } catch (err) {
      console.error('group send failed', err);
      if (isMembershipRefusal(err)) showToast(m.groups_join_required(), 'warning');
      else showToast(m.groups_send_failed(), 'error');
      return false;
    }
  }

  async function send() {
    const value = text.trim();
    if (!value || sending) return;
    sending = true;
    if (await publishMessage(value, replyTo)) {
      text = '';
      replyTo = null;
    }
    sending = false;
  }

  async function sendInThread() {
    const value = threadText.trim();
    // With no explicit target the reply goes to the thread root, which is what
    // the panel's own input reads as.
    const target = threadReplyTo ?? openThreadRoot;
    if (!value || sending || !target) return;
    sending = true;
    if (await publishMessage(value, target)) {
      threadText = '';
      threadReplyTo = null;
    }
    sending = false;
  }

  /**
   * @param {any} msg
   * @param {string | {shortcode: string, url: string}} emoji plain unicode, or a
   *   NIP-30 custom emoji (content becomes :shortcode: with an emoji tag)
   */
  async function react(msg, emoji) {
    const custom = typeof emoji === 'object' ? emoji : null;
    try {
      const signed = await signAndPublish({
        kind: 7,
        content: custom ? `:${custom.shortcode}:` : emoji,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ['h', pointer.id],
          ['e', msg.id],
          ['p', msg.pubkey],
          ...(custom ? [['emoji', custom.shortcode, custom.url]] : [])
        ]
      });
      eventStore.add(signed);
    } catch (err) {
      console.error('group react failed', err);
      if (isMembershipRefusal(err)) showToast(m.groups_join_required(), 'warning');
      else showToast(m.groups_react_failed(), 'error');
    }
  }

  /**
   * Mirror a join/leave into the user's kind-10009 GROUPS list (published to
   * the user's own relays, NOT the group relay) so joined groups roam.
   * @param {{add?: any, remove?: any}} change
   */
  async function updateGroupsList(change) {
    await updatePersonalGroupsList(getActiveUser(), change);
  }

  async function join() {
    try {
      await signAndPublish(buildJoinRequestTemplate(pointer.id));
      await updateGroupsList({ add: pointer });
      // The relay adds you to 39002 on an open group — refresh the roster so
      // the button flips to Leave without a reload (laoc, 2026-08-11).
      onRosterChanged();
      showToast(m.groups_join_sent(), 'success');
    } catch (err) {
      console.error('join request failed', err);
      showToast(m.groups_join_failed(), 'error');
    }
  }

  async function leave() {
    try {
      await signAndPublish(buildLeaveRequestTemplate(pointer.id));
      await updateGroupsList({ remove: pointer });
      onRosterChanged();
      showToast(m.groups_leave_sent(), 'success');
    } catch (err) {
      console.error('leave request failed', err);
      showToast(m.groups_join_failed(), 'error');
    }
  }

  /**
   * Post-delete cascade: drop the group from the user's own 10009 list, then
   * best-effort unlist it from any joined community we can sign for, then
   * navigate home. EVERY step here is best-effort: the group is already
   * deleted on the relay by the time this runs, so a failure partway through
   * (a transient relay hiccup on the 10009 update, a signer that can't be
   * reached for one community) must not block the steps after it — logged,
   * never surfaced, never fatal to the cascade.
   */
  async function handleGroupDeleted() {
    try {
      await updateGroupsList({ remove: pointer });
    } catch (err) {
      console.error('groups: post-delete 10009 removal failed', err);
    }
    for (const ck of getJoinedCommunities()) {
      const listed = parseGroupPointers(ck).some((p) => channelKey(p) === channelKey(pointer));
      const communitySigner = manager.getAccountForPubkey(ck.pubkey)?.signer;
      if (!listed || !communitySigner) continue;
      try {
        await detachGroupChannel({ communikeyEvent: ck, pointer, communitySigner });
      } catch (err) {
        console.error('groups: post-delete detach failed', err);
      }
    }
    goto('/');
  }
</script>

<div class="flex h-full min-h-0 flex-col">
  <header class="flex items-center gap-3 border-b border-base-300 px-4 py-3">
    {#if metadata?.picture}
      <img src={metadata.picture} alt="" class="h-8 w-8 rounded-full object-cover" />
    {/if}
    <div class="min-w-0 flex-1">
      <h2 class="truncate text-sm font-bold" data-testid="group-name">
        {metadata?.name ?? pointer.id}
      </h2>
      <p class="truncate text-xs opacity-60">
        <!-- The host, as the way back to its OTHER channels. A channel is a
             group with no parent object, so the relay is the container this
             chat sits in, and it was previously named here in plain text —
             a dead end. `relayLabel` keeps the port: a relay on another port
             is another relay. -->
        <a href={relayHref(pointer.relay)} data-testid="group-host-link" class="link link-hover"
          >{relayLabel(pointer.relay)}</a
        >{#if members.size || isAdmin}
          <button
            type="button"
            class="link link-hover"
            data-testid="group-members-open"
            onclick={() => (membersOpen = true)}
          >
            {#if members.size}{` · ${members.size}`}{/if}
          </button>
        {/if}
        {#if metadata?.about}&nbsp;— {metadata.about}{/if}
      </p>
      <GroupBadges access={accessBadges} host={hostBadges} class="mt-1" />
    </div>
    {#if isAdmin}
      <button
        type="button"
        class="btn btn-ghost btn-xs"
        data-testid="group-settings-open"
        onclick={() => (settingsOpen = true)}
      >
        ⚙
      </button>
    {/if}
    {#if myPubkey}
      {#if isMember}
        <button
          type="button"
          class="btn btn-ghost btn-xs"
          data-testid="group-leave"
          onclick={leave}
        >
          {m.groups_leave()}
        </button>
      {:else}
        <button
          type="button"
          class="btn btn-xs btn-primary"
          data-testid="group-join"
          onclick={join}
        >
          {m.groups_join()}
        </button>
      {/if}
    {/if}
  </header>

  {#if membersOpen}
    <GroupMembersModal
      {pointer}
      {metadata}
      {admins}
      {members}
      {myPubkey}
      {isAdmin}
      {onRosterChanged}
      onClose={() => (membersOpen = false)}
    />
  {/if}
  {#if settingsOpen}
    <GroupSettingsSheet
      {pointer}
      {metadata}
      {metadataEvent}
      onClose={() => (settingsOpen = false)}
      onDeleted={handleGroupDeleted}
    />
  {/if}

  {#if authRequired}
    <div class="bg-warning/20 px-4 py-2 text-xs" data-testid="group-auth-banner">
      {m.groups_auth_required()}
    </div>
  {/if}

  <!--
    One row definition for both surfaces. `onReply` is passed in rather than
    baked in, because the same message means "reply in the timeline" on the
    left and "reply inside this thread" in the panel.
  -->
  {#snippet messageRow(
    /** @type {any} */ message,
    /** @type {(msg: any) => void} */ onReply,
    /** @type {boolean} */ offerThread
  )}
    {@const parentId = getReplyParentId(message)}
    {@const replyParent = parentId ? displayed.find((p) => p.id === parentId) : null}
    <ChatMessageRow
      {message}
      isOwnMessage={message.pubkey === myPubkey}
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
      {onReply}
      replyTitle={m.groups_reply()}
      replyCount={threads.replyCount(message.id)}
      replyCountLabel={replyCountLabel(threads.replyCount(message.id))}
      onOpenThread={offerThread ? openThread : null}
    >
      {#snippet reactions(/** @type {any} */ msg)}
        <ReactionChips
          aggregated={reactionsByTarget.get(msg.id) ?? new Map()}
          addButtonOnHover
          onToggle={(emoji) => react(msg, emoji)}
          onPick={(emoji) => react(msg, emoji)}
        />
      {/snippet}
    </ChatMessageRow>
  {/snippet}

  <div class="flex min-h-0 flex-1">
    <!-- On a narrow viewport the panel takes the whole width; the timeline
         steps aside rather than being squeezed into a column of its own. -->
    <div
      class="relative flex min-h-0 flex-1 flex-col {openThreadRoot
        ? threadExpanded
          ? 'hidden'
          : 'hidden md:flex'
        : ''}"
    >
      {#if !atBottom}
        <button
          type="button"
          data-testid="chat-jump-to-bottom"
          class="btn absolute right-6 bottom-20 z-10 btn-circle shadow-md btn-sm"
          title={m.chat_jump_to_bottom()}
          aria-label={m.chat_jump_to_bottom()}
          onclick={jumpToBottom}>↓</button
        >
      {/if}
      <div
        bind:this={scrollContainer}
        class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4"
        onscroll={handleScroll}
        onloadcapture={handleContentLoad}
      >
        {#if isLoading && displayed.length === 0}
          <div class="mx-auto py-6"><span class="loading loading-md loading-dots"></span></div>
        {/if}
        <ChatMessageList items={grouped}>
          {#snippet row(/** @type {any} */ message)}
            {@render messageRow(message, (msg) => (replyTo = msg), true)}
          {/snippet}
        </ChatMessageList>
      </div>

      {#if disclosure !== 'unknown'}
        <p data-testid="disclosure-line" class="px-4 pb-1 text-xs opacity-60">
          {#if disclosure === 'world'}
            {m.disclosure_world()}
          {:else if disclosure === 'members'}
            {m.disclosure_members({ count: members.size })}
          {:else}
            {m.disclosure_invited({ count: members.size })}
          {/if}
        </p>
      {/if}
      <ChatComposer
        bind:value={text}
        placeholder={m.groups_input_placeholder({ name: metadata?.name ?? pointer.id })}
        disabled={!myPubkey}
        {sending}
        onSubmit={send}
        {replyTo}
        onCancelReply={() => (replyTo = null)}
        testid="group-chat-input"
      />
    </div>

    {#if openThreadRoot}
      <ThreadPanel
        root={openThreadRoot}
        replies={openThreadReplies}
        onClose={closeThread}
        title={m.chat_thread_title()}
        closeLabel={m.chat_thread_close()}
        expandLabel={m.chat_thread_expand()}
        collapseLabel={m.chat_thread_collapse()}
        bind:expanded={threadExpanded}
      >
        {#snippet row(/** @type {any} */ message)}
          {@render messageRow(message, (msg) => (threadReplyTo = msg), false)}
        {/snippet}
        {#snippet composer()}
          <ChatComposer
            bind:value={threadText}
            placeholder={m.chat_thread_reply_placeholder()}
            disabled={!myPubkey}
            {sending}
            onSubmit={sendInThread}
            replyTo={threadReplyTo}
            onCancelReply={() => (threadReplyTo = null)}
            testid="thread-chat-input"
          />
        {/snippet}
      </ThreadPanel>
    {/if}
  </div>
</div>
