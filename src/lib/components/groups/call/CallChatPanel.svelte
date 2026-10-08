<!--
  CallChatPanel — the call's own chat (LiveKit data, livekit-connection's
  CHAT_TOPIC). Everyone in the call sees it, guests included; it is gone
  when the call ends. The channel chat stays members-only.
-->
<script>
  import { tick, untrack } from 'svelte';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import {
    CALL_FILE_MAX_BYTES,
    getLiveKitState,
    sendCallChat,
    sendCallFile
  } from '$lib/services/livekit-connection.svelte.js';
  import { formatFileSize } from '$lib/helpers/media-meta.js';
  import { showToast } from '$lib/helpers/toast.js';
  import { getGroupCallState } from '$lib/groups/group-call.svelte.js';
  import { useProfileMap } from '$lib/stores/profile-map.svelte.js';
  import { avatarInitial } from '$lib/helpers/avatar-initial.js';
  import { profileLink } from '$lib/helpers/nostrUtils.js';
  import { canPopOutCall, popOutCall } from '$lib/groups/call-popout.svelte.js';
  import {
    formatCallChatTxt,
    callChatFileName,
    downloadTextFile
  } from '$lib/groups/call-chat-export.js';
  import {
    linkifyCallChat,
    callChatPreviewUrls,
    withCustomEmojis
  } from '$lib/groups/call-chat-links.js';
  import { registerCallChatView } from '$lib/groups/call-chat-unread.svelte.js';
  import {
    getCallChatCompose,
    takePrivateRecipient
  } from '$lib/groups/call-chat-compose.svelte.js';
  import { trackOnScreen } from '$lib/groups/track-on-screen.js';
  import { customEmojisIn } from '$lib/helpers/emoji-autocomplete.js';
  import {
    EVERYONE,
    isMentioned,
    mentionCandidates,
    mentionsIn,
    withMentions
  } from '$lib/groups/call-chat-mentions.js';
  import { useUserEmojiSets } from '$lib/stores/user-emoji-sets.svelte.js';
  import { lazyComponent } from '$lib/helpers/lazy-component.svelte.js';
  import { isPreviewableCallFile } from '$lib/groups/call-files.js';
  import {
    CloseIcon,
    DownloadIcon,
    LockIcon,
    ReplyIcon,
    SendIcon,
    SmilePlusIcon
  } from '$lib/components/icons';
  import ComposerInput from '$lib/components/shared/ComposerInput.svelte';
  import ImageWithFallback from '$lib/components/shared/ImageWithFallback.svelte';
  import LinkPreview from '$lib/components/shared/LinkPreview.svelte';
  import ProfileAvatar from '$lib/components/shared/ProfileAvatar.svelte';
  import HoverCard from '$lib/components/shared/HoverCard.svelte';
  import ProfileHoverCardContent from '$lib/components/shared/ProfileHoverCardContent.svelte';
  import * as m from '$lib/paraglide/messages';

  /**
   * @type {{
   *   identityToPubkey: (identity: string) => string | null,
   *   title?: string,
   *   onClose?: () => void
   * }}
   */
  // title: the call's own name — only needed to re-label the pop-out window
  // when a sender's avatar/name is clicked from in here (QA 2026-10-02).
  // onClose: the parent's way of collapsing this panel (the stage header's
  // Chat toggle, the phone's back-to-call, the member page's column) — the
  // panel offers a close control and Escape in an empty composer for it.
  let { identityToPubkey, title = '', onClose = undefined } = $props();

  const lk = getLiveKitState();
  const call = getGroupCallState();
  let draft = $state('');
  /** @type {HTMLDivElement | undefined} */
  let listEl = $state(undefined);

  // The composer is the app's ComposerInput: `:xx` autocomplete over the
  // user's NIP-30 packs + unicode, inline images for picked custom emojis.
  // A guest has no kind 10030, so useUserEmojiSets() hands them no packs —
  // unicode only, nothing to special-case.
  /** @type {ReturnType<typeof ComposerInput> | undefined} */
  let composer = $state(undefined);
  const getUserEmojiSets = useUserEmojiSets();
  const customEmojiSets = $derived(getUserEmojiSets());
  // A pick from the full picker may come from a pack the user does not
  // list (the picker's "recent" row): remember its url so it still
  // travels with the message.
  /** @type {Record<string, string>} */
  let pickedUrls = $state.raw({});
  // The full picker (unicode + custom), lazy like on the stage: neither it
  // nor the emoji dataset enter this panel's static graph. It gets THIS
  // panel's packs, so the picker and the `:xx` autocomplete always agree
  // (smoke test 2026-10-08: the picker showed no custom emojis).
  const EmojiPickerLazy = lazyComponent(() => import('./CallEmojiPicker.svelte'));
  let pickerOpen = $state(false);

  /** @param {string | { shortcode: string, url: string }} emoji */
  function pickEmoji(emoji) {
    if (typeof emoji !== 'string') pickedUrls = { ...pickedUrls, [emoji.shortcode]: emoji.url };
    composer?.insert(emoji);
    pickerOpen = false;
  }

  // Reply-to: the next message points at `replyTarget.id` and embeds the
  // quote (author + first line) so it shows even where the original never
  // arrived (joined later, sender already gone).
  /** @type {import('$lib/services/livekit-connection.svelte.js').CallChatMessage | null} */
  let replyTarget = $state(null);
  /** The row a quote click just jumped to — highlighted for a moment. */
  /** @type {string | null} */
  let flashId = $state(null);
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let flashTimer;

  /** @param {string} text */
  const firstLine = (text) => text.split(/\r\n|\r|\n/)[0].trim();

  /** @param {import('$lib/services/livekit-connection.svelte.js').CallChatMessage} msg */
  function startReply(msg) {
    if (!canSend) return;
    replyTarget = msg;
    composer?.focus();
  }
  // Escape in the composer: an active reply quote is cancelled first; an
  // empty composer has nothing to lose, so the next Escape closes the panel.
  // A draft stays put - Escape only steps out of the input then.
  function onComposerEscape() {
    if (replyTarget) {
      cancelReply();
      return;
    }
    if (onClose && draft.trim() === '') onClose();
  }

  function cancelReply() {
    replyTarget = null;
  }

  // Long-press on a touch screen is the "Antworten" of a row without hover.
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let pressTimer;
  /** @param {PointerEvent} e @param {import('$lib/services/livekit-connection.svelte.js').CallChatMessage} msg */
  function pressStart(e, msg) {
    if (e.pointerType !== 'touch') return;
    clearTimeout(pressTimer);
    pressTimer = setTimeout(() => startReply(msg), 500);
  }
  function pressEnd() {
    clearTimeout(pressTimer);
  }

  /**
   * What a reply quotes: the live original when it is still here (its
   * current author name and text win over the sender's embedded preview,
   * which may be stale), else the embedded preview.
   * @param {import('$lib/services/livekit-connection.svelte.js').CallChatMessage} msg
   * @returns {{ name: string, text: string, targetId: string | null } | null}
   */
  function quoteOf(msg) {
    const original = msg.replyTo ? lk.callChat.find((c) => c.id === msg.replyTo) : undefined;
    if (original) {
      return {
        name: nameOf(original.identity),
        text: firstLine(original.text),
        targetId: original.id
      };
    }
    if (msg.replyPreview)
      return { name: msg.replyPreview.n, text: msg.replyPreview.text, targetId: null };
    return null;
  }

  /** Scroll the quoted original into view and flash it. @param {string} id */
  function jumpTo(id) {
    const row = Array.from(listEl?.querySelectorAll('[data-call-chat-id]') ?? []).find(
      (el) => /** @type {HTMLElement} */ (el).dataset.callChatId === id
    );
    if (!row) return;
    row.scrollIntoView({ block: 'center', behavior: 'smooth' });
    flashId = id;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => (flashId = null), 1500);
  }

  // Senders AND the people in the room: the latter for the @-mention
  // candidates and the chips, before they have said anything.
  const getProfiles = useProfileMap(() =>
    [
      ...lk.callChat.map((c) => c.identity),
      ...(lk.remoteParticipants ?? []).map((p) => p.identity),
      ...(lk.localParticipant ? [lk.localParticipant.identity] : [])
    ]
      .map((identity) => identityToPubkey(identity))
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
    if (index === 0) return false;
    const prev = lk.callChat[index - 1];
    return !prev.system && prev.identity === lk.callChat[index].identity;
  }

  // Leaving for another app route must not cost the call its screen: pop
  // the call out first (when the browser supports it AND the call is
  // actually live — a connecting/ended/failed call has nothing worth keeping
  // on screen), then navigate client-side; the call store keeps the Room
  // either way, the dock shows it when nothing else does. Must run
  // synchronously from the click — pop-out needs the user activation
  // (QA 2026-10-02). Used by the sender's avatar/name and by app links in
  // messages.
  /** @param {MouseEvent} e @param {string} path */
  function openInApp(e, path) {
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
    goto(resolve(/** @type {any} */ (path)));
  }

  /** @param {MouseEvent} e @param {string} pk */
  function openProfile(e, pk) {
    openInApp(e, profileLink(pk));
  }

  // An app link in a message. A modified or middle click (new tab / window)
  // is the browser's to handle and leaves the call where it is.
  /** @param {MouseEvent} e @param {string} path */
  function openAppLink(e, path) {
    if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    openInApp(e, path);
  }

  // @mentions: the composer offers the OTHER participants (and "alle");
  // a pick inserts plain `@Name` and is remembered name → identity, so the
  // send can list the identities whose @Name is still in the text.
  const myIdentity = $derived(lk.localParticipant?.identity ?? null);
  const others = $derived(
    (lk.remoteParticipants ?? []).map((p) => ({
      identity: p.identity,
      name: nameOf(p.identity),
      pubkey: identityToPubkey(p.identity)
    }))
  );
  /** @type {Record<string, string>} name → identity (or EVERYONE) */
  let pickedMentions = $state.raw({});
  /** @param {string} query */
  function provideMentions(query) {
    return mentionCandidates(query, others, { everyone: m.groups_call_chat_mention_everyone() });
  }
  /** @param {{ key: string, name: string }} c */
  function rememberMention(c) {
    pickedMentions = { ...pickedMentions, [c.name]: c.key };
  }
  /** identity → display name, for the chips of a received message */
  /** @param {string[] | undefined} mentions */
  function mentionNames(mentions) {
    /** @type {Record<string, string>} */
    const names = {};
    for (const id of mentions ?? []) {
      names[id] = id === EVERYONE ? m.groups_call_chat_mention_everyone() : nameOf(id);
    }
    return names;
  }

  // Private messages: "An: Alle" or one participant. The choice stays until
  // changed (a private exchange is usually several lines) and falls back to
  // everyone when that person leaves. A tile's "Privat schreiben" arrives
  // through the compose store.
  /** '' = everyone, else the recipient identity */
  let recipient = $state('');
  const compose = getCallChatCompose();
  $effect(() => {
    if (compose.recipient) {
      const requested = takePrivateRecipient();
      if (requested) {
        recipient = requested;
        composer?.focus();
      }
    }
  });
  $effect(() => {
    if (recipient && !others.some((p) => p.identity === recipient)) recipient = '';
  });
  const recipientName = $derived(recipient ? nameOf(recipient) : '');
  /**
   * "privat an X" on my own copy, "privat von X" on a received one.
   * @param {import('$lib/services/livekit-connection.svelte.js').CallChatMessage} msg
   */
  function privateLabel(msg) {
    if (!msg.to) return '';
    return msg.identity === myIdentity
      ? m.groups_call_chat_private_to({ name: nameOf(msg.to) })
      : m.groups_call_chat_private_from({ name: nameOf(msg.identity) });
  }

  // Files: a LiveKit byte stream to the people in the call right now (or
  // to the chosen recipient), never uploaded anywhere.
  /** @type {HTMLInputElement | undefined} */
  let fileInput = $state(undefined);
  /** @param {Event} e */
  async function attach(e) {
    const input = /** @type {HTMLInputElement} */ (e.currentTarget);
    const file = input.files?.[0];
    input.value = '';
    if (!file || !canSend) return;
    const result = await sendCallFile(file, { to: recipient || undefined });
    if (!result.ok && result.error === 'too-large') {
      showToast(
        m.groups_call_chat_file_too_large({ max: formatFileSize(CALL_FILE_MAX_BYTES) ?? '' }),
        'warning'
      );
    } else if (!result.ok && result.error === 'failed') {
      showToast(m.groups_call_chat_file_failed(), 'error');
    }
  }

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  // One parse per message, not per render: messages never change once kept.
  const parsed = $derived(
    new Map(
      lk.callChat.map((c) => {
        const segments = withMentions(
          withCustomEmojis(linkifyCallChat(c.text, origin), c.emoji),
          c.mentions,
          mentionNames(c.mentions)
        );
        return [c.id, { segments, previews: callChatPreviewUrls(segments) }];
      })
    )
  );

  // While this panel is actually on screen (laid out — the /c layout keeps
  // hidden copies mounted, and below md the chat column is display:none),
  // the call chat counts as seen: that is what clears the unread dots.
  // Untracked: registering writes the marker's own state.
  /** @type {HTMLDivElement | undefined} */
  let rootEl = $state(undefined);
  $effect(() => {
    const node = rootEl;
    if (!node) return;
    return untrack(() => trackOnScreen(node, registerCallChatView));
  });

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
        guest: c.guest === true,
        text: c.file ? `[${m.groups_call_chat_file_label()}] ${c.file.name}` : c.text,
        ...(c.to ? { note: privateLabel(c) } : {}),
        ...(c.system ? { note: m.groups_call_broadcast_label() } : {})
      }))
    });
    downloadTextFile(callChatFileName(channel, now), text);
  }

  async function send() {
    if (!canSend || !draft.trim()) return;
    const text = draft.trim();
    draft = '';
    pickerOpen = false;
    // The custom emojis the text still references, as [shortcode, url]
    // pairs: a data message has no `emoji` tags, so the urls travel inline.
    const sets = [
      ...customEmojiSets,
      {
        packName: '',
        emojis: Object.entries(pickedUrls).map(([shortcode, url]) => ({ shortcode, url }))
      }
    ];
    const emoji = customEmojisIn(text, sets).map(
      (e) => /** @type {[string, string]} */ ([e.shortcode, e.url])
    );
    const reply = replyTarget;
    replyTarget = null;
    const mentions = mentionsIn(text, pickedMentions);
    pickedMentions = {};
    await sendCallChat(text, {
      emoji,
      mentions,
      ...(recipient ? { to: recipient } : {}),
      ...(reply
        ? {
            replyTo: reply.id,
            replyPreview: { n: nameOf(reply.identity), text: firstLine(reply.text) }
          }
        : {})
    });
  }
