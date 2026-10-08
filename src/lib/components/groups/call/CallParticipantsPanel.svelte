<!--
  CallParticipantsPanel — the "Teilnehmende (N)" list inside a call: one
  row per participant (avatar, name, mic / camera state, raised hand,
  guest and listen-only badges) with a row menu carrying the per-person
  actions that otherwise hide behind a tile hover (pin, local volume).

  A pure list: the stage owns the rows (their order, state and callbacks)
  and decides where the panel sits (beside the tiles on a wide stage, in
  their place on a phone). `menuExtras` is the slot for future host
  actions (mute, remove): the host renders them into every row's menu,
  this panel knows nothing about roles.
-->
<script>
  import { CloseIcon } from '$lib/components/icons';
  import CallParticipantRow from './CallParticipantRow.svelte';
  import * as m from '$lib/paraglide/messages';

  /** @typedef {import('$lib/groups/call-participants.js').ParticipantRow} ParticipantRow */
  /**
   * @type {{
   *   rows: ParticipantRow[],
   *   onTogglePin: (key: string) => void,
   *   onVolumeChange: (pubkey: string, volume: number) => void,
   *   onClose: () => void,
   *   menuExtras?: import('svelte').Snippet<[ParticipantRow]>,
   *   headerExtras?: import('svelte').Snippet
   * }}
   * `headerExtras`: the stage's buttons in the panel header (breakout rooms).
   */
  let {
    rows,
    onTogglePin,
    onVolumeChange,
    onClose,
    menuExtras = undefined,
    headerExtras = undefined
  } = $props();

  /** @type {HTMLDivElement | undefined} */
  let rootEl = $state(undefined);
  // One row menu open at a time; a click outside (in the document the
  // panel is rendered in — the pop-out window has its own) or Escape closes it.
  /** @type {string | null} */
  let openKey = $state(null);
  /** @param {string} key */
  function toggleMenu(key) {
    openKey = openKey === key ? null : key;
  }
  $effect(() => {
    const win = rootEl?.ownerDocument.defaultView;
    if (!win) return;
    /** @param {PointerEvent} event */
    const onPointerDown = (event) => {
      const target = /** @type {Element | null} */ (event.target);
      if (!target?.closest?.('[data-participant-menu]')) openKey = null;
    };
    /** @param {KeyboardEvent} event */
    const onKeyDown = (event) => {
      if (event.key === 'Escape') openKey = null;
    };
    win.addEventListener('pointerdown', onPointerDown);
    win.addEventListener('keydown', onKeyDown);
    return () => {
      win.removeEventListener('pointerdown', onPointerDown);
      win.removeEventListener('keydown', onKeyDown);
    };
  });
</script>

<div bind:this={rootEl} class="flex min-h-0 flex-1 flex-col" data-testid="call-participants-panel">
  <div class="flex shrink-0 items-center gap-2 border-b border-base-300 px-3 py-2">
    <h3 class="min-w-0 flex-1 truncate text-sm font-semibold">
      {m.groups_call_participants_count({ count: rows.length })}
    </h3>
    {@render headerExtras?.()}
    <button
      type="button"
      class="btn btn-square btn-ghost btn-sm"
      onclick={onClose}
      aria-label={m.groups_call_participants_close()}
      title={m.groups_call_participants_close()}
      data-testid="call-participants-close"
    >
      <CloseIcon class_="h-4 w-4" title="" />
    </button>
  </div>
  <ul class="min-h-0 flex-1 overflow-y-auto p-1">
    {#each rows as row (row.key)}
      <CallParticipantRow
        {row}
        menuOpen={openKey === row.key}
        onToggleMenu={() => toggleMenu(row.key)}
        onTogglePin={() => onTogglePin(row.key)}
        onVolumeChange={row.isLocal || !row.pubkey
          ? undefined
          : (/** @type {number} */ v) => onVolumeChange(/** @type {string} */ (row.pubkey), v)}
        {menuExtras}
      />
    {/each}
  </ul>
</div>
