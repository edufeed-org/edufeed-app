<!--
  CallChatPanel — the call's own chat (LiveKit data, livekit-connection's
  CHAT_TOPIC). Everyone in the call sees it, guests included; it is gone
  when the call ends. The channel chat stays members-only.
-->
<script>
  import { tick, untrack } from 'svelte';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { getLiveKitState, sendCallChat } from '$lib/services/livekit-connection.svelte.js';
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
  import { trackOnScreen } from '$lib/groups/track-on-screen.js';
  import { customEmojisIn } from '$lib/helpers/emoji-autocomplete.js';
  import { useUserEmojiSets } from '$lib/stores/user-emoji-sets.svelte.js';
  import { lazyComponent } from '$lib/helpers/lazy-component.svelte.js';
  import { DownloadIcon, SmilePlusIcon } from '$lib/components/icons';
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
  // nor the emoji dataset enter this panel's static graph.
  const EmojiPickerLazy = lazyComponent(() => import('./CallEmojiPicker.svelte'));
  let pickerOpen = $state(false);

  /** @param {string | { shortcode: string, url: string }} emoji */
  function pickEmoji(emoji) {
    if (typeof emoji !== 'string') pickedUrls = { ...pickedUrls, [emoji.shortcode]: emoji.url };
    composer?.insert(emoji);
    pickerOpen = false;
  }

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

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  // One parse per message, not per render: messages never change once kept.
  const parsed = $derived(
    new Map(
      lk.callChat.map((c) => {
        const segments = withCustomEmojis(linkifyCallChat(c.text, origin), c.emoji);
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
        text: c.text
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
    await sendCallChat(text, { emoji });
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
  </div>
  <div bind:this={listEl} class="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3">
    {#if lk.callChat.length === 0}
      <p class="m-auto cursor-default text-center text-sm text-base-content/60 select-none">
        {m.groups_call_chat_empty()}
      </p>
    {/if}
    {#each lk.callChat as msg, i (msg.id)}
      {@const pk = identityToPubkey(msg.identity)}
      {@const body = parsed.get(msg.id)}
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
        <div class="flex min-w-0 flex-1 flex-col gap-1">
          <!-- Escaped text and plain anchors only: the text is whatever a
               participant (guests included) sent, never HTML. -->
          <span class="break-words whitespace-pre-wrap"
            >{#each body?.segments ?? [{ text: msg.text }] as seg, s (s)}{#if 'emoji' in seg}<ImageWithFallback
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
        </div>
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
    class="relative flex items-center gap-1 p-2 {lk.isConnected ? 'border-t border-base-300' : ''}"
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
          <EmojiPickerLazy.Component onPick={pickEmoji} />
        {:else}
          <div class="flex h-80 w-72 items-center justify-center rounded-box bg-base-100">
            <span class="loading loading-md loading-spinner"></span>
          </div>
        {/if}
      </div>
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
    <ComposerInput
      bind:this={composer}
      bind:value={draft}
      {customEmojiSets}
      placeholder={m.groups_call_chat_placeholder()}
      disabled={!canSend}
      onfocus={() => (pickerOpen = false)}
      onSubmit={send}
      class="input-bordered input input-sm flex items-center"
      ariaDescribedby={lk.isConnected ? undefined : offlineHintId}
      testid="call-chat-input"
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