</script>

<div bind:this={rootEl} class="flex min-h-0 flex-1 flex-col" data-testid="call-chat-panel">
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
    {#if onClose}
      <button
        type="button"
        class="btn btn-square btn-ghost btn-sm"
        aria-label={m.groups_call_chat_close()}
        title={m.groups_call_chat_close()}
        onclick={onClose}
        data-testid="call-chat-close"
      >
        <CloseIcon class_="h-4 w-4" title="" />
      </button>
    {/if}
  </div>
  <div
    bind:this={listEl}
    class="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3"
    role="list"
  >
    {#if lk.callChat.length === 0}
      <p class="m-auto cursor-default text-center text-sm text-base-content/60 select-none">
        {m.groups_call_chat_empty()}
      </p>
    {/if}
    {#each lk.callChat as msg, i (msg.id)}
      {@const pk = identityToPubkey(msg.identity)}
      {@const body = parsed.get(msg.id)}
      {#if msg.system}
        <!-- A local system line: a call broadcast from the host (kind 20002
             over the relay) this client noted itself — not a message anyone
             sent here, so no avatar, reply or mention treatment. -->
        <div
          class="flex items-start gap-2 rounded bg-base-200 px-2 py-1 text-xs text-base-content/80"
          role="listitem"
          data-testid="call-chat-system"
          data-call-chat-id={msg.id}
        >
          <span class="shrink-0 font-semibold">
            {m.groups_call_broadcast_line({ name: nameOf(msg.identity) })}
          </span>
          <span class="min-w-0 break-words whitespace-pre-wrap">{msg.text}</span>
        </div>
      {:else}
        <div
          class="group relative -mx-1 flex items-start gap-2 rounded px-1 text-sm transition-colors {flashId ===
          msg.id
            ? 'bg-primary/10'
            : isMentioned(msg, myIdentity)
              ? 'bg-accent/15'
              : msg.to
                ? 'bg-secondary/10'
                : ''}"
          role="listitem"
          data-testid="call-chat-message"
          data-call-chat-id={msg.id}
          data-private={msg.to ? 'true' : undefined}
          data-mentioned={isMentioned(msg, myIdentity) ? 'true' : undefined}
          data-flash={flashId === msg.id ? 'true' : undefined}
          onpointerdown={(e) => pressStart(e, msg)}
          onpointerup={pressEnd}
          onpointercancel={pressEnd}
          onpointerleave={pressEnd}
        >
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
          <div class="flex min-w-0 flex-1 flex-col gap-1">
            {#if msg.to}
              <span
                class="badge w-fit badge-xs badge-secondary"
                data-testid="call-chat-private-badge">{privateLabel(msg)}</span
              >
            {/if}
            {#if msg.replyTo || msg.replyPreview}
              {@const quote = quoteOf(msg)}
              {#if quote?.targetId}
                <button
                  type="button"
                  class="flex max-w-full min-w-0 cursor-pointer gap-1 border-l-2 border-primary/60 pl-2 text-left text-xs text-base-content/70 hover:text-base-content"
                  aria-label={m.groups_call_chat_jump_to_original()}
                  title={m.groups_call_chat_jump_to_original()}
                  onclick={() => jumpTo(/** @type {string} */ (quote.targetId))}
                  data-testid="call-chat-quote"
                >
                  <span class="shrink-0 font-semibold">{quote.name}</span>
                  <span class="truncate">{quote.text}</span>
                </button>
              {:else if quote}
                <div
                  class="flex max-w-full min-w-0 gap-1 border-l-2 border-base-300 pl-2 text-xs text-base-content/70"
                  data-testid="call-chat-quote"
                >
                  <span class="shrink-0 font-semibold">{quote.name}</span>
                  <span class="truncate">{quote.text}</span>
                </div>
              {/if}
            {/if}
            {#if msg.file}
              {@const f = msg.file}
              <div
                class="flex w-fit max-w-full flex-col gap-1 rounded-box border border-base-300 bg-base-200 px-3 py-2"
                data-testid="call-chat-file"
              >
                {#if f.status === 'done' && f.url && isPreviewableCallFile(f.mime)}
                  <!-- Inline only, never a link that opens the blob as a document. -->
                  <img
                    src={f.url}
                    alt={f.name}
                    class="max-h-48 max-w-full rounded object-contain"
                    loading="lazy"
                  />
                {/if}
                <div class="flex min-w-0 items-center gap-2">
                  <span class="min-w-0 truncate font-medium" title={f.name}>{f.name}</span>
                  <span class="shrink-0 text-xs text-base-content/60"
                    >{formatFileSize(f.size) ?? ''}</span
                  >
                </div>
                {#if f.status === 'done' && f.url}
                  <a
                    href={f.url}
                    download={f.name}
                    class="btn w-fit btn-outline btn-sm"
                    data-testid="call-chat-file-download"
                  >
                    <DownloadIcon class_="h-4 w-4" title="" />
                    {m.groups_call_chat_file_download()}
                  </a>
                {:else if f.status === 'failed'}
                  <span class="text-xs text-error">{m.groups_call_chat_file_failed()}</span>
                {:else}
                  <progress
                    class="progress w-40 progress-primary"
                    value={Math.round(f.progress * 100)}
                    max="100"
                  ></progress>
                  <span class="text-xs text-base-content/60"
                    >{f.status === 'sending'
                      ? m.groups_call_chat_file_sending()
                      : m.groups_call_chat_file_receiving()}</span
                  >
                {/if}
              </div>
            {:else}
              <!-- Escaped text and plain anchors only: the text is whatever a
               participant (guests included) sent, never HTML. -->
              <span class="break-words whitespace-pre-wrap"
                >{#each body?.segments ?? [{ text: msg.text }] as seg, s (s)}{#if 'mention' in seg}<span
                      class="mx-px badge align-baseline badge-sm {seg.mention === myIdentity ||
                      seg.mention === EVERYONE
                        ? 'badge-primary'
                        : 'badge-ghost'}"
                      data-testid="call-chat-mention">{seg.label}</span
                    >{:else if 'emoji' in seg}<ImageWithFallback
                      src={seg.url}
                      alt=":{seg.emoji}:"
                      title=":{seg.emoji}:"
                      size="emoji"
                      fallbackType="generic"
                      class="inline h-5 w-5 align-text-bottom"
                    />{:else if 'href' in seg}{#if seg.internal}<a
                        href={seg.href}
                        class="link break-all link-primary"
                        data-testid="call-chat-link"
                        onclick={(e) => openAppLink(e, seg.href)}>{seg.label}</a
                      >{:else}<a
                        href={seg.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        class="link break-all link-primary"
                        data-testid="call-chat-link">{seg.label}</a
                      >{/if}{:else}{seg.text}{/if}{/each}</span
              >
              {#each body?.previews ?? [] as url (url)}
                <LinkPreview {url} />
              {/each}
            {/if}
          </div>
          {#if canSend}
            <!-- Hover/focus reveals it; on a touch screen (no hover) it stays
               visible and a long-press on the row does the same. -->
            <button
              type="button"
              class="btn btn-square shrink-0 opacity-0 btn-ghost btn-xs group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-60"
              aria-label={m.groups_call_chat_reply()}
              title={m.groups_call_chat_reply()}
              onclick={() => startReply(msg)}
              data-testid="call-chat-reply"
            >
              <ReplyIcon class="h-3.5 w-3.5" />
            </button>
          {/if}
        </div>
      {/if}
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
  {#if replyTarget}
    <div
      class="flex items-center gap-2 border-t border-base-300 bg-base-200 px-3 py-1 text-xs"
      data-testid="call-chat-reply-strip"
    >
      <ReplyIcon class="h-3.5 w-3.5 shrink-0 text-base-content/60" />
      <span class="shrink-0 font-medium text-base-content/70"
        >{m.groups_call_chat_replying_to({ name: nameOf(replyTarget.identity) })}</span
      >
      <span class="min-w-0 flex-1 truncate text-base-content/80">{firstLine(replyTarget.text)}</span
      >
      <button
        type="button"
        class="btn btn-square btn-ghost btn-xs"
        aria-label={m.groups_call_chat_reply_cancel()}
        title={m.groups_call_chat_reply_cancel()}
        onclick={cancelReply}
      >
        ✕
      </button>
    </div>
  {/if}
  <!-- Two rows (smoke test 2026-10-08): the text field owns the whole width
       and grows to a few lines, Senden sits at its end; attach, emoji and the
       recipient live in a toolbar below it. One row squeezed the input to
       ~90px beside the call stage and on a phone. -->
  <form
    class="relative flex flex-col gap-1 p-2 {lk.isConnected && !replyTarget
      ? 'border-t border-base-300'
      : ''}"
    onsubmit={(e) => {
      e.preventDefault();
      send();
    }}
  >
    {#if pickerOpen}
      <div
        class="absolute bottom-full left-2 z-30 mb-1 rounded-box shadow-lg"
        data-testid="call-chat-emoji-picker"
      >
        {#if EmojiPickerLazy.Component}
          <EmojiPickerLazy.Component onPick={pickEmoji} {customEmojiSets} />
        {:else}
          <div class="flex h-80 w-72 items-center justify-center rounded-box bg-base-100">
            <span class="loading loading-md loading-spinner"></span>
          </div>
        {/if}
      </div>
    {/if}
    <!-- A private recipient tints the field like a private message row, so
         the state is obvious while typing. -->
    <div
      class="flex items-end gap-1 rounded-box border py-1 pr-1 pl-3 transition-colors {recipient
        ? 'border-secondary bg-secondary/5 focus-within:border-secondary'
        : 'border-base-300 bg-base-100 focus-within:border-base-content/40'} {canSend
        ? ''
        : 'opacity-60'}"
      data-testid="call-chat-input-row"
      data-private={recipient ? 'true' : undefined}
    >
      <ComposerInput
        bind:this={composer}
        bind:value={draft}
        {customEmojiSets}
        multiline
        placeholder={recipient
          ? m.groups_call_chat_placeholder_private({ name: recipientName })
          : m.groups_call_chat_placeholder()}
        disabled={!canSend}
        onfocus={() => (pickerOpen = false)}
        onSubmit={send}
        onEscape={onComposerEscape}
        mentionProvider={provideMentions}
        onMentionPick={rememberMention}
        class="min-h-[1.75rem] py-1 text-sm leading-snug"
        ariaDescribedby={lk.isConnected ? undefined : offlineHintId}
        testid="call-chat-input"
      />
      <button
        type="submit"
        class="btn btn-square shrink-0 btn-sm btn-primary"
        aria-label={m.groups_call_chat_send()}
        title={m.groups_call_chat_send()}
        disabled={!canSend}
        data-testid="call-chat-send"
      >
        <SendIcon class="h-4 w-4" />
      </button>
    </div>
    <div class="flex min-w-0 items-center gap-1" data-testid="call-chat-toolbar">
      {#if canSend}
        <input
          bind:this={fileInput}
          type="file"
          class="hidden"
          onchange={attach}
          data-testid="call-chat-attach-input"
        />
        <button
          type="button"
          class="btn btn-square btn-ghost btn-sm"
          aria-label={m.chat_attach_file()}
          title="{m.chat_attach_file()} – {m.groups_call_chat_file_hint()}"
          onclick={() => fileInput?.click()}
          data-testid="call-chat-attach"
        >
          📎
        </button>
      {/if}
      <button
        type="button"
        class="btn btn-square btn-ghost btn-sm"
        aria-label={m.groups_call_chat_emoji_button()}
        title={m.groups_call_chat_emoji_button()}
        aria-expanded={pickerOpen}
        disabled={!canSend}
        onclick={() => (pickerOpen = !pickerOpen)}
        data-testid="call-chat-emoji-toggle"
      >
        <SmilePlusIcon class="h-5 w-5" />
      </button>
      <!-- Recipient: a ghost button as wide as its text ("An: Alle" / lock +
           "An: Bea"); the real <select> sits invisibly on top of it so the
           native menu, keyboard and screen reader all keep working. -->
      <span
        class="btn relative min-w-0 gap-1 px-2 font-normal btn-ghost btn-sm focus-within:ring-2 focus-within:ring-primary/40 {recipient
          ? 'text-secondary'
          : ''} {canSend ? '' : 'btn-disabled'}"
        data-testid="call-chat-recipient-control"
        data-private={recipient ? 'true' : undefined}
      >
        {#if recipient}
          <LockIcon class_="h-3.5 w-3.5 shrink-0" title="" />
        {/if}
        <span class="min-w-0 truncate" aria-hidden="true"
          >{recipient
            ? m.groups_call_chat_to_name({ name: recipientName })
            : m.groups_call_chat_to_everyone()}</span
        >
        <span class="shrink-0 text-xs opacity-60" aria-hidden="true">▾</span>
        <select
          class="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          aria-label={m.groups_call_chat_recipient()}
          bind:value={recipient}
          disabled={!canSend}
          data-testid="call-chat-recipient"
        >
          <option value="">{m.groups_call_chat_to_everyone()}</option>
          {#each others as p (p.identity)}
            <option value={p.identity}>{p.name}</option>
          {/each}
        </select>
      </span>
    </div>
  </form>
  {#if pickerOpen}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="fixed inset-0 z-20"
      onclick={() => (pickerOpen = false)}
      onkeydown={(e) => {
        if (e.key === 'Escape') pickerOpen = false;
      }}
    ></div>
  {/if}
</div>
