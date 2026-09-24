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

  /** @type {{candidates: Array<{pubkey: string, name: string, profile: any}>, highlightIndex: number, onSelect: (pubkey: string) => void}} */
  let { candidates = [], highlightIndex = 0, onSelect } = $props();
</script>

{#if candidates.length > 0}
  <ul
    role="listbox"
    aria-label={m.mention_suggestions_label()}
    class="absolute bottom-full left-0 z-40 mb-1 max-h-60 w-full max-w-[calc(100vw-2rem)] min-w-64 overflow-y-auto rounded-box border border-base-300 bg-base-100 p-1 shadow-lg"
    data-testid="mention-suggestions"
  >
    {#each candidates as candidate, i (candidate.pubkey)}
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
        <ProfileAvatar pubkey={candidate.pubkey} profile={candidate.profile} size="xs" />
        <span class="min-w-0 flex-1 truncate">{candidate.name}</span>
      </li>
    {/each}
  </ul>
{/if}
