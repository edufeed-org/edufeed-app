<!--
  ReactionChips — presentational reaction row shared by ReactionBar.svelte
  (kind 7, event-rooted), UrlReactionBar.svelte (kind 17, URL-rooted), and
  ChannelChat.svelte (concord kind-7 rumors, private channels). Takes an
  already-aggregated `Map<emoji, summary>` and two callbacks — it has no idea
  where reactions come from or how they're published; every caller supplies
  its own onToggle/onPick that know how to react/delete/publish for their
  own event source (EventStore + NIP-25 for the public bars, community.react()
  for concord).
-->
<script>
  import ReactionButton from './ReactionButton.svelte';
  import AddReactionButton from './AddReactionButton.svelte';

  /**
   * @typedef {Object} ReactionSummary
   * @property {number} count
   * @property {boolean} userReacted
   * @property {any} userReactionEvent
   * @property {string|null} emojiUrl
   * @property {string[]} reactors
   */

  /**
   * @type {{
   *   aggregated: Map<string, ReactionSummary>,
   *   addButtonOnHover?: boolean,
   *   onToggle: (emoji: string, summary: ReactionSummary) => void,
   *   onPick: (emoji: string | { shortcode: string, url: string }) => void
   * }}
   */
  let { aggregated, addButtonOnHover = false, onToggle, onPick } = $props();

  // Keeps the hover-gated add button revealed while its picker is open — the
  // picker renders as a `position: fixed` modal but is still a DOM
  // descendant of the wrapper below, and CSS `opacity` composites an
  // element's ENTIRE rendering subtree (fixed descendants included), so the
  // wrapper must be fully opaque whenever the picker is showing or the modal
  // itself would render faded.
  let pickerOpen = $state(false);
</script>

{#each Array.from(aggregated.entries()) as [emoji, summary] (emoji)}
  <ReactionButton
    {emoji}
    count={summary.count}
    userReacted={summary.userReacted}
    userReactionEvent={summary.userReactionEvent}
    emojiUrl={summary.emojiUrl}
    reactors={summary.reactors}
    onToggle={() => onToggle(emoji, summary)}
  />
{/each}

{#if addButtonOnHover}
  <!--
    Reveal via opacity (NOT display:none/hidden) so this element ALWAYS
    reserves its box. A display swap changes the footer's rendered size from
    0x0 (no reactions yet) to its real size the instant a message is
    hovered — in a scrollable chat list that shift pushes every row below it
    down, which can move the very row the pointer is over out from under the
    cursor, un-hovering it, reverting the shift, and re-hovering it again: a
    visible flicker loop. Mirrors ChatMessageRow's reply button, which
    already reserves space via opacity for exactly this reason.
  -->
  <span
    class="opacity-0 transition-opacity group-focus-within:opacity-70 group-hover:opacity-70 hover:!opacity-100 {pickerOpen
      ? '!opacity-100'
      : ''}"
    data-testid="add-reaction-wrapper"
  >
    <AddReactionButton {onPick} onOpenChange={(open) => (pickerOpen = open)} />
  </span>
{:else}
  <AddReactionButton {onPick} />
{/if}
