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
  import { eventStore, pool } from '$lib/stores/nostr-infrastructure.svelte';
  import { useActiveUser } from '$lib/stores/accounts.svelte';
  import { useProfileMap } from '$lib/stores/profile-map.svelte.js';
  import { storeEvents } from 'applesauce-relay/operators';
  import { TimelineModel } from 'applesauce-core/models';
  import {
    GROUP_METADATA_KIND,
    GROUP_ADMINS_KIND,
    GROUP_MEMBERS_KIND,
    getGroupMetadata,
    getGroupMembers
  } from 'applesauce-common/helpers/groups';
  import {
    buildGroupMessageTemplate,
    buildJoinRequestTemplate,
    buildLeaveRequestTemplate,
    buildGroupsListTemplate
  } from '$lib/groups/groups.js';
  import { relayBadges, channelBadges } from '$lib/groups/group-badges.js';
  import { relayHref, relayLabel } from '$lib/groups/relay-directory.js';
  import { authenticateOnce } from '$lib/groups/relay-auth.js';
  import GroupBadges from '$lib/components/groups/GroupBadges.svelte';
  import { useRelayInformation } from '$lib/groups/relay-information.svelte.js';
  import { publishEventOptimistic } from '$lib/services/publish-service.js';
  import { aggregateChannelReactions } from '$lib/concord/chat-helpers.js';
  import {
    formatMessageTimestamp,
    getUserDisplayName,
    getReplyParentId,
    groupMessagesByDate
  } from '$lib/helpers/message-utils.js';
  import ChatMessageList from '$lib/components/chat/ChatMessageList.svelte';
  import ChatMessageRow from '$lib/components/chat/ChatMessageRow.svelte';
  import ReactionChips from '$lib/components/reactions/ReactionChips.svelte';
  import { showToast } from '$lib/helpers/toast';
  import * as m from '$lib/paraglide/messages';

  /** @type {{pointer: import('$lib/groups/groups.js').GroupPointer}} */
  let { pointer } = $props();

  const getActiveUser = useActiveUser();

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
  /** @type {Set<string>} */ let members = $state(new Set());
  let authRequired = $state(false);
  let isLoading = $state(true);
  /** @type {any[]} */ let messages = $state([]);
  /** @type {any[]} */ let reactionEvents = $state([]);

  // Group metadata/roster: relay-authored addressables with d = group id,
  // requested from the group's own relay only.
  $effect(() => {
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
  const grouped = $derived(groupMessagesByDate(displayed));
  const getProfiles = useProfileMap(() => displayed.map((event) => event.pubkey));
  const reactionsByTarget = $derived(
    aggregateChannelReactions(reactionEvents, getActiveUser()?.pubkey)
  );
  const myPubkey = $derived(getActiveUser()?.pubkey);
  const isMember = $derived(!!myPubkey && members.has(myPubkey));

  let text = $state('');
  let sending = $state(false);
  /** @type {{id: string, pubkey: string, content: string} | null} */
  let replyTo = $state(null);

  /** Sign a template and publish it to the group relay only. @param {any} template */
  async function signAndPublish(template) {
    const user = getActiveUser();
    if (!user) throw new Error('no active user');
    const signed = await user.signer.signEvent({ ...template, pubkey: user.pubkey });
    const response = await pool.relay(pointer.relay).publish(signed);
    if (response && response.ok === false) {
      throw new Error(response.message || 'relay rejected the event');
    }
    return signed;
  }

  async function send() {
    const value = text.trim();
    if (!value || sending) return;
    sending = true;
    try {
      const signed = await signAndPublish(
        buildGroupMessageTemplate(
          pointer.id,
          value,
          replyTo && { id: replyTo.id, pubkey: replyTo.pubkey }
        )
      );
      eventStore.add(signed);
      text = '';
      replyTo = null;
    } catch (err) {
      console.error('group send failed', err);
      showToast(m.groups_send_failed(), 'error');
    } finally {
      sending = false;
    }
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
    }
  }

  /**
   * Mirror a join/leave into the user's kind-10009 GROUPS list (published to
   * the user's own relays, NOT the group relay) so joined groups roam.
   * @param {{add?: any, remove?: any}} change
   */
  async function updateGroupsList(change) {
    const user = getActiveUser();
    if (!user?.signer) return;
    const existing = eventStore.getReplaceable(10009, user.pubkey) ?? null;
    const template = buildGroupsListTemplate(existing, change);
    const signed = await user.signer.signEvent({ ...template, pubkey: user.pubkey });
    eventStore.add(signed);
    publishEventOptimistic(signed);
  }

  async function join() {
    try {
      await signAndPublish(buildJoinRequestTemplate(pointer.id));
      await updateGroupsList({ add: pointer });
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
      showToast(m.groups_leave_sent(), 'success');
    } catch (err) {
      console.error('leave request failed', err);
      showToast(m.groups_join_failed(), 'error');
    }
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
        >{members.size ? ` · ${members.size}` : ''}
        {#if metadata?.about}&nbsp;— {metadata.about}{/if}
      </p>
      <GroupBadges access={accessBadges} host={hostBadges} class="mt-1" />
    </div>
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

  {#if authRequired}
    <div class="bg-warning/20 px-4 py-2 text-xs" data-testid="group-auth-banner">
      {m.groups_auth_required()}
    </div>
  {/if}

  <div class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
    {#if isLoading && displayed.length === 0}
      <div class="mx-auto py-6"><span class="loading loading-md loading-dots"></span></div>
    {/if}
    <ChatMessageList items={grouped}>
      {#snippet row(/** @type {any} */ message)}
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
          onReply={(msg) => (replyTo = { id: msg.id, pubkey: msg.pubkey, content: msg.content })}
          replyTitle={m.groups_reply()}
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
    </ChatMessageList>
  </div>

  {#if replyTo}
    <div class="flex items-center gap-2 border-t border-base-300 bg-base-200 px-4 py-1 text-xs">
      <span class="truncate opacity-70">↩ {replyTo.content.slice(0, 80)}</span>
      <button type="button" class="btn ml-auto btn-ghost btn-xs" onclick={() => (replyTo = null)}>
        ✕
      </button>
    </div>
  {/if}

  <form
    class="m-4 mt-2 flex shrink-0 items-center gap-2 rounded-full border border-base-300 bg-base-200 p-1.5"
    onsubmit={(e) => {
      e.preventDefault();
      send();
    }}
  >
    <input
      class="input flex-1 input-ghost focus:outline-none"
      data-testid="group-chat-input"
      bind:value={text}
      placeholder={m.groups_input_placeholder({ name: metadata?.name ?? pointer.id })}
      disabled={!myPubkey}
    />
    <button
      class="btn btn-circle btn-sm btn-neutral"
      type="submit"
      disabled={sending || !text.trim()}>➤</button
    >
  </form>
</div>
