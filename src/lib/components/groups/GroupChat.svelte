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
<script module>
  // Roster re-request "heal" delays — exported so a future test can shrink
  // them rather than fight the real-time waits (laoc, 2026-08-19).
  export const ROSTER_HEAL_DELAY_MS = 800;
  export const JOIN_ROSTER_HEAL_DELAY_MS = 1500;
  // Floor under the relay's own answer to the roster REQ (see the roster
  // effect). Not tied to the REQ's own timeout: this is how long a reader may
  // be left staring at a composer that cannot yet be enabled or explained.
  export const ROSTER_ANSWER_TIMEOUT_MS = 5000;
</script>

<script>
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { eventStore, pool } from '$lib/stores/nostr-infrastructure.svelte';
  import { customEmojisIn } from '$lib/helpers/emoji-autocomplete.js';
  import { useUserEmojiSets } from '$lib/stores/user-emoji-sets.svelte.js';
  import { useActiveUser } from '$lib/stores/accounts.svelte';
  import { useProfileMap } from '$lib/stores/profile-map.svelte.js';
  import { storeEvents } from 'applesauce-relay/operators';
  import { TimelineModel } from 'applesauce-core/models';
  import {
    GROUP_METADATA_KIND,
    GROUP_ADMINS_KIND,
    GROUP_MEMBERS_KIND,
    DELETE_EVENT_KIND,
    getGroupMetadata,
    getGroupAdmins,
    getGroupMembers
  } from 'applesauce-common/helpers/groups';
  import {
    buildGroupMessageTemplate,
    buildJoinRequestTemplate,
    buildLeaveRequestTemplate,
    buildPollTemplate,
    isMembershipRefusal,
    isAlreadyMemberError
  } from '$lib/groups/groups.js';
  // Pure NIP-88 poll logic (parse/tally/vote template), shared with the
  // Concord channel lane — semantics verified against Armada. The vote
  // template deliberately omits the room binding; the `h` tag is appended
  // in votePoll below, mirroring buildGroupMessageTemplate.
  import {
    parsePoll,
    collectVotes,
    tallyPollVotes,
    buildVoteTemplate,
    isPollEnded
  } from '$lib/concord/polls.js';
  import PollMessage from '$lib/components/community/channels/PollMessage.svelte';
  import MeetingCard from '$lib/components/groups/MeetingCard.svelte';
  import MeetingBar from '$lib/components/groups/MeetingBar.svelte';
  import {
    MEETING_KIND,
    isMeetingForGroup,
    meetingTimes,
    meetingTitle
  } from '$lib/groups/meetings.js';
  import GroupPollModal from '$lib/components/groups/GroupPollModal.svelte';
  import { updatePersonalGroupsList } from '$lib/groups/personal-groups-list.js';
  import { useMyGroups } from '$lib/groups/unlinked-groups.svelte.js';
  import { publishToGroupRelay, buildDeleteEventTemplate } from '$lib/groups/group-management.js';
  import { useChatAttachments, appendUrlToDraft } from '$lib/stores/chat-attachments.svelte.js';
  import { isModerator, roleOptionsFromAdmins } from '$lib/groups/roles.js';
  import { unique } from '$lib/helpers/unique.js';
  import { setContext, tick, untrack } from 'svelte';
  import { updateQueryParams } from '$lib/helpers/urlParams.js';
  import { GROUP_MEDIA_AUTH } from '$lib/groups/authed-media.js';
  import {
    saveScrollPosition,
    recallScrollPosition,
    isNearBottom
  } from '$lib/helpers/scroll-memory.js';
  import { relayBadges, channelBadges } from '$lib/groups/group-badges.js';
  import { relayHref, relayLabel } from '$lib/groups/relay-directory.js';
  import {
    authenticateOnce,
    isRestrictedError,
    isAuthRequiredError
  } from '$lib/groups/relay-auth.js';
  import GroupBadges from '$lib/components/groups/GroupBadges.svelte';
  import {
    PeopleIcon,
    MoreIcon,
    MeetIcon,
    SettingsIcon,
    ChevronLeftIcon
  } from '$lib/components/icons';
  import { lazyComponent } from '$lib/helpers/lazy-component.svelte.js';
  import { hasLivekitTag, identityToPubkey, probeRelayAvSupport } from '$lib/groups/livekit.js';
  import { probeCallPassSupport, listCallPasses } from '$lib/groups/call-passes.js';
  import { getCalendarEventMetadata } from '$lib/helpers/eventUtils.js';
  import { hasNip44 } from '$lib/helpers/nip44.js';
  import { trackOnScreen } from '$lib/groups/track-on-screen.js';
  import { joinOutcome } from '$lib/groups/join-outcome.js';
  import { modalStore } from '$lib/stores/modal.svelte.js';
  import { enableGroupCalls } from '$lib/groups/enable-group-calls.js';
  import { useCallPresence } from '$lib/groups/call-presence.svelte.js';
  import {
    getGroupCallState,
    joinGroupCallWithConfirm,
    leaveGroupCall,
    leaveGroupCallWithConfirm,
    callErrorMessage,
    showCallStage,
    toggleChatBeside,
    hideCallStage,
    registerCallStageView
  } from '$lib/groups/group-call.svelte.js';
  import {
    canPopOutCall,
    getCallPopoutState,
    popOutCall,
    popInCall
  } from '$lib/groups/call-popout.svelte.js';
  import GroupMembersModal from '$lib/components/groups/GroupMembersModal.svelte';
  import GroupSettingsSheet from '$lib/components/groups/GroupSettingsSheet.svelte';
  import { useRelayInformation } from '$lib/groups/relay-information.svelte.js';
  import { unlinkDeletedChannel } from '$lib/groups/community-teardown.js';
  import { channelKey } from '$lib/groups/community-pointer.js';
  import { leaveCommunity } from '$lib/helpers/community.js';
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
  import WebxdcAttachmentCard from '$lib/components/groups/WebxdcAttachmentCard.svelte';
  import GroupAppStage from '$lib/components/groups/GroupAppStage.svelte';
  import GroupAppsBar from '$lib/components/groups/GroupAppsBar.svelte';
  import WebxdcAppPicker from '$lib/components/groups/WebxdcAppPicker.svelte';
  import AgentBadge from '$lib/components/agents/AgentBadge.svelte';
  import { useAgentRecords } from '$lib/agents/agent-records.svelte.js';
  import { useAgentPresence } from '$lib/agents/agent-presence.svelte.js';
  import { presenceIsOnline } from '$lib/agents/agent-index.js';
  import {
    mintSessionId,
    buildAppShareTemplate,
    getWebxdcAttachment,
    deriveSessions,
    WEBXDC_STATE_KIND
  } from '$lib/webxdc/session-events.js';
  import { toArray } from 'rxjs/operators';
  import { stashExport } from '$lib/webxdc/export-share.js';
  import { runtimeConfig } from '$lib/stores/config.svelte.js';
  import { showToast } from '$lib/helpers/toast';
  import {
    buildMessageDeepLink,
    buildChannelLink,
    scrollToChatMessage
  } from '$lib/helpers/message-anchor.js';
  import { getCallChatUnread } from '$lib/groups/call-chat-unread.svelte.js';
  import { channelSeenUpTo, hasNewFromOthers } from '$lib/groups/channel-unread.js';
  import CallUnreadDot from '$lib/components/groups/call/CallUnreadDot.svelte';
  import * as m from '$lib/paraglide/messages';
  import { pageTitle } from '$lib/helpers/page-title.js';

  /** fallbackName: the display name the CALLER already knows (the community
   * pane reads it off the 10222's group pointer tag). Wins over the raw id
   * while the relay's kind:39000 hasn't arrived — on gated hosts that REQ
   * can race the NIP-42 handshake and come up empty, and a cryptic hex id
   * in the header reads like landing in the wrong group (laoc, 2026-08-19).
   * communityPubkey: the hosting Communikey community's pubkey (if any), so a
   * publish-as-article/wiki export can carry a `?community=` prefill — see
   * publishExport below. The /groups/[pointer] route has no community
   * context and leaves it at the default ''.
   * anchorMessageId: a ?message= deep link — once that message is in the
   * loaded window it is scrolled into view and flashed (message-anchor.js).
   * onBack: the community pane's "back to the channel list" (design 1a). Only
   * a host that HAS a channel list to go back to passes it — the standalone
   * /groups route keeps its host sidebar and renders no breadcrumb.
   * isCommunityRoot: this is the community's ROOT (membership) group — leaving
   * it leaves the community, so the leave entry and its confirm say so.
   * ownsDocumentTitle: the standalone /groups/<pointer> route has no other
   * source for the channel's name, so the chat titles the page there. Inside
   * a community the layout does it (and two writers would race).
   * @type {{pointer: import('$lib/groups/groups.js').GroupPointer, fallbackName?: string, communityPubkey?: string, anchorMessageId?: string | null, onBack?: () => void, isCommunityRoot?: boolean, ownsDocumentTitle?: boolean}} */
  let {
    pointer,
    fallbackName = '',
    communityPubkey = '',
    anchorMessageId = null,
    onBack = undefined,
    isCommunityRoot = false,
    ownsDocumentTitle = false
  } = $props();

  const getActiveUser = useActiveUser();

  // Media on this host is membership-gated (buzz answers 401 anonymously):
  // every ImageWithFallback below fetches same-host URLs with a signed
  // Blossom get auth instead of the anonymous proxy chain.
  setContext(GROUP_MEDIA_AUTH, { relay: pointer.relay, getUser: getActiveUser });

  /** @type {any} */ let metadata = $state(null);
  const displayTitle = $derived(metadata?.name ?? (fallbackName || pointer.id));
  const documentTitle = $derived(pageTitle([displayTitle], runtimeConfig.appName));
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

  /** @type {Set<string>} */ let members = $state(new Set());
  // Access is the relay-observable split only (channel-access.js): `private` =
  // invited, else world — capped to non-world when the host gates every read
  // behind NIP-42 (overstating openness is the harmful direction). The old
  // kind-10222 `group` pointer marker is retired, so nothing but the group's
  // own kind:39000 feeds this.
  const disclosureLevel = $derived(
    channelAccessLevel(metadataEvent, undefined, relayRequiresAuth(getRelayInfo()))
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
  // Authenticated but not on the (private) group's roster: the relay closes
  // a REQ `restricted` (NIP-29). Rendered as a members-only notice in place
  // of the composer — an empty chat with a live composer whose sends the
  // relay silently rejects reads as "my message vanished" (laoc, 2026-08-19).
  // Two independent flags, one per REQ that can be refused this way — the
  // roster (bundled 39000/39001/39002+9021) and the messages/reactions
  // subscription — because on some relays only ONE of the two comes back
  // restricted while the other settles quietly empty (no error at all), and
  // a single shared flag owned by whichever effect happened to touch it last
  // would get clobbered back to false by the other effect's own reset
  // (laoc, 2026-08-19: a non-member's roster-only restriction rendered the
  // softer "join to write" bar instead of the members-only notice, because
  // only the messages side ever set the flag).
  let messagesRestricted = $state(false);
  let rosterRestricted = $state(false);
  // A THIRD way in, verified live against groups.edufeed.org: an anonymous
  // viewer (no active user, so no signer to ever authenticate with) of a
  // non-world-readable channel never gets messagesRestricted/rosterRestricted
  // at all — the relay's `auth-required` CLOSE for the messages REQ simply
  // never resolves to next/error/complete without a NIP-42 response, so the
  // subscription hangs silently forever instead of refusing (measured: zero
  // terminal events, ever). Waiting for the relay's answer is a dead end
  // here by construction — no signer means no retry is ever possible — so
  // this reads the same "not the world, not me" conclusion straight off the
  // metadata that DOES load. `disclosureLevel` is `'unknown'` until that
  // metadata arrives, so this only fires once we genuinely know it.
  const restricted = $derived(
    messagesRestricted ||
      rosterRestricted ||
      (!getActiveUser()?.pubkey && disclosureLevel !== 'world' && disclosureLevel !== 'unknown')
  );
  let isLoading = $state(true);
  /** @type {any[]} */ let messages = $state([]);
  /** @type {any[]} */ let reactionEvents = $state([]);
  // NIP-29 moderation deletions (kind 9005) for this group — same
  // store-backed pattern as reactions. Timeline rows whose id a 9005 names
  // are hidden client-side; the relay itself drops the event from its store,
  // so this only bridges the gap for events already replayed/live in view.
  /** @type {any[]} */ let deletionEvents = $state.raw([]);
  /** @type {any[]} */ let voteEvents = $state([]);

  // Bump to re-run the roster request below (e.g. after an admin action
  // changes the 39001/39002 events) without touching the chat subscription.
  let rosterSeq = $state(0);
  // Whether the metadata/roster REQ has ANSWERED (EOSE or error) at least
  // once for the current channel. Join/Leave stay hidden until then — a
  // member whose roster is still in flight must not be offered Beitreten
  // (laoc, 2026-08-19: clicking it earned 'duplicate: already a member').
  let rosterAnswered = $state(false);

  // Group metadata/roster: relay-authored addressables with d = group id,
  // requested from the group's own relay only.
  $effect(() => {
    rosterSeq; // read first: an effect that early-returns before reading
    // reactive state captures no deps and never re-runs on a bump.
    retrySeq; // a successful NIP-42 authenticate re-runs this REQ too — on
    // gated hosts the first metadata REQ can race the handshake and come up
    // empty (missing name/badges/roster), and it had no second chance.
    rosterAnswered = false;
    rosterRestricted = false;
    // A FLOOR under the relay's answer, because on pyramid
    // (groups.edufeed.org) there is none: for an AUTHENTICATED non-member of
    // a members-tier group the roster REQ delivers no 39002 for me, no
    // CLOSE `restricted`, and no terminal signal at all — applesauce's own
    // request timeout tears the subscription down WITHOUT calling
    // error/complete, so neither branch below ever ran and `rosterAnswered`
    // stayed false forever: a permanently greyed composer, no members-only
    // notice, no way in (laoc, 2026-08-19, reproduced live four times).
    // Only a FLOOR, never a delay: whichever answer lands first wins, and a
    // member's real roster answer still unlocks the composer immediately.
    // Deliberately does NOT set `rosterRestricted` — silence is not proof of
    // restriction, and "answered but not a member" already renders the join
    // bar, which is the right affordance for a non-member of a closed group.
    // Re-armed on every effect run, so the post-auth retry (retrySeq) gets a
    // fresh window rather than inheriting an already-fired one.
    const answerTimer = setTimeout(() => {
      rosterAnswered = true;
    }, ROSTER_ANSWER_TIMEOUT_MS);
    const rosterAnswer = () => {
      clearTimeout(answerTimer);
      rosterAnswered = true;
    };
    const me = getActiveUser()?.pubkey;
    const sub = pool
      .relay(pointer.relay)
      .request(
        [
          {
            kinds: [GROUP_METADATA_KIND, GROUP_ADMINS_KIND, GROUP_MEMBERS_KIND],
            '#d': [pointer.id]
          },
          // My own stored join request, so "pending" survives a reload.
          ...(me ? [{ kinds: [9021], authors: [me], '#h': [pointer.id], limit: 1 }] : [])
        ],
        { timeout: 8000 }
      )
      // Feed every roster/metadata event into the eventStore too, so the other
      // roster readers (useChannelRosters → AreaMembersModal, the rail) share
      // this channel's roster instead of re-fetching a divergent copy — the
      // same "one source of truth" the root roster now uses. GroupChat still
      // keeps its own `members`/`admins`/`metadata` from `next` below: that
      // state is entangled with the rosterAnswered/auth lifecycle, and it holds
      // exactly what the store would (same events), so there is nothing to
      // reconcile — only the store to fill.
      .pipe(storeEvents(eventStore))
      .subscribe({
        next: (/** @type {any} */ event) => {
          if (event.kind === 9021) {
            hasStoredJoinRequest = true;
          }
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
        error: (/** @type {any} */ err) => {
          // NIP-29: authenticated, but not on this (private) group's roster
          // — the relay closes the REQ `restricted`. The relay HAS answered
          // ("you're not a member"), so this counts as answered too, not as
          // still-loading. `auth-required` retries the same one-shot NIP-42
          // handshake as the messages effect below — measured live against
          // groups.edufeed.org (pyramid) the roster REQ never actually
          // refuses this way (it silently omits 39001/39002 for a
          // non-member and EOSEs clean instead, both pre- and post-auth —
          // see `restricted`'s own derivation for how that case is still
          // covered), but another relay implementation may CLOSE it, and
          // this branch is what keeps that relay from getting stuck on the
          // unauthenticated answer forever.
          if (isRestrictedError(err)) rosterRestricted = true;
          else if (isAuthRequiredError(err)) tryAuthRetry();
          rosterAnswer();
        },
        complete: () => {
          rosterAnswer();
        }
      });
    return () => {
      clearTimeout(answerTimer);
      sub.unsubscribe();
    };
  });

  // One-shot NIP-42 retry: when the relay closes a REQ auth-required,
  // authenticate with the active signer and re-run both REQ effects (both
  // read `retrySeq`). Shared by the roster and messages effects — reused
  // rather than duplicated so both go through authenticateOnce's single
  // module-scoped one-AUTH-per-challenge guard (see relay-auth.js: a
  // redundant AUTH on an already-authenticated connection gets `ok:false`
  // and marks it UNauthenticated, blocking every later read on it).
  let retrySeq = $state(0);
  function tryAuthRetry() {
    authRequired = true;
    const user = getActiveUser();
    if (!user?.signer) return; // anonymous — nothing more we can do here;
    // `restricted`'s own derivation below covers this dead end for a
    // non-world-readable channel.
    authenticateOnce(pool.relay(pointer.relay), user.signer).then((response) => {
      // A refusal used to land here as success, because authenticate()
      // RESOLVES with {ok:false} rather than throwing — so the chat cleared
      // its own warning and retried against a relay that had just said no.
      if (!response.ok) return;
      authRequired = false;
      retrySeq++;
    });
  }

  // Proactive NIP-42 auth, not just reactive. The reactive path above only
  // fires when a REQ is CLOSED `auth-required` — which the MESSAGES sub gets,
  // but the ROSTER REQ does NOT: on pyramid (groups.edufeed.org) the roster
  // REQ for a private channel silently OMITS the 39002 members list and EOSEs
  // clean, with no challenge. So a real member's own roster answer comes back
  // empty, they read as a non-member, and the channel shows "request to join"
  // with no messages — even though authenticating once would serve the full
  // roster + history (verified live: edufeed on raum-1, laoc 2026-08-20).
  // Authenticate up front so the very first roster/messages reads run
  // authenticated; authenticateOnce is idempotent (one AUTH per challenge) and
  // resolves ok:false harmlessly on a relay that never challenges, so this is
  // safe for world-readable channels too. `retrySeq` re-runs both read effects.
  $effect(() => {
    const user = getActiveUser();
    if (!user?.signer) return;
    let cancelled = false;
    authenticateOnce(pool.relay(pointer.relay), user.signer).then((response) => {
      if (cancelled || !response.ok) return;
      authRequired = false;
      retrySeq++;
    });
    return () => {
      cancelled = true;
    };
  });

  // Live chat + reactions from the group relay (same storeEvents +
  // TimelineModel pattern as the public community chat). NOTE: the model
  // filter keys on `#h` only — two groups sharing an id on DIFFERENT relays
  // would merge here; acceptable v1, ids are relay-scoped in practice.
  $effect(() => {
    retrySeq; // re-run after a successful NIP-42 authenticate
    isLoading = true;
    authRequired = false;
    messagesRestricted = false;
    // Kind-1068 NIP-88 polls are timeline rows alongside kind-9 messages
    // (Armada renders both in the main chat; 1018 votes stay side events,
    // h-scoped like reactions). Kind-31923 scheduled meetings are timeline
    // rows too (MeetingCard), with a window of their own so a busy chat
    // cannot push an upcoming meeting out of the replay; kind-5 deletions
    // reach the store so a meeting its author deleted elsewhere disappears
    // (the store's delete handling drops it from every TimelineModel).
    const filter = { kinds: [9, 1068, MEETING_KIND], '#h': [pointer.id] };
    const fallbackTimer = setTimeout(() => (isLoading = false), 4000);

    const subSub = pool
      .relay(pointer.relay)
      .subscription([
        { ...filter, limit: 100 },
        { kinds: [MEETING_KIND], '#h': [pointer.id], limit: 50 },
        { kinds: [5], '#h': [pointer.id], limit: 100 },
        { kinds: [7], '#h': [pointer.id], limit: 200 },
        { kinds: [DELETE_EVENT_KIND], '#h': [pointer.id], limit: 100 },
        { kinds: [1018], '#h': [pointer.id], limit: 500 }
      ])
      .pipe(storeEvents(eventStore))
      .subscribe({
        error: (/** @type {any} */ err) => {
          isLoading = false;
          if (isRestrictedError(err)) {
            messagesRestricted = true;
            return;
          }
          if (isAuthRequiredError(err)) tryAuthRetry();
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
    const deletionsSub = eventStore
      .model(TimelineModel, { kinds: [DELETE_EVENT_KIND], '#h': [pointer.id] })
      .subscribe((events) => {
        deletionEvents = events;
      });
    const votesSub = eventStore
      .model(TimelineModel, { kinds: [1018], '#h': [pointer.id] })
      .subscribe((events) => {
        voteEvents = events;
      });

    return () => {
      clearTimeout(fallbackTimer);
      subSub.unsubscribe();
      modelSub.unsubscribe();
      reactionsSub.unsubscribe();
      deletionsSub.unsubscribe();
      votesSub.unsubscribe();
    };
  });

  // Read the `e` tags directly, not via getGroupDeleteEventInfo — that helper
  // memoizes on the event (getOrComputeCachedValue), which is a mutation
  // inside $derived (see CLAUDE.md on applesauce functions that mutate).
  const deletedMessageIds = $derived(
    new Set(
      deletionEvents.flatMap((event) =>
        (event.tags ?? [])
          .filter((/** @type {string[]} */ t) => t[0] === 'e' && t[1])
          .map((/** @type {string[]} */ t) => t[1])
      )
    )
  );
  const displayed = $derived(
    messages
      .filter(
        (event) =>
          event &&
          event.id &&
          event.pubkey &&
          !deletedMessageIds.has(event.id) &&
          // A meeting belongs here only with exactly this channel's h-tag.
          (event.kind !== MEETING_KIND || isMeetingForGroup(event, pointer.id))
      )
      .toReversed()
  );
  const meetings = $derived(displayed.filter((event) => event.kind === MEETING_KIND));

  // Guest links of my meetings: the channel's passes are listed ONCE per
  // visit (and per account) into the store, where each MeetingCard finds its
  // own by coordinate — not one authenticated REQ per card. Only while I
  // have a meeting here that has not ended (a past one offers no link), and
  // only with NIP-44 (the code is self-encrypted).
  const hasOwnLiveMeeting = $derived.by(() => {
    const now = Math.floor(Date.now() / 1000);
    return meetings.some((event) => {
      const times = event.pubkey === myPubkey ? meetingTimes(event) : null;
      return !!times && times.end > now;
    });
  });
  $effect(() => {
    const wanted = hasOwnLiveMeeting; // read first (effect early-return rule)
    const user = getActiveUser();
    if (!wanted || !user || !hasNip44(user.signer)) return;
    let alive = true;
    untrack(() =>
      listCallPasses(pool.relay(pointer.relay), pointer.id, user)
        .then((passes) => {
          if (alive) for (const pass of passes) eventStore.add(pass);
        })
        .catch((/** @type {unknown} */ err) => console.warn('meeting: listing passes failed', err))
    );
    return () => {
      alive = false;
    };
  });

  /**
   * The text a reply quotes: a meeting's title (its content is the
   * description, often empty), otherwise the message itself.
   * @param {any} message
   */
  function quoteText(message) {
    return message?.kind === MEETING_KIND
      ? meetingTitle(message) || m.meeting_card_label()
      : (message?.content ?? '');
  }
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

  // Agent badges: who among the message authors is an agent (kind 30177),
  // and is it online (kind 20001). Off entirely when the feature is off.
  const getAgentRecords = useAgentRecords(() =>
    runtimeConfig.agents?.enabled ? displayed.map((msg) => msg.pubkey) : []
  );
  const getAgentPresence = useAgentPresence(() => [...getAgentRecords().keys()]);
  const nowSeconds = () => Math.floor(Date.now() / 1000);

  const getProfiles = useProfileMap(() => [
    ...displayed.map((event) => event.pubkey),
    ...[...getAgentRecords().values()].map((r) => r.ownerPubkey)
  ]);

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
  // Kind-1018 votes bucketed by the poll they e-reference; the tally itself
  // (latest-per-pubkey, endsAt cutoff) happens per poll row below.
  const votesByPoll = $derived(collectVotes(voteEvents));
  const reactionsByTarget = $derived(
    aggregateChannelReactions(reactionEvents, getActiveUser()?.pubkey)
  );
  const myPubkey = $derived(getActiveUser()?.pubkey);
  const isMember = $derived(!!myPubkey && members.has(myPubkey));
  // 39001 admins are writers even when the relay's 39002 omits them.
  const canWrite = $derived(isMember || (!!myPubkey && admins.some((a) => a.pubkey === myPubkey)));
  // NIP-29 `closed` marker: a bare 9021 does NOT auto-join — it is stored
  // for the admins' Beitrittsanfragen queue. Missing metadata counts as
  // closed (same lock direction as everywhere else). Wizard-created
  // channels are always closed; foreign open groups auto-add on join.
  const groupClosed = $derived(
    !metadataEvent || !!metadataEvent.tags?.some((/** @type {string[]} */ t) => t[0] === 'closed')
  );
  // My own stored 9021 (loaded with the roster REQ) or a request sent this
  // session: the join affordances flip to a pending note instead of a Join
  // button that looks ignored (laoc, 2026-08-19).
  let joinRequestedNow = $state(false);
  let hasStoredJoinRequest = $state(false);
  const joinPending = $derived(
    groupClosed && !canWrite && (joinRequestedNow || hasStoredJoinRequest)
  );
  // Moderation role, not bare 39001 membership: a publisher-only entry is a
  // writer (canWrite above) but gets no settings gear or message delete —
  // the relay refuses its 9002/9005 anyway (roles.js isModerator).
  const isAdmin = $derived(isModerator(admins, myPubkey));

  // Management entry points: the members modal (Task 7) and the admin-only
  // settings sheet (Task 8) mount here once they exist.
  let membersOpen = $state(false);
  let settingsOpen = $state(false);
  // Bumps rosterSeq immediately for a snappy UI, then schedules one more
  // bump `delayMs` later into `ref.timer` (a plain mutable holder, not
  // `$state` — see CLAUDE.md on internal timer refs). Two call sites below
  // use this with different delays for different reasons, so the delay and
  // the timer handle are both parameters rather than baked in.
  /**
   * @param {number} delayMs
   * @param {{timer: ReturnType<typeof setTimeout> | undefined}} ref
   */
  function bumpRoster(delayMs, ref) {
    rosterSeq++;
    clearTimeout(ref.timer);
    ref.timer = setTimeout(() => {
      rosterSeq++;
    }, delayMs);
  }
  // Wired to GroupMembersModal's onRosterChanged prop below. ROSTER_HEAL_DELAY_MS:
  // the relay's OK for a 9000/9001/9002 admin op doesn't guarantee the
  // 39001/39002 addressables it materialises are already updated by the time
  // the immediate re-request lands, so a stale roster from that first
  // request would otherwise never self-heal.
  const rosterHeal = {
    timer: /** @type {ReturnType<typeof setTimeout> | undefined} */ (undefined)
  };
  const onRosterChanged = () => bumpRoster(ROSTER_HEAL_DELAY_MS, rosterHeal);
  // A self-join gets its own, longer follow-up bump: on pyramid the relay's
  // put-user lands within ~100ms of an accepted 9021, but ROSTER_HEAL_DELAY_MS
  // above is tuned for a different case and some relays are slower still —
  // JOIN_ROSTER_HEAL_DELAY_MS gives the composer a real second chance to
  // unlock without a reload (laoc, 2026-08-19).
  const joinRosterHeal = {
    timer: /** @type {ReturnType<typeof setTimeout> | undefined} */ (undefined)
  };
  const onJoinAccepted = () => bumpRoster(JOIN_ROSTER_HEAL_DELAY_MS, joinRosterHeal);
  $effect(() => {
    return () => {
      clearTimeout(rosterHeal.timer);
      clearTimeout(joinRosterHeal.timer);
    };
  });

  let text = $state('');
  const getUserEmojiSets = useUserEmojiSets();
  const customEmojiSets = $derived(getUserEmojiSets());
  let sending = $state(false);
  // Files picked, pasted or dropped into either composer: uploaded to the
  // user's Blossom server, URL into that composer's draft, imeta tag along
  // at send time (Armada-compatible). The queue lives in the shared hook.
  const attachments = useChatAttachments(getActiveUser);
  /**
   * @param {File[]} files
   * @param {'timeline' | 'thread'} target which composer's draft gets the URLs
   */
  function attachFiles(files, target) {
    return attachments.attach(files, (url) => {
      if (target === 'thread') threadText = appendUrlToDraft(threadText, url);
      else text = appendUrlToDraft(text, url);
    });
  }
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

  // The webxdc app currently launched above the timeline, rendered by
  // GroupAppStage (mounted below, keyed on sessionId so switching to a
  // different shared app forces a clean remount — GroupAppStage owns a
  // long-lived sync/subscription per session that must not survive a
  // session swap). `$state.raw` — same reasoning as replyTo/threadReplyTo
  // above: this is always replaced wholesale, never mutated in place.
  /** @type {{sessionId: string, app: {url: string, sha256: string, name: string, iconUrl: string}} | null} */
  let activeSession = $state.raw(null);

  // While a session is open it takes over the channel body (the chat is
  // display:none'd, not unmounted — scroll state and subscriptions survive).
  // The open session is mirrored into ?app=<sessionId> so the pad is
  // linkable and "open in new tab" is just the current URL.
  /** @param {string | null} sessionId */
  function syncAppParam(sessionId) {
    updateQueryParams(new URLSearchParams(window.location.search), { app: sessionId });
  }

  /** @param {{sessionId: string, app: any}} session */
  function openStage(session) {
    // The stage slot holds one thing at a time: a shared app OR the call.
    // The call keeps running behind the app (the dock brings it back).
    if (inCallHere) hideCallStage();
    activeSession = session;
    syncAppParam(session.sessionId);
  }

  // --- NIP-29 live audio/video (spec: bare `livekit` tag on the 39000) ---
  // The in-call UI is loaded on demand: livekit-client is ~300KB and only a
  // channel that actually starts a call needs it (root-layout-imports.test
  // guards that it never enters a route's static graph).
  const CallStage = lazyComponent(
    () => import('$lib/components/groups/call/GroupCallStage.svelte')
  );
  const CallInviteDialog = lazyComponent(
    () => import('$lib/components/groups/call/CallInviteDialog.svelte')
  );
  const CallChatPanel = lazyComponent(
    () => import('$lib/components/groups/call/CallChatPanel.svelte')
  );
  /** @type {'channel' | 'call'} */
  let chatTab = $state('channel');
  const avEnabled = $derived(hasLivekitTag(metadataEvent));
  // Relay-published kind 39004 ("who is live"), only subscribed while the
  // group is an AV space at all.
  const getCallPresence = useCallPresence(() => (avEnabled ? pointer : null));
  const callParticipantCount = $derived(getCallPresence().participants.length);
  const call = getGroupCallState();
  // "In a call HERE" — the store holds one call app-wide; a call in another
  // channel must not take over this channel's body.
  const inCallHere = $derived(call.isActiveFor(pointer) && call.phase !== 'idle');
  // A call starting here opens on its chat (that is where the people in the
  // call talk, guests included); once it ends, land back on the channel chat
  // rather than a dead tab. Only on the edge — a user who picks "Kanal"
  // during the call stays there. Plain `let`: bookkeeping, never rendered.
  let wasInCallHere = false;
  $effect(() => {
    const now = inCallHere;
    if (now !== wasInCallHere) chatTab = now ? 'call' : 'channel';
    wasInCallHere = now;
  });
  // Unread dots on the two tabs. The call chat's marker lives in its own
  // module (call-chat-unread — no livekit-client in this component's graph).
  // The channel's real read marker is stamped while it is the active channel
  // (host-unread), call chat tab or not, so the Kanal tab keeps a session-
  // local "seen up to": it advances while the channel chat is what is shown.
  const callChatUnread = getCallChatUnread();
  let channelSeenAt = $state(Math.floor(Date.now() / 1000));
  $effect(() => {
    if (inCallHere && chatTab === 'call') return;
    channelSeenAt = channelSeenUpTo(displayed, Math.floor(Date.now() / 1000));
  });
  const channelUnreadInCall = $derived.by(
    () => inCallHere && chatTab === 'call' && hasNewFromOthers(displayed, myPubkey, channelSeenAt)
  );
  // The call moved to its own window (Document PiP): the channel shows its
  // chat, with a bar to bring the call back.
  const callPopout = getCallPopoutState();
  const poppedOutHere = $derived(inCallHere && callPopout.open);
  // In the call but stepped back to the chat (or into a shared app): the
  // call runs on and the app-level dock shows it.
  // A call the server ended (removed / dropped) always shows its end state
  // here, even if the user had stepped back to the chat: the dock hides for
  // an ended call, so this is the only place that says what happened.
  const showCallHere = $derived(
    inCallHere && (call.phase === 'ended' || (!call.stageHidden && !poppedOutHere))
  );
  // Wide screens: the chat as a column beside the stage (per-device pref),
  // so the call stays in view. Narrow screens keep switching between the two.
  let wideScreen = $state(false);
  $effect(() => {
    const query = window.matchMedia?.('(min-width: 768px)');
    if (!query) return;
    wideScreen = query.matches;
    const onChange = () => (wideScreen = query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  });
  const chatBesideCall = $derived(showCallHere && call.chatBeside);

  function showChatFromStage() {
    if (wideScreen) toggleChatBeside();
    else hideCallStage();
  }
  // The close control inside the call chat panel: collapse the column beside
  // the stage, or — where the chat stands in for the stage — step back to it.
  function closeCallChat() {
    if (chatBesideCall) toggleChatBeside();
    else if (call.stageHidden) showCallStage();
    else chatTab = 'channel';
  }

  const canPopOut = canPopOutCall();
  function popOutHere() {
    // straight from the click: the window request needs the user activation
    popOutCall({ title: displayTitle, identityToPubkey }).catch((err) => {
      console.warn('call pop-out failed:', err);
    });
  }

  // The /c layout renders its page 2-3× (responsive variants, CSS hides the
  // inactive ones) and every copy sees the same active call. Only the copy
  // the user can see mounts the stage: a hidden twin connecting as well got
  // the first session kicked as a duplicate identity ("could not establish
  // pc connection", live 2026-09-28) and would play remote audio twice.
  // Without IntersectionObserver (SSR, jsdom) every copy counts as visible.
  /** @type {HTMLElement | undefined} */
  let chatRootEl = $state(undefined);
  let chatVisible = $state(typeof IntersectionObserver === 'undefined');
  $effect(() => {
    const el = chatRootEl;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((entries) => {
      const last = entries[entries.length - 1];
      if (last) chatVisible = last.isIntersecting;
    });
    io.observe(el);
    return () => io.disconnect();
  });

  async function startCall() {
    const user = getActiveUser();
    if (!user?.signer) return;
    if (activeSession) await closeStage();
    // The call store owns the connection and outlives this view: leaving
    // the channel keeps the call running in the app-level dock, which
    // uses the title and this page to come back to.
    await joinGroupCallWithConfirm(pointer, user, {
      title: displayTitle,
      href: `${window.location.pathname}${window.location.search}`
    });
  }

  // An admin of a channel that is not an AV space yet gets a one-click
  // "Start call" — offered only when the relay can mint tokens (probe 204).
  let avSupported = $state(false);
  let enablingCall = $state(false);
  $effect(() => {
    const relay = pointer.relay;
    if (!isAdmin || avEnabled) return;
    let alive = true;
    probeRelayAvSupport(relay).then((supported) => {
      if (alive) avSupported = supported;
    });
    return () => {
      alive = false;
    };
  });
  const canStartCall = $derived(isAdmin && !avEnabled && avSupported);

  // Guest links: members of an AV channel on a relay that speaks call
  // passes (docs/nips/nip29-call-passes.md). Probed for every AV channel:
  // the in-call invite and the meeting dialog's guest toggle both need it.
  let passesSupported = $state(false);
  let inviteOpen = $state(false);
  $effect(() => {
    const relay = pointer.relay;
    const id = pointer.id;
    // Reset first: a channel switch (pointer changes) must never show the
    // invite button carried over from the previous channel's probe while
    // this one's probe (or its skip, on a relay without call support) is
    // still pending.
    passesSupported = false;
    if (!avEnabled) return;
    let alive = true;
    probeCallPassSupport(relay, id).then((ok) => {
      if (alive) passesSupported = ok;
    });
    return () => {
      alive = false;
    };
  });
  // Only once LiveKit is connected: the relay mints passes for a call it
  // sees running, and answers "no call is running" while the handshake is
  // still going (QA 2026-10-02 B1).
  const canInvite = $derived(passesSupported && canWrite && inCallHere && call.connected);

  async function enableAndStartCall() {
    const user = getActiveUser();
    if (!user?.signer || enablingCall) return;
    enablingCall = true;
    try {
      await enableGroupCalls(pointer, user);
    } catch (err) {
      console.error('groups: enabling calls failed', err);
      showToast(m.groups_call_start_error(), 'error');
      enablingCall = false;
      return;
    }
    enablingCall = false;
    await startCall();
  }

  // What a click does: start a call nobody is in yet, join the running one
  // (with its head count), bring the stepped-aside stage back, or leave
  // (laoc, 2026-10-02: it said "Join call" while no call was running).
  // While this channel's call view is on screen the header shows a status
  // instead (QA 2026-10-02 C7: a "Leave call" icon right above the red
  // leave button caused accidental hang-ups) — so the button never leaves.
  // In a call here that is still on (requesting / ready) — a failed or
  // ended call is not one "you are in" (Task 15 review): the header offers
  // it again instead of a status.
  const callLiveHere = $derived(
    inCallHere && (call.phase === 'requesting' || call.phase === 'ready')
  );
  // Only members start calls; a non-member of an open channel may listen in
  // on a running one (QA round 3 C6). Logged out, the greyed button stays as
  // the "log in" prompt.
  const showCallButton = $derived(
    !myPubkey || canWrite || callLiveHere || callParticipantCount > 0
  );
  const callButtonLabel = $derived(
    !myPubkey
      ? m.groups_call_start_login()
      : callLiveHere
        ? m.groups_call_return()
        : callParticipantCount > 0
          ? canWrite
            ? m.groups_call_join_running({ count: callParticipantCount })
            : m.groups_call_listen_in({ count: callParticipantCount })
          : m.groups_call_start()
  );

  async function toggleCall() {
    if (callLiveHere) {
      if (poppedOutHere) popInCall();
      if (activeSession) await closeStage();
      showCallStage();
    } else await startCall();
  }

  // "Beitreten" on a meeting card or the meeting bar: a meeting's call is
  // simply this channel's call — bring it back when already in, join/start
  // it otherwise, and for an admin of a channel without calls yet switch
  // them on first. Members only (the relay mints tokens for the roster).
  const canJoinMeeting = $derived(!!myPubkey && canWrite && (avEnabled || canStartCall));
  async function joinMeeting() {
    if (callLiveHere || avEnabled) await toggleCall();
    else if (canStartCall) await enableAndStartCall();
  }

  // The channel context the meeting dialog needs (create and edit alike):
  // the meeting's location is the channel's own link; the roster decides who
  // gets the guest link in their invitation. A channel without calls (the
  // community's General channel starts that way) tells the dialog whether
  // this user may switch them on, so an admin still gets a guest option
  // (issue d0ab04d0).
  function meetingDialogContext() {
    return {
      pointer: { id: pointer.id, relay: pointer.relay },
      channelName: displayTitle,
      channelUrl: buildChannelLink(window.location, pointer.id),
      memberPubkeys: [...members],
      passesSupported,
      callsEnabled: avEnabled,
      canEnableCalls: canStartCall
    };
  }

  // "Termin planen": the calendar dialog in channel-meeting mode (M2).
  function openScheduleMeeting() {
    modalStore.openModal('calendarEvent', {
      mode: 'create',
      groupMeeting: meetingDialogContext()
    });
  }

  // "Bearbeiten" on a meeting card: the same dialog in channel-meeting EDIT
  // mode. The card hands over the raw 31923 and its guest pass (if any); the
  // dialog re-publishes the same coordinate to this relay only.
  /** @param {any} event @param {any | null} guestPass */
  function openEditMeeting(event, guestPass) {
    modalStore.openModal('calendarEvent', {
      mode: 'edit',
      existingEvent: getCalendarEventMetadata(event),
      existingRawEvent: event,
      groupMeeting: { ...meetingDialogContext(), guestPass }
    });
  }

  // The call's own connecting / failed / ended views count as "the call on
  // screen" just like the stage, so the app-level dock steps aside on the
  // call page in every phase (QA 2026-10-02 B4/C2). Untracked for the same
  // reason as the stage's registration: the store bumps its own $state.
  /** @param {HTMLElement} node */
  function callViewOnScreen(node) {
    const stop = untrack(() =>
      trackOnScreen(node, () =>
        registerCallStageView(`${window.location.pathname}${window.location.search}`)
      )
    );
    return { destroy: stop };
  }

  async function closeStage() {
    activeSession = null;
    syncAppParam(null);
    // display:none zeroes the timeline's scrollHeight, so a pinned reader
    // would otherwise get the chat back stranded at the top.
    await tick();
    if (pinnedToBottom) jumpToBottom();
  }

  /** @param {any} att */
  function openSession(att) {
    openStage({
      sessionId: att.webxdc,
      app: {
        url: att.url,
        sha256: att.sha256,
        name: att.alt?.replace(/^Webxdc app: /, '') || '',
        iconUrl: att.image || ''
      }
    });
  }

  // Deep link: a mount with ?app=<sessionId> (new-tab handoff, shared link)
  // auto-opens that session once its share event shows up on the timeline.
  // Consumed once — closing the pad must not immediately reopen it.
  let pendingAppParam = $state(
    typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('app') : null
  );
  $effect(() => {
    if (!pendingAppParam || activeSession) return;
    const match = sessions.find((s) => s.sessionId === pendingAppParam);
    if (match) {
      pendingAppParam = null;
      activeSession = match;
    }
  });

  function openInNewTab() {
    if (!activeSession) return;
    const params = new URLSearchParams(window.location.search); // eslint-disable-line svelte/prefer-svelte-reactivity -- transient local, serialized immediately
    params.set('app', activeSession.sessionId);
    // The community mount doesn't track channel selection in the URL, so the
    // fresh tab needs ?channel= to land in this channel at all (harmless on
    // the /groups route, which encodes the channel in the path).
    params.set('channel', pointer.id);
    window.open(`${window.location.pathname}?${params.toString()}`, '_blank', 'noopener');
  }

  // Session title enrichment (owned here, not GroupAppsBar — the bar is now
  // presentational only): the 9450 state event's `document` tag carries the
  // pad's first line, refreshed on every host update. Two layers feed the
  // same `sessionTitles` map:
  //
  // 1. One-shot backfill below — a handful of tiny '#i'-scoped limit:1 REQs,
  //    fetched once per distinct session-id set (see sessionKey), never per
  //    message. Seeds titles for sessions that already have 9450 history when
  //    the channel opens. This runs unconditionally whenever the timeline has
  //    webxdc sessions, because launch cards (unlike the collapsed apps bar)
  //    are ALWAYS visible in the timeline. This is NOT a regression of the
  //    earlier apps-bar over-fetch fix (aa6d8546/b40db86d): that fix was
  //    about a bundled '#h'-only limit:100 full-body REQ refiring on every
  //    new chat message.
  // 2. Live subscription further below — the backfill alone leaves two gaps:
  //    a freshly-shared pad has zero 9450 events yet (nothing to backfill,
  //    and nothing re-triggers the one-shot fetch once the first edit lands),
  //    and edits made while the channel stays open (in the stage, or by
  //    another member) never reach the map either. The live sub covers both:
  //    it isn't gated on sessionKey, so it also seeds sessions the backfill
  //    hasn't discovered yet, and it stays open for the channel's lifetime.
  const sessions = $derived(deriveSessions(displayed));
  const sessionKey = $derived(sessions.map((s) => s.sessionId).join(','));
  let sessionTitles = $state.raw(new Map());
  let titlesFetchedKey = '';
  $effect(() => {
    if (!sessionKey) return;
    const key = `${sessionKey}\x1f${pointer.relay}\x1f${pointer.id}`;
    if (titlesFetchedKey === key) return;
    titlesFetchedKey = key;
    const subs = sessionKey.split(',').map((sid) =>
      pool
        .relay(pointer.relay)
        .request(
          { kinds: [WEBXDC_STATE_KIND], '#h': [pointer.id], '#i': [sid], limit: 1 },
          { timeout: 2500 }
        )
        .pipe(toArray())
        .subscribe((events) => {
          const latest = [...events].sort((a, b) => b.created_at - a.created_at)[0];
          if (!latest) return;
          const tag = (/** @type {string} */ n) => latest.tags?.find((t) => t[0] === n)?.[1];
          const next = new Map(sessionTitles); // eslint-disable-line svelte/prefer-svelte-reactivity -- rebuilt wholesale, then swapped in
          next.set(sid, tag('document') || tag('summary') || '');
          sessionTitles = next;
        })
    );
    return () => subs.forEach((sub) => sub.unsubscribe());
  });

  // Layer 2 (see comment above): a live sub for the channel's whole lifetime,
  // not gated on sessionKey/titlesFetchedKey, so a pad shared with no prior
  // history (or edited after open) still gets a title without a reload. The
  // `since` overlap (a few seconds) is deliberate slack for clock skew
  // against the backfill's own window; last-received wins — no created_at
  // bookkeeping needed for a subtitle, and the Map swap is idempotent.
  $effect(() => {
    const relay = pointer.relay;
    const id = pointer.id;
    const liveSub = pool
      .relay(relay)
      .subscription([
        { kinds: [WEBXDC_STATE_KIND], '#h': [id], since: Math.floor(Date.now() / 1000) - 5 }
      ])
      .subscribe({
        next: (/** @type {any} */ event) => {
          if (event === 'EOSE') return;
          const tag = (/** @type {string} */ n) =>
            event.tags?.find((/** @type {string[]} */ t) => t[0] === n)?.[1];
          const sid = tag('i');
          const title = tag('document') || tag('summary');
          if (!sid || !title) return;
          const next = new Map(sessionTitles); // eslint-disable-line svelte/prefer-svelte-reactivity -- rebuilt wholesale, then swapped in
          next.set(sid, title);
          sessionTitles = next;
        },
        // Best-effort enrichment: a refusal here (auth-required, restricted)
        // shouldn't break the channel — the one-shot backfill above already
        // covers what it can, and the launch card degrades to the app name.
        error: () => {}
      });
    return () => liveSub.unsubscribe();
  });

  // Composer "+" apps menu (Task 7): pick the curated pad app or a discovered
  // 1063 app, mint a session, publish the kind-9 share, then jump straight
  // into the stage — sharing an app opens it for the sharer too.
  let appPickerOpen = $state(false);

  /** @param {{url: string, sha256: string, name: string, iconUrl: string}} app */
  async function shareApp(app) {
    appPickerOpen = false;
    const sessionId = mintSessionId();
    // The timeline composer's current draft becomes the share message when
    // non-blank ("here's the pad for today"), falling back to the bare url —
    // see buildAppShareTemplate. Only cleared once the publish actually
    // succeeds, so a failed send leaves the draft intact to retry. Guarded by
    // `text === draft` (not an unconditional clear): the publish is async, so
    // a reader who typed a NEW message while this share was in flight must
    // not have it wiped out from under them when the old draft's publish
    // resolves after the fact.
    const draft = text;
    try {
      const signed = await signAndPublish(buildAppShareTemplate(pointer.id, app, sessionId, draft));
      eventStore.add(signed);
      openStage({ sessionId, app });
      if (text === draft) text = '';
    } catch (err) {
      // Mirrors publishMessage's catch (~line 650) — the app's own send-error
      // surface, reused verbatim rather than inventing a second one.
      console.error('group send failed', err);
      if (isMembershipRefusal(err)) showToast(m.groups_join_required(), 'warning');
      else
        showToast(
          m.webxdc_apps_share_failed({ reason: err instanceof Error ? err.message : String(err) }),
          'error'
        );
    }
  }

  // Export → publish as article/wiki (Task 8): GroupAppStage's sendToChat
  // hands us the exported file; we stash it in sessionStorage and hop to the
  // create route, which prefills title + body from it (spec §5).
  /** @type {{name: string, plainText: string} | null} */
  let pendingExport = $state.raw(null);
  /** @param {{name: string, plainText: string}} file */
  function handleShareText(file) {
    pendingExport = file;
  }
  /** @param {'article' | 'wiki'} target */
  function publishExport(target) {
    if (!pendingExport) return;
    const stashed = stashExport(pendingExport);
    pendingExport = null;
    if (!stashed) {
      // Mirrors shareApp's own send-error surface: a toast, not a dead end.
      showToast(m.webxdc_export_too_large(), 'error');
      return;
    }
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- local to this call, never rendered
    const params = new URLSearchParams({ prefill: 'webxdc' });
    if (communityPubkey) params.set('community', communityPubkey);
    goto(`${resolve(`/create/${target}`)}?${params}`);
  }

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
   * Copy a deep link to this message (current URL + channel/message params —
   * on the community mount ?channel= is what lands a fresh tab in this
   * channel at all, harmless on the /groups route which encodes it in the
   * path; same reasoning as openInNewTab below).
   * @param {any} message
   */
  function copyMessageLink(message) {
    const url = buildMessageDeepLink(window.location, pointer.id, message.id);
    navigator.clipboard.writeText(url).then(() => showToast(m.chat_message_link_copied(), 'info'));
  }

  // ?message= deep link: once the anchored message is in the loaded window,
  // scroll to it and flash it (message-anchor.js). A folded thread reply
  // never renders in the main timeline — its thread panel is opened and the
  // anchor lands there instead. The scroll itself is DEBOUNCED until the
  // relay replay burst settles: the timeline rebuilds non-monotonically
  // while streaming (see the pin-to-bottom comment above), so a scroll fired
  // the moment the target appears gets displaced by later-arriving rows
  // (live-verified: the anchored row landed just below the fold). Applied
  // once per anchor value; afterwards the reader keeps scroll control. A
  // message older than the 100-event relay window is simply never found —
  // the reader lands pinned at the bottom as usual (accepted v1 limit, no
  // back-pagination in this chat).
  /** @type {string | null} */
  let appliedAnchor = null;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let anchorTimer;
  $effect(() => {
    const target = anchorMessageId;
    const index = threads; // dep — retry/re-settle as the timeline streams in
    if (!target || target === appliedAnchor) return;
    if (!displayed.some((event) => event.id === target)) return;
    if (index.timeline.some((event) => event.id === target)) {
      // The pin-to-bottom effect must not yank the view off the anchor.
      pinnedToBottom = false;
    } else {
      const root = index.timeline.find((event) =>
        index.repliesFor(event.id).some((reply) => reply.id === target)
      );
      if (!root) return; // orphan mid-resolution — retry on the next rebuild
      if (openThreadId !== root.id) openThread(root);
    }
    clearTimeout(anchorTimer);
    anchorTimer = setTimeout(() => {
      appliedAnchor = target;
      scrollToChatMessage(document, target);
    }, 400);
  });
  $effect(() => () => clearTimeout(anchorTimer));

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
   * Passed into GroupAppStage as `authenticate`, for createGroupSync's own
   * one-shot read retry on an auth-required/restricted session read. Uses
   * the exact same call this file's own proactive-auth $effect makes
   * (pool.relay(pointer.relay), the active user's signer) — a session's
   * first read can still land before that proactive handshake resolves.
   */
  function authenticateSession() {
    const user = getActiveUser();
    if (!user?.signer) return Promise.resolve({ ok: false, message: 'no signer' });
    return authenticateOnce(pool.relay(pointer.relay), user.signer);
  }

  /**
   * @param {string} value
   * @param {any} replyTarget the message being replied to, tags included
   * @returns {Promise<boolean>} whether it went out
   */
  async function publishMessage(value, replyTarget) {
    try {
      const signed = await signAndPublish(
        buildGroupMessageTemplate(
          pointer.id,
          value,
          replyTarget,
          attachments.pending(),
          customEmojisIn(value, customEmojiSets)
        )
      );
      eventStore.add(signed);
      attachments.markSent(value);
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

  // NIP-29 moderation: the message an admin asked to delete, pending the
  // confirm dialog below. `$state.raw` — a whole applesauce event, never
  // deep-proxied (same reasoning as replyTo).
  /** @type {any} */
  let deleteTarget = $state.raw(null);
  let deleting = $state(false);

  async function confirmDeleteMessage() {
    const target = deleteTarget;
    if (!target || deleting) return;
    deleting = true;
    try {
      const signed = await signAndPublish(buildDeleteEventTemplate(pointer.id, target.id));
      // Into the store like every other publish here: the deletions model
      // above picks it up and the row disappears without waiting for the
      // relay to echo the 9005 back.
      eventStore.add(signed);
      deleteTarget = null;
    } catch (err) {
      console.error('group message delete failed', err);
      showToast(m.groups_message_delete_failed(), 'error');
    }
    deleting = false;
  }

  // NIP-88 polls in the room (Armada interop): the poll modal builds a
  // kind-1068 timeline row, votes are kind-1018 side events — both h-tagged
  // and published to the group relay ONLY, so membership stays enforced.
  let pollModalOpen = $state(false);

  /**
   * Resolves true once the vote is on the relay (PollBody then clears its
   * selection), false on refusal so the picked options stay for a retry.
   * @param {import('$lib/concord/polls.js').ParsedPoll} poll @param {string[]} optionIds
   */
  async function votePoll(poll, optionIds) {
    if (!canWrite) {
      showToast(m.groups_join_required(), 'warning');
      return false;
    }
    const template = buildVoteTemplate(poll.id, optionIds);
    template.tags.push(['h', pointer.id]);
    try {
      const signed = await signAndPublish(template);
      eventStore.add(signed);
      return true;
    } catch (err) {
      console.error('poll vote failed', err);
      if (isMembershipRefusal(err)) showToast(m.groups_join_required(), 'warning');
      else showToast(m.groups_send_failed(), 'error');
      return false;
    }
  }

  /**
   * @param {{question: string, options: {id: string, label: string}[], pollType: 'singlechoice'|'multiplechoice', endsAt?: number}} details
   * @returns {Promise<boolean>} whether it went out (the modal closes on true)
   */
  async function createPoll({ question, options, pollType, endsAt }) {
    try {
      const signed = await signAndPublish(
        buildPollTemplate(pointer.id, question, options, {
          pollType,
          endsAt,
          relayUrl: pointer.relay
        })
      );
      eventStore.add(signed);
      pollModalOpen = false;
      return true;
    } catch (err) {
      console.error('poll create failed', err);
      if (isMembershipRefusal(err)) showToast(m.groups_join_required(), 'warning');
      else showToast(m.groups_send_failed(), 'error');
      return false;
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

  // Set on unmount so the join's roster wait stops and stays silent.
  // Plain `let`: bookkeeping, never rendered.
  let destroyed = false;
  $effect(() => () => {
    destroyed = true;
  });

  /**
   * Resolves true as soon as I show up on the roster (the join's roster
   * refreshes land in `members`), false once `ms` passed without.
   * @param {number} ms
   */
  async function waitForMembership(ms) {
    const until = Date.now() + ms;
    while (!destroyed && !(myPubkey && members.has(myPubkey)) && Date.now() < until) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return !!myPubkey && members.has(myPubkey);
  }

  async function join() {
    try {
      await signAndPublish(buildJoinRequestTemplate(pointer.id));
      await updateGroupsList({ add: pointer });
      // The relay adds you to 39002 on an open group — refresh the roster so
      // the button flips to Leave without a reload (laoc, 2026-08-11).
      onJoinAccepted();
      joinRequestedNow = true;
      // "Joined" or "request sent" by what the refreshed roster shows (QA
      // C1: "request sent" read like a pending approval on an open group);
      // the `closed` marker only decides when the roster cannot be read.
      const onRoster = await waitForMembership(JOIN_ROSTER_HEAL_DELAY_MS + 500);
      // Left meanwhile: the outcome belongs to this channel's page, never
      // to whatever page came next (it would read stale there).
      if (destroyed) return;
      const outcome = joinOutcome({
        onRoster,
        rosterReadable: rosterAnswered && !rosterRestricted,
        closed: groupClosed
      });
      showToast(outcome === 'joined' ? m.groups_join_joined() : m.groups_join_sent(), 'success');
    } catch (err) {
      if (isAlreadyMemberError(err)) {
        // Membership is exactly what the click wanted — the button only
        // showed because the roster read lagged. Refresh it and say so.
        await updateGroupsList({ add: pointer }).catch(() => {});
        onRosterChanged();
        showToast(m.groups_join_already(), 'info');
        return;
      }
      console.error('join request failed', err);
      showToast(m.groups_join_failed(), 'error');
    }
  }

  // Leaving sits behind a confirm (design 1a): it was a bare header button
  // one stray click away, and on a closed channel the way back in is a new
  // request an admin has to approve.
  let leaveConfirmOpen = $state(false);
  // The root group IS the community's membership: leaving it leaves the
  // community (controller ruling, Task 14 review; final review 2 I1) — the
  // 9022 plus the community unfollow, see leave().
  const leaveLabel = $derived(
    isCommunityRoot ? m.groups_leave_community() : m.groups_leave_channel()
  );
  const leaveConfirmTitle = $derived(
    isCommunityRoot ? m.groups_leave_community_confirm_title() : m.groups_leave_confirm_title()
  );
  const leaveConfirmBody = $derived.by(() => {
    if (isCommunityRoot) return m.groups_leave_community_confirm_body();
    return groupClosed ? m.groups_leave_confirm_body_closed() : m.groups_leave_confirm_body_open();
  });
  let leaving = $state(false);

  function askLeave() {
    closeMoreMenu();
    leaveConfirmOpen = true;
  }

  async function confirmLeave() {
    if (leaving) return;
    leaving = true;
    try {
      await leave();
    } finally {
      leaving = false;
      leaveConfirmOpen = false;
    }
  }

  async function leave() {
    try {
      await signAndPublish(buildLeaveRequestTemplate(pointer.id));
      await updateGroupsList({ remove: pointer });
      onRosterChanged();
      // Leaving the ROOT leaves the community: also unfollow it (kind 30000
      // `communities` set) so it drops out of the rail (final review 2 I1).
      // The helper's own guarded path; a failed unfollow is reported, but the
      // 9022 already went out.
      if (isCommunityRoot && communityPubkey) {
        const result = await leaveCommunity(communityPubkey);
        if (!result.success) throw new Error(result.error ?? 'community unfollow failed');
      }
      showToast(m.groups_leave_sent(), 'success');
    } catch (err) {
      console.error('leave request failed', err);
      showToast(m.groups_join_failed(), 'error');
    }
  }

  // "Remove from my list" (issue 532c9210, Armada: remove server). A group
  // that only surfaces through the personal kind-10009 — joined from another
  // client, or pasted by address — had no way OUT of the rail: Leave is a
  // roster action and the settings sheet is admin-only. This rewrites MY
  // list and touches nothing on the group relay, so it is offered to anyone
  // signed in, whatever their roster state; the inverse keeps it reversible.
  const getMyGroups = useMyGroups();
  const myListKey = $derived(channelKey(pointer));
  const inMyList = $derived(!!myListKey && getMyGroups().some((g) => channelKey(g) === myListKey));
  const closeMoreMenu = () => /** @type {HTMLElement | null} */ (document.activeElement)?.blur();

  /** @param {boolean} add */
  async function toggleMyList(add) {
    closeMoreMenu();
    try {
      await updateGroupsList(add ? { add: pointer } : { remove: pointer });
      showToast(add ? m.groups_list_added() : m.groups_list_removed(), 'success');
    } catch (err) {
      console.error('groups: 10009 update failed', err);
      showToast(m.groups_list_update_failed(), 'error');
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
    await unlinkDeletedChannel({ pointer, user: getActiveUser() });
    goto('/');
  }
</script>

<svelte:head>
  {#if ownsDocumentTitle}
    <title>{documentTitle}</title>
  {/if}
</svelte:head>

<div bind:this={chatRootEl} class="flex h-full min-h-0 flex-col">
  {#if onBack}
    <!-- "‹ Kanäle" (design 1a): the way back to the channel list, above the
      title on every width. -->
    <div class="px-2 pt-1">
      <button
        type="button"
        class="btn gap-1 px-2 text-primary btn-ghost btn-sm"
        data-testid="group-chat-breadcrumb"
        aria-label={m.groups_breadcrumb_channels_aria()}
        onclick={onBack}
      >
        <ChevronLeftIcon class_="w-4 h-4" title="" />
        {m.groups_breadcrumb_channels()}
      </button>
    </div>
  {/if}
  <header
    class="flex items-center gap-3 border-b border-base-300 px-4 {onBack ? 'pt-1 pb-3' : 'py-3'}"
  >
    {#if metadata?.picture}
      <img src={metadata.picture} alt="" class="h-8 w-8 rounded-full object-cover" />
    {/if}
    <div class="min-w-0 flex-1">
      <h2 class="truncate text-sm font-bold" data-testid="group-name">
        {displayTitle}
      </h2>
      <p class="truncate text-xs opacity-60">
        <!-- The host, as the way back to its OTHER channels. A channel is a
             group with no parent object, so the relay is the container this
             chat sits in, and it was previously named here in plain text —
             a dead end. `relayLabel` keeps the port: a relay on another port
             is another relay. -->
        <a href={relayHref(pointer.relay)} data-testid="group-host-link" class="link link-hover"
          >{relayLabel(pointer.relay)}</a
        >{#if metadata?.about}&nbsp;— {metadata.about}{/if}
      </p>
      <GroupBadges access={accessBadges} host={hostBadges} class="mt-1" />
    </div>
    {#if rosterAnswered}
      <!-- Concord parity (ChannelChat's members button): the roster door,
        with the count once there is one. Was a near-invisible "· N" text
        link that rendered NOTHING while the roster was empty
        (laoc, 2026-08-19). View-only for non-admins. -->
      <button
        type="button"
        class="btn btn-ghost btn-sm"
        data-testid="group-members-open"
        onclick={() => (membersOpen = true)}
      >
        <PeopleIcon class_="w-4 h-4" title="" />
        {#if members.size}{members.size}{/if}
      </button>
    {/if}
    {#if avEnabled}
      <!-- NIP-29 AV space: join (or leave) the channel's call; the count is
        the relay's own kind-39004 participant list. Icon + count, same
        header chrome as the members button. -->
      {#if showCallHere && callLiveHere}
        <!-- The call is on screen right below: a status, not a second
          (destructive) control — only the stage's red button leaves. -->
        <span
          role="status"
          class="btn btn-active cursor-default text-primary btn-ghost btn-sm"
          data-testid="group-call-status"
          title={m.groups_call_you_are_in()}
          aria-label={m.groups_call_you_are_in()}
        >
          <MeetIcon class_="w-4 h-4" title="" />
          {#if callParticipantCount}{callParticipantCount}{/if}
        </span>
      {:else if showCallButton}
        <button
          type="button"
          class="btn btn-ghost btn-sm {callLiveHere ? 'text-primary' : ''}"
          data-testid="group-call-join"
          title={callButtonLabel}
          aria-label={callButtonLabel}
          aria-pressed={callLiveHere}
          disabled={!myPubkey}
          onclick={toggleCall}
        >
          <MeetIcon class_="w-4 h-4" />
          {#if callParticipantCount}{callParticipantCount}{/if}
        </button>
        {#if !myPubkey}
          <!-- The greyed icon's "log in to start a call" is only a tooltip,
            which a touch user never sees (QA round 2 C5). -->
          <button
            type="button"
            class="btn text-primary btn-ghost btn-sm"
            data-testid="group-call-login"
            onclick={() => modalStore.openModal('login')}
          >
            {m.common_login()}
          </button>
        {/if}
      {/if}
    {:else if canStartCall}
      <!-- Admin one-click: switch the channel's calls on (a 9002 restating
           the current metadata plus `livekit`) and join right away. -->
      <button
        type="button"
        class="btn btn-ghost btn-sm"
        data-testid="group-call-start"
        title={m.groups_call_start()}
        aria-label={m.groups_call_start()}
        disabled={enablingCall}
        onclick={enableAndStartCall}
      >
        {#if enablingCall}
          <span class="loading loading-xs loading-spinner"></span>
        {:else}
          <MeetIcon class_="w-4 h-4" />
        {/if}
      </button>
    {/if}
    {#if isAdmin}
      <button
        type="button"
        class="btn btn-ghost btn-sm"
        data-testid="group-settings-open"
        title={m.groups_settings_title()}
        aria-label={m.groups_settings_title()}
        onclick={() => (settingsOpen = true)}
      >
        <SettingsIcon class_="w-4 h-4" title="" />
      </button>
    {/if}
    {#if myPubkey}
      <!-- Same focus-driven DaisyUI dropdown as MemberActionsMenu; one home
        for actions that are neither roster nor admin operations. -->
      <div class="dropdown dropdown-end shrink-0">
        <button
          tabindex="0"
          class="btn btn-ghost btn-sm"
          data-testid="group-more-menu"
          aria-label={m.groups_more_menu()}
        >
          <MoreIcon class_="w-4 h-4" />
        </button>
        <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
        <ul
          tabindex="0"
          class="dropdown-content menu z-50 w-60 rounded-box border border-base-300 bg-base-100 p-2 shadow-lg"
        >
          {#if canWrite}
            <li>
              <button data-testid="group-meeting-schedule" onclick={openScheduleMeeting}>
                {m.groups_meeting_schedule()}
              </button>
            </li>
          {/if}
          <!-- Hiding belongs with leaving, not with the content actions
            (smoke test 2026-10-08): its own section right above Leave. The
            divider only makes sense when something sits above it. -->
          <li class={canWrite ? 'mt-2 border-t border-base-300 pt-2' : ''}>
            {#if inMyList}
              <!-- QA C6: says which list and that nothing else changes. -->
              <button
                class="flex flex-col items-start gap-0.5"
                data-testid="group-list-remove"
                onclick={() => toggleMyList(false)}
              >
                <span>{m.groups_list_remove()}</span>
                <span
                  class="text-xs font-normal text-base-content/60"
                  data-testid="group-list-remove-hint">{m.groups_list_remove_hint()}</span
                >
              </button>
            {:else}
              <button data-testid="group-list-add" onclick={() => toggleMyList(true)}>
                {m.groups_list_add()}
              </button>
            {/if}
          </li>
          {#if rosterAnswered && isMember}
            <!-- Destructive last, set apart, and confirmed (design 1a). -->
            <li class="mt-2 border-t border-base-300 pt-2">
              <button class="font-semibold text-error" data-testid="group-leave" onclick={askLeave}>
                {leaveLabel}
              </button>
            </li>
          {/if}
        </ul>
      </div>
    {/if}
    <!-- Join affordance for non-members only. A member's Leave lives in the ⋯
      menu behind a confirm (design 1a); an admin (39001) without an explicit
      39002 seat is a member too — NIP-29 counts admins as members, so no
      join/leave here (the community creator's own situation; a self-approval
      loop otherwise). -->
    {#if myPubkey && rosterAnswered && !isMember && !canWrite}
      {#if joinPending}
        <span class="text-xs text-base-content/60" data-testid="group-join-pending"
          >{m.community_join_pending()}</span
        >
      {:else}
        <!-- Closed group: the 9021 lands in the admins' queue — say
          "anfragen", not "beitreten" (open groups auto-add on join). -->
        <button
          type="button"
          class="btn btn-sm btn-primary"
          data-testid="group-join"
          onclick={join}
        >
          {groupClosed ? m.community_join_request() : m.groups_join()}
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
      roleOptions={roleOptionsFromAdmins(admins)}
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
  {#if appPickerOpen}
    <WebxdcAppPicker
      curatedApps={runtimeConfig.webxdc?.curatedApps ?? []}
      onSelect={shareApp}
      onClose={() => (appPickerOpen = false)}
    />
  {/if}
  {#if pollModalOpen}
    <GroupPollModal onCreate={createPoll} onClose={() => (pollModalOpen = false)} />
  {/if}
  {#if pendingExport}
    <div class="modal-open modal">
      <div class="modal-box max-w-sm">
        <h3 class="text-sm font-bold">{m.webxdc_export_title()}</h3>
        <p class="truncate py-2 text-xs opacity-70">{pendingExport.name}</p>
        <div class="modal-action">
          <button class="btn btn-sm" onclick={() => (pendingExport = null)}
            >{m.webxdc_export_cancel()}</button
          >
          <button class="btn btn-sm" onclick={() => publishExport('wiki')}
            >{m.webxdc_export_as_wiki()}</button
          >
          <button class="btn btn-sm btn-primary" onclick={() => publishExport('article')}
            >{m.webxdc_export_as_article()}</button
          >
        </div>
      </div>
    </div>
  {/if}

  {#if leaveConfirmOpen}
    <div class="modal-open modal" role="dialog" data-testid="group-leave-confirm">
      <div class="modal-box max-w-sm">
        <h3 class="font-bold">{leaveConfirmTitle}</h3>
        <p class="py-2 text-sm opacity-70">{leaveConfirmBody}</p>
        <div class="modal-action">
          <button class="btn btn-ghost" onclick={() => (leaveConfirmOpen = false)}
            >{m.common_cancel()}</button
          >
          <button
            class="btn btn-error"
            data-testid="group-leave-confirm-action"
            disabled={leaving}
            onclick={confirmLeave}
          >
            {leaveLabel}
          </button>
        </div>
      </div>
    </div>
  {/if}

  {#if deleteTarget}
    <div class="modal-open modal" role="dialog">
      <div class="modal-box max-w-sm">
        <h3 class="text-sm font-bold">{m.groups_message_delete_confirm_title()}</h3>
        <p class="py-2 text-xs opacity-70">{m.groups_message_delete_confirm_body()}</p>
        <p class="truncate rounded bg-base-200 px-2 py-1 text-xs">{deleteTarget.content}</p>
        <div class="modal-action">
          <button class="btn btn-ghost btn-sm" onclick={() => (deleteTarget = null)}
            >{m.common_cancel()}</button
          >
          <button
            class="btn btn-sm btn-error"
            data-testid="group-message-delete-confirm"
            disabled={deleting}
            onclick={confirmDeleteMessage}
          >
            {m.groups_message_delete_confirm_action()}
          </button>
        </div>
      </div>
    </div>
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
            content: quoteText(replyParent)
          }
        : null}
      {onReply}
      replyTitle={m.groups_reply()}
      showContent={message.kind !== MEETING_KIND}
      onDelete={isAdmin && message.kind !== MEETING_KIND ? (msg) => (deleteTarget = msg) : null}
      deleteTitle={m.groups_message_delete()}
      onCopyLink={copyMessageLink}
      copyLinkTitle={m.chat_copy_message_link()}
      replyCount={threads.replyCount(message.id)}
      replyCountLabel={replyCountLabel(threads.replyCount(message.id))}
      onOpenThread={offerThread ? openThread : null}
    >
      {#snippet nameBadge(/** @type {string} */ pubkey)}
        <AgentBadge
          {pubkey}
          records={getAgentRecords()}
          ownerName={(() => {
            const owner = getAgentRecords().get(pubkey)?.ownerPubkey;
            return owner ? getUserDisplayName(owner, getProfiles().get(owner)) : '';
          })()}
          online={presenceIsOnline(getAgentPresence().get(pubkey), nowSeconds())}
        />
      {/snippet}
      {#snippet reactions(/** @type {any} */ msg)}
        <ReactionChips
          aggregated={reactionsByTarget.get(msg.id) ?? new Map()}
          addButtonOnHover
          onToggle={(emoji) => react(msg, emoji)}
          onPick={(emoji) => react(msg, emoji)}
        />
      {/snippet}
      {#snippet attachments(/** @type {any} */ msg)}
        {@const xdc = getWebxdcAttachment(msg)}
        {#if xdc}
          <WebxdcAttachmentCard
            attachment={xdc}
            title={sessionTitles.get(xdc.webxdc) ?? ''}
            onLaunch={openSession}
          />
        {/if}
        {#if msg.kind === 1068}
          {@const poll = parsePoll(msg)}
          <PollMessage
            {poll}
            tally={tallyPollVotes(
              votesByPoll.get(poll.id) ?? [],
              poll.options,
              poll.endsAt,
              myPubkey
            )}
            ended={isPollEnded(poll.endsAt)}
            onVote={(optionIds) => votePoll(poll, optionIds)}
          />
        {/if}
        {#if msg.kind === MEETING_KIND}
          <MeetingCard
            event={msg}
            {pointer}
            user={getActiveUser()}
            {isAdmin}
            onJoin={canJoinMeeting ? joinMeeting : undefined}
            onEdit={openEditMeeting}
            callRunning={callParticipantCount > 0}
          />
        {/if}
      {/snippet}
    </ChatMessageRow>
  {/snippet}

  <div class="flex min-h-0 flex-1">
    <!-- On a narrow viewport the panel takes the whole width; the timeline
         steps aside rather than being squeezed into a column of its own.
         min-w-0: a flex item is at least as wide as its content's
         min-content by default — with the call stage and the chat column
         side by side that widened the whole page (laoc, 2026-10-02). -->
    <div
      class="relative flex min-h-0 min-w-0 flex-1 flex-col {openThreadRoot
        ? threadExpanded
          ? 'hidden'
          : 'hidden md:flex'
        : ''}"
    >
      <GroupAppsBar {pointer} messages={displayed} sessionMeta={sessionTitles} onOpen={openStage} />
      {#if !callLiveHere}
        <MeetingBar
          {meetings}
          onJoin={canJoinMeeting ? joinMeeting : undefined}
          callRunning={callParticipantCount > 0}
        />
      {/if}
      {#if poppedOutHere}
        <div
          class="flex items-center justify-between gap-2 border-b border-base-300 bg-base-200 px-4 py-2 text-sm"
          role="status"
          data-testid="group-call-popped-out"
        >
          <span class="flex min-w-0 items-center gap-2">
            <MeetIcon class_="w-4 h-4 shrink-0 text-primary" title="" />
            <span class="truncate">{m.groups_call_popped_out()}</span>
          </span>
          <button type="button" class="btn btn-ghost btn-sm" onclick={popInCall}>
            {m.groups_call_bring_back()}
          </button>
        </div>
      {/if}
      <!-- Stage and chat share this box: stacked (one of them hidden), or
           side by side while the chat sits beside the call. -->
      <div class="flex min-h-0 flex-1 {chatBesideCall ? 'flex-row' : 'flex-col'}">
        {#if showCallHere}
          {#if call.phase === 'ready' && call.token && call.serverUrl}
            {#if chatVisible && CallStage.Component}
              <CallStage.Component
                title={displayTitle}
                {identityToPubkey}
                onLeave={() => leaveGroupCallWithConfirm()}
                onShowChat={showChatFromStage}
                chatOpen={call.chatBeside && wideScreen}
                onPopOut={canPopOut ? popOutHere : undefined}
                onInvite={canInvite ? () => (inviteOpen = true) : undefined}
                registerView={() =>
                  registerCallStageView(`${window.location.pathname}${window.location.search}`)}
              />
            {:else}
              <div
                class="flex flex-1 items-center justify-center"
                data-testid="group-call-loading"
                use:callViewOnScreen
              >
                <span class="loading loading-lg loading-spinner text-primary"></span>
              </div>
            {/if}
          {:else if call.phase === 'ended'}
            <div
              class="flex flex-1 flex-col items-center justify-center gap-2 p-4 text-center"
              role="status"
              data-testid="group-call-ended"
              use:callViewOnScreen
            >
              <p class="text-sm text-base-content/70">
                {call.endReason === 'removed'
                  ? m.groups_call_ended_removed()
                  : m.groups_call_ended_dropped()}
              </p>
              <div class="flex gap-2">
                <!-- No way back for a removed user: the relay blocks their
                  pass, so "Rejoin" would only fail (CallLanding's !removedHere). -->
                {#if call.endReason !== 'removed'}
                  <button
                    type="button"
                    class="btn btn-sm btn-primary"
                    onclick={startCall}
                    data-testid="group-call-rejoin"
                  >
                    {m.groups_call_rejoin()}
                  </button>
                {/if}
                <button
                  type="button"
                  class="btn btn-ghost btn-sm"
                  onclick={leaveGroupCall}
                  data-testid="group-call-ended-close"
                >
                  {m.common_close()}
                </button>
              </div>
            </div>
          {:else if call.phase === 'error'}
            <div
              class="flex flex-1 flex-col items-center justify-center gap-2 px-4 text-center"
              data-testid="group-call-error"
              use:callViewOnScreen
            >
              <p class="text-sm text-error">{callErrorMessage(call.error)}</p>
              <div class="flex gap-2">
                <button type="button" class="btn btn-sm btn-primary" onclick={startCall}>
                  {m.groups_call_retry()}
                </button>
                <button type="button" class="btn btn-ghost btn-sm" onclick={leaveGroupCall}>
                  {m.groups_call_leave()}
                </button>
              </div>
            </div>
          {:else}
            <div
              class="flex flex-1 flex-col items-center justify-center gap-2 px-4 text-center"
              data-testid="group-call-pending"
              use:callViewOnScreen
            >
              <span class="loading loading-lg loading-spinner text-primary"></span>
              <p class="text-sm text-base-content/60">{m.groups_call_requesting()}</p>
              <!-- A bunker held back by energy saver mode can keep this
                waiting for up to 45s; cancelling resets the call so the
                next "Join" asks again. -->
              <button
                type="button"
                class="btn btn-ghost btn-sm"
                onclick={leaveGroupCall}
                data-testid="group-call-pending-cancel"
              >
                {m.common_cancel()}
              </button>
            </div>
          {/if}
        {:else if activeSession}
          {#key activeSession.sessionId}
            <GroupAppStage
              {pointer}
              session={activeSession}
              selfPubkey={myPubkey}
              publish={signAndPublish}
              authenticate={authenticateSession}
              onShareText={handleShareText}
              onClose={closeStage}
              onOpenInNewTab={openInNewTab}
            />
          {/key}
        {/if}
        <!-- display:contents keeps the timeline/composer as direct flex items
           of the column; while a session is open the whole chat body steps
           aside (hidden, not unmounted) so the stage gets the full height.
           Beside the call it is a column of its own on wide screens. -->
        <div
          class={activeSession
            ? 'hidden'
            : chatBesideCall
              ? 'relative hidden min-h-0 flex-col border-l border-base-300 md:flex md:w-96 md:shrink-0'
              : showCallHere
                ? 'hidden'
                : 'contents'}
          data-testid="group-chat-body"
        >
          {#if inCallHere}
            <div role="tablist" class="tabs-border tabs border-b border-base-300 px-2 tabs-sm">
              <button
                role="tab"
                class="tab {chatTab === 'call' ? 'tab-active' : ''}"
                aria-selected={chatTab === 'call'}
                data-testid="chat-tab-call"
                onclick={() => (chatTab = 'call')}
              >
                {m.groups_call_chat_tab()}
                {#if callChatUnread.count > 0}
                  <CallUnreadDot class="ml-1.5" label={m.groups_call_chat_unread()} />
                {/if}
              </button>
              <button
                role="tab"
                class="tab {chatTab === 'channel' ? 'tab-active' : ''}"
                aria-selected={chatTab === 'channel'}
                data-testid="chat-tab-channel"
                onclick={() => (chatTab = 'channel')}
              >
                {m.groups_call_chat_channel_tab()}
                {#if channelUnreadInCall}
                  <CallUnreadDot
                    class="ml-1.5"
                    testid="channel-unread-dot"
                    label={m.groups_call_channel_unread()}
                  />
                {/if}
              </button>
            </div>
          {/if}
          {#if inCallHere && chatTab === 'call' && CallChatPanel.Component}
            <CallChatPanel.Component
              {identityToPubkey}
              title={displayTitle}
              onClose={closeCallChat}
            />
          {/if}
          <div
            class={inCallHere && chatTab === 'call' ? 'hidden' : 'contents'}
            data-testid="channel-chat-body"
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
                <div class="mx-auto py-6">
                  <span class="loading loading-md loading-dots"></span>
                </div>
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
            {#if restricted}
              <div
                class="flex items-center justify-between gap-3 rounded-xl border border-dashed border-base-300 px-4 py-3 text-sm text-base-content/70"
                data-testid="group-restricted-note"
              >
                <span>{m.groups_restricted_note()}</span>
                {#if joinPending}
                  <!-- The relay accepts a pending 9021 to a closed group even
              while reads stay restricted (verified live) — the same pending
              wording as the header/join-bar, not a dead end. -->
                  <span class="text-xs text-base-content/60">{m.community_join_pending()}</span>
                {:else if myPubkey && !canWrite}
                  <button class="btn btn-sm btn-primary" onclick={join}
                    >{groupClosed ? m.community_join_request() : m.groups_join()}</button
                  >
                {/if}
              </div>
            {:else if myPubkey && rosterAnswered && !canWrite}
              <!-- Readable, but not a member: the relay would reject every send
          ("blocked: unknown member") — offer the join instead of a composer
          whose messages silently vanish (laoc, 2026-08-19). -->
              <div
                class="flex items-center justify-between gap-3 rounded-xl border border-dashed border-base-300 px-4 py-3 text-sm text-base-content/70"
                data-testid="group-join-bar"
              >
                {#if joinPending}
                  <span>{m.community_join_pending()}</span>
                {:else}
                  <span>{m.groups_composer_join_note()}</span>
                  <button
                    class="btn btn-sm btn-primary"
                    data-testid="group-join-bar-button"
                    onclick={join}
                    >{groupClosed ? m.community_join_request() : m.groups_join()}</button
                  >
                {/if}
              </div>
            {:else}
              <!-- disabled while the roster hasn't answered yet, not just while
          logged out: canWrite is unknown until then, and an enabled input a
          non-member could type into is a dead end the moment the roster
          finally does answer restricted (laoc, 2026-08-19). -->
              <ChatComposer
                bind:value={text}
                placeholder={m.groups_input_placeholder({ name: displayTitle })}
                disabled={!myPubkey || !rosterAnswered}
                {sending}
                onSubmit={send}
                replyTo={replyTo && { content: quoteText(replyTo) }}
                onCancelReply={() => (replyTo = null)}
                testid="group-chat-input"
                {customEmojiSets}
                onOpenApps={canWrite ? () => (appPickerOpen = true) : null}
                onAttachFiles={canWrite ? (files) => attachFiles(files, 'timeline') : null}
                uploading={attachments.uploading}
                onOpenPoll={canWrite ? () => (pollModalOpen = true) : null}
              />
            {/if}
          </div>
        </div>
      </div>
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
            {customEmojiSets}
            placeholder={m.chat_thread_reply_placeholder()}
            disabled={!myPubkey}
            {sending}
            onSubmit={sendInThread}
            replyTo={threadReplyTo && { content: quoteText(threadReplyTo) }}
            onCancelReply={() => (threadReplyTo = null)}
            testid="thread-chat-input"
            onAttachFiles={canWrite ? (files) => attachFiles(files, 'thread') : null}
            uploading={attachments.uploading}
          />
        {/snippet}
      </ThreadPanel>
    {/if}
  </div>

  {#if inviteOpen && CallInviteDialog.Component}
    {@const user = getActiveUser()}
    {#if user?.signer}
      <CallInviteDialog.Component
        {pointer}
        {user}
        {isAdmin}
        title={displayTitle}
        onClose={() => (inviteOpen = false)}
      />
    {/if}
  {/if}
</div>
