<!--
  MentionAutocomplete — presentational @-mention dropdown shared by
  ComposerInput and the Concord channel composer. The host owns detection
  (detectMentionQuery) and keyboard handling; this only renders candidates
  and reports a pick. mousedown (not click) so selection wins the race
  against the editor losing focus — same as EmojiAutocomplete. Anchored
  above the host by a `relative` wrapper, full width.
-->
<script>
  import ProfileAvatar from '$lib/components/shared/ProfileAvatar.svelte';
  import * as m from '$lib/paraglide/messages';

  /**
   * `anchored`: the host positions a wrapper at the caret; the list then
   * fills that wrapper instead of hanging above the field.
   * `avatarPubkey` (optional): the pubkey to draw the avatar from when `pubkey`
   * is only a list key (a host-supplied candidate such as "everyone" has
   * none and gets an @ glyph instead).
   * @type {{candidates: Array<{pubkey: string, name: string, profile: any, avatarPubkey?: string | null}>, highlightIndex: number, onSelect: (pubkey: string) => void, anchored?: boolean}}
   */
  let { candidates = [], highlightIndex = 0, onSelect, anchored = false } = $props();

  /** @param {{pubkey: string, avatarPubkey?: string | null}} c */
  function avatarOf(c) {
    const pk = c.avatarPubkey === undefined ? c.pubkey : c.avatarPubkey;
    return pk && /^[0-9a-f]{64}$/i.test(pk) ? pk : null;
  }
</script>

{#if candidates.length > 0}
  <ul
    role="listbox"
    aria-label={m.mention_suggestions_label()}
    class="z-40 max-h-60 overflow-y-auto rounded-box border border-base-300 bg-base-100 p-1 shadow-lg {anchored
      ? 'relative w-full'
      : 'absolute bottom-full left-0 mb-1 w-full max-w-[calc(100vw-2rem)] min-w-64'}"
    data-testid="mention-suggestions"
  >
    {#each candidates as candidate, i (candidate.pubkey)}
      {@const avatarPubkey = avatarOf(candidate)}
      <li
        role="option"
        aria-selected={i === highlightIndex}
        class="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm {i ===
        highlightIndex
          ? 'bg-primary/10 text-primary'
          : 'hover:bg-base-300/60'}"
        onmousedown={(e) => {
          e.preventDefault();
          onSelect(candidate.pubkey);
        }}
      >
        {#if avatarPubkey}
          <ProfileAvatar pubkey={avatarPubkey} profile={candidate.profile} size="xs" />
        {:else}
          <span
            class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-base-300 text-xs font-semibold"
            aria-hidden="true">@</span
          >
        {/if}
        <span class="min-w-0 flex-1 truncate">{candidate.name}</span>
      </li>
    {/each}
  </ul>
{/if}
