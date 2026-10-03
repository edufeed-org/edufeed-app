<!--
  CallChatPanel — the call's own chat (LiveKit data, livekit-connection's
  CHAT_TOPIC). Everyone in the call sees it, guests included; it is gone
  when the call ends. The channel chat stays members-only.
-->
<script>
  import { tick } from 'svelte';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { getLiveKitState, sendCallChat } from '$lib/services/livekit-connection.svelte.js';
  import { getGroupCallState } from '$lib/groups/group-call.svelte.js';
  import { useProfileMap } from '$lib/stores/profile-map.svelte.js';
  import { avatarInitial } from '$lib/helpers/avatar-initial.js';
  import { profileLink } from '$lib/helpers/nostrUtils.js';
  import { canPopOutCall, popOutCall } from '$lib/groups/call-popout.svelte.js';
  import { isGuestParticipant } from '$lib/groups/livekit.js';
  import {
    formatCallChatTxt,
    callChatFileName,
    downloadTextFile
  } from '$lib/groups/call-chat-export.js';
  import { DownloadIcon } from '$lib/components/icons';
  import ProfileAvatar from '$lib/components/shared/ProfileAvatar.svelte';
  import HoverCard from '$lib/components/shared/HoverCard.svelte';
  import ProfileHoverCardContent from '$lib/components/shared/ProfileHoverCardContent.svelte';
  import * as m from '$lib/paraglide/messages';

  /**
   * @type {{
   *   identityToPubkey: (identity: string) => string | null,
   *   title?: string
   * }}
   */
  // title: the call's own name — only needed to re-label the pop-out window
  // when a sender's avatar/name is clicked from in here (QA 2026-10-02).
  let { identityToPubkey, title = '' } = $props();

  const lk = getLiveKitState();
  const call = getGroupCallState();
  let draft = $state('');
  /** @type {HTMLDivElement | undefined} */
  let listEl = $state(undefined);

  const getProfiles = useProfileMap(() =>
    lk.callChat
      .map((c) => identityToPubkey(c.identity))
      .filter((/** @type {string | null} */ pk) => typeof pk === 'string')
  );

  /** @param {string} identity */
  function nameOf(identity) {
    const pk = identityToPubkey(identity);
    const p = pk ? getProfiles().get(pk) : undefined;
    return p?.display_name || p?.name || pk?.slice(0, 8) || '?';
  }

  // Consecutive messages from the same sender group under one avatar — the
  // name repeats anyway (QA Task 18), only the avatar is worth collapsing.
  /** @param {number} index */
  function isGrouped(index) {
    return index > 0 && lk.callChat[index - 1].identity === lk.callChat[index].identity;
  }

  // Clicking a sender's avatar or name: pop the call out first (when the
  // browser supports it AND the call is actually live — a connecting/ended/
  // failed call has nothing worth keeping on screen) so leaving to the
  // profile route doesn't drop it, then navigate. Must run synchronously
  // from the click — pop-out needs the user activation (QA 2026-10-02).
  /** @param {MouseEvent} e @param {string} pk */
  function openProfile(e, pk) {
    e.preventDefault();
    // The click also bubbles into HoverCard's own wrapper; nothing there
    // needs it (interactiveTrigger mode doesn't toggle on click), but stop
    // it so a click can only ever do the one thing: navigate.
    e.stopPropagation();
    if (call.phase === 'ready' && call.connected && canPopOutCall()) {
      popOutCall({ title, identityToPubkey }).catch((err) => {
        console.warn('call pop-out failed:', err);
      });
    }
    goto(resolve(profileLink(pk)));
  }

  $effect(() => {
    const count = lk.callChat.length;
    void count;
    tick().then(() => {
      if (typeof listEl?.scrollTo === 'function') {
        listEl.scrollTo({ top: listEl.scrollHeight });
      }
    });
  });

  // Not connected (the server ended the call): the messages stay readable,
  // nothing can be sent.
  const canSend = $derived(lk.isConnected && lk.canSignal);
  // Says why the input is greyed (QA 2026-10-02 C4).
  const offlineHintId = `call-chat-offline-${Math.random().toString(36).slice(2, 8)}`;

  // Guests are marked "(Gast)" in the export. Remembered for the whole call:
  // a guest who already left still wrote their messages as a guest.
  /** @type {Set<string>} */
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- bookkeeping, never rendered
  const guestIdentities = new Set();
  $effect(() => {
    for (const p of [lk.localParticipant, ...(lk.remoteParticipants ?? [])]) {
      if (p && isGuestParticipant(p)) guestIdentities.add(p.identity);
    }
  });

  function downloadChat() {
    if (lk.callChat.length === 0) return;
    const now = new Date();
    const channel = title || m.groups_call_chat_tab();
    const text = formatCallChatTxt({
      channel,
      exportedAt: now,
      labels: {
        exportedAt: (time) => m.groups_call_chat_exported_at({ time }),
        guest: m.groups_call_guest_badge()
      },
      messages: lk.callChat.map((c) => ({
        at: c.at,
        name: nameOf(c.identity),
        guest: guestIdentities.has(c.identity),
        text: c.text
      }))
    });
    downloadTextFile(callChatFileName(channel, now), text);
  }

  async function send() {
    if (!canSend) return;
    const text = draft;
    draft = '';
    await sendCallChat(text);
  }
