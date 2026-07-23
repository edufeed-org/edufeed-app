<script>
  // Imports directly from the concord submodule (not the barrel) — same
  // convention as PrivateChannelsView.svelte: bridge.svelte.js has no
  // top-level package imports, so this stays SSR-clean even though the
  // c/[pubkey] community route disables SSR anyway (see c/+layout.js).
  import { useObservable } from '$lib/concord/bridge.svelte.js';
  import { useProfileMap } from '$lib/stores/profile-map.svelte.js';
  import { useActiveUser } from '$lib/stores/accounts.svelte';
  import {
    formatMessageTimestamp,
    getUserDisplayName,
    groupMessagesByDate
  } from '$lib/helpers/message-utils.js';
  import ProfileAvatar from '$lib/components/shared/ProfileAvatar.svelte';
  import NostrContentRenderer from '$lib/components/shared/NostrContentRenderer.svelte';
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

  let text = $state('');
  let sending = $state(false);
  let menuOpen = $state(false);
  /** @type {HTMLElement|undefined} */
  let scrollContainer;

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
      await community.sendMessage(channel.channel_id, body);
      text = '';
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
</script>

<header class="flex shrink-0 items-center gap-3 border-b border-base-300 bg-base-100 px-4 py-3">
  <button class="btn btn-circle btn-ghost btn-sm md:hidden" onclick={onBack}>←</button>
  <div class="min-w-0 flex-1">
    <h2 class="flex items-center gap-2 font-extrabold">
      🔒 {channel.name} <span class="badge badge-xs font-bold uppercase badge-accent">Beta</span>
    </h2>
    <p class="truncate text-xs text-base-content/60">
      {m.concord_chat_subtitle()}
      <button class="link" onclick={() => openOverlay('explainer')}
        >{m.concord_how_it_works()}</button
      >
    </p>
  </div>
  <button class="btn btn-ghost btn-sm" onclick={() => openOverlay('members')}>
    👥 {getMembers().size}
  </button>
  <div class="dropdown dropdown-end">
    <button class="btn btn-circle btn-ghost btn-sm" onclick={() => (menuOpen = !menuOpen)}>⋯</button
    >
    {#if menuOpen}
      <ul
        class="dropdown-content menu z-30 w-60 rounded-box border border-base-300 bg-base-100 p-1 shadow-lg"
      >
        {#if !dissolved}
          <li>
            <button
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
{/if}

<div class="flex flex-1 flex-col gap-3 overflow-y-auto p-4" bind:this={scrollContainer}>
  <div class="mx-auto max-w-md py-3 text-center text-sm text-base-content/60">
    <div class="text-lg">🔒</div>
    <b>{m.concord_genesis_title({ name: channel.name })}</b>
    <p class="mt-1 text-xs">{m.concord_genesis_body()}</p>
  </div>
  {#each grouped as item, i (item.type === 'separator' ? `sep-${item.date}-${i}` : item.message.id)}
    {#if item.type === 'separator'}
      <div class="divider text-xs text-base-content/50">{item.date}</div>
    {:else}
      {@const message = item.message}
      {@const mine = message.pubkey === getActiveUser()?.pubkey}
      <div class="chat {mine ? 'chat-end' : 'chat-start'}">
        {#if !mine}
          <div class="chat-image">
            <ProfileAvatar
              pubkey={message.pubkey}
              profile={getProfiles().get(message.pubkey)}
              size="sm"
            />
          </div>
          <div class="chat-header text-xs font-bold">
            {getUserDisplayName(message.pubkey, getProfiles().get(message.pubkey))}
            <time class="ml-1 font-normal opacity-50"
              >{formatMessageTimestamp(message.created_at)}</time
            >
          </div>
        {/if}
        <div class="chat-bubble {mine ? 'chat-bubble-primary' : ''}">
          <NostrContentRenderer event={message} />
        </div>
      </div>
    {/if}
  {/each}
</div>

{#if dissolved}
  <div
    class="m-4 shrink-0 rounded-full bg-base-200 p-3 text-center text-sm font-semibold text-base-content/60"
  >
    🔒 {m.concord_read_only()}
  </div>
{:else}
  <form
    class="m-4 mt-0 flex shrink-0 items-center gap-2 rounded-full border border-base-300 bg-base-100 p-1.5"
    onsubmit={(e) => {
      e.preventDefault();
      send();
    }}
  >
    <input
      class="input flex-1 input-ghost focus:outline-none"
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