</script>

<div class="flex min-h-0 flex-1 flex-col" data-testid="call-chat-panel">
  <div
    class="flex shrink-0 items-center justify-end border-b border-base-300 px-2 py-1"
    data-testid="call-chat-header"
  >
    <button
      type="button"
      class="btn btn-square btn-ghost btn-sm"
      aria-label={m.groups_call_chat_download()}
      title={m.groups_call_chat_download()}
      disabled={lk.callChat.length === 0}
      onclick={downloadChat}
      data-testid="call-chat-download"
    >
      <DownloadIcon class_="h-4 w-4" title="" />
    </button>
  </div>
  <div bind:this={listEl} class="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3">
    {#if lk.callChat.length === 0}
      <p class="m-auto cursor-default text-center text-sm text-base-content/60 select-none">
        {m.groups_call_chat_empty()}
      </p>
    {/if}
    {#each lk.callChat as msg, i (msg.id)}
      {@const pk = identityToPubkey(msg.identity)}
      <div class="flex items-start gap-2 text-sm" data-testid="call-chat-message">
        {#if pk}
          <!-- Avatar + name are one hover/click target (same pattern as
               ParticipantTile): hovering either shows the profile hover
               card, clicking either pops the call out (when supported) and
               opens the profile (QA 2026-10-02). -->
          <HoverCard
            position="top"
            fixed={true}
            class="contents"
            triggerClass="contents"
            interactiveTrigger
          >
            {#snippet trigger()}
              <a
                href={resolve(profileLink(pk))}
                class="flex shrink-0 items-start gap-2 hover:underline"
                data-testid="call-chat-sender-link"
                onclick={(e) => openProfile(e, pk)}
              >
                <span class="w-6 shrink-0">
                  {#if !isGrouped(i)}
                    <ProfileAvatar
                      pubkey={pk}
                      size="xs"
                      showHoverCard={false}
                      linkToProfile={false}
                    />
                  {/if}
                </span>
                <span class="font-semibold">{nameOf(msg.identity)}</span>
              </a>
            {/snippet}
            {#snippet content()}
              <ProfileHoverCardContent pubkey={pk} profile={getProfiles().get(pk)} />
            {/snippet}
          </HoverCard>
        {:else}
          <!-- An identity LiveKit sent that does not resolve to a pubkey
               (should not happen — guests get a real generated keypair too,
               see guest-account.js) — same initials + colours as
               ParticipantTile's own no-pubkey fallback. No profile to link
               to or read a name from, so the initial comes from the
               identity string itself. -->
          <span class="w-6 shrink-0">
            {#if !isGrouped(i)}
              <div
                class="flex h-6 w-6 items-center justify-center rounded-full bg-secondary text-xs font-semibold text-secondary-content"
                data-testid="call-chat-avatar-fallback"
              >
                {avatarInitial(msg.identity, '?')}
              </div>
            {/if}
          </span>
          <span class="font-semibold">{nameOf(msg.identity)}</span>
        {/if}
        <span class="min-w-0 flex-1 break-words whitespace-pre-wrap">{msg.text}</span>
      </div>
    {/each}
  </div>
  {#if !lk.isConnected}
    <p
      id={offlineHintId}
      class="cursor-default border-t border-base-300 px-3 pt-2 text-xs text-base-content/60 select-none"
      data-testid="call-chat-offline"
    >
      {m.groups_call_chat_offline()}
    </p>
  {/if}
  <form
    class="flex gap-2 p-2 {lk.isConnected ? 'border-t border-base-300' : ''}"
    onsubmit={(e) => {
      e.preventDefault();
      send();
    }}
  >
    <input
      class="input-bordered input input-sm flex-1"
      maxlength="2000"
      placeholder={m.groups_call_chat_placeholder()}
      bind:value={draft}
      disabled={!canSend}
      aria-describedby={lk.isConnected ? undefined : offlineHintId}
      data-testid="call-chat-input"
      onkeydown={(e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          send();
        }
      }}
    />
    <button
      type="submit"
      class="btn btn-sm btn-primary"
      disabled={!canSend}
      data-testid="call-chat-send"
    >
      {m.groups_call_chat_send()}
    </button>
  </form>
</div>
