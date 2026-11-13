<script>
  // Which model answers, under the composer: one quiet button (no mark while the chosen model is
  // ready), its menu (a bottom sheet on a phone), the outside group's one-time confirm and, while an
  // outside model is chosen, the notice line with the way back. Not rendered with nothing to choose.
  import * as m from '$lib/paraglide/messages';
  import { tick } from 'svelte';
  import { AlertIcon, CheckIcon, ChevronDownIcon, ClockIcon } from '$lib/components/icons';
  import BottomSheet from '$lib/components/shared/BottomSheet.svelte';
  import { lazyComponent } from '$lib/helpers/lazy-component.svelte.js';
  import {
    chosenModel,
    hasChoice,
    isOutside,
    modelLabel,
    namesOf,
    serviceLabel
  } from '$lib/termi/model-choice.js';

  /**
   * @type {{ conv: {
   *   models: import('$lib/termi/model-choice.js').ModelList | null,
   *   choice: string | null,
   *   outsideOk: boolean,
   *   setChoice: (id: string | null) => void,
   *   setOutsideOk: () => void,
   *   refreshModels: () => Promise<void>
   * } }}
   */
  let { conv } = $props();

  // static map: never index the Paraglide namespace by a runtime key
  const STATE = {
    ready: m.termi_model_state_ready,
    busy: m.termi_model_state_busy,
    down: m.termi_model_state_down
  };
  const outsideConfirm = lazyComponent(() => import('./OutsideConfirm.svelte'));

  const list = $derived(conv.models);
  const chosen = $derived(list ? chosenModel(conv.choice, list, conv.outsideOk) : '');
  const names = $derived(namesOf(list));
  const chosenState = $derived(list?.models.find((x) => x.id === chosen)?.state);
  const outside = $derived(isOutside(chosen));

  let open = $state(false);
  let sheet = $state(false);
  /** the outside id waiting for her confirm */
  let asking = $state(/** @type {string | null} */ (null));
  /** @type {HTMLButtonElement | undefined} */
  let buttonEl = $state();
  /** @type {HTMLElement | undefined} */
  let rootEl = $state();

  const items = () => [...(rootEl?.querySelectorAll('[role="menuitemradio"]') ?? [])];

  async function toggle() {
    if (open) return close();
    sheet = globalThis.matchMedia?.('(max-width: 767px)').matches ?? false;
    open = true;
    void conv.refreshModels();
    await tick();
    const all = /** @type {HTMLElement[]} */ (items());
    (all.find((el) => el.getAttribute('aria-checked') === 'true') ?? all[0])?.focus();
  }
  function close(focus = true) {
    open = false;
    if (focus) buttonEl?.focus();
  }
  /** @param {string} id */
  function pick(id) {
    close();
    if (isOutside(id) && !conv.outsideOk) asking = id;
    else conv.setChoice(id);
  }
  function confirmOutside() {
    // the confirm first: the controller sends an outside id only once it is set
    conv.setOutsideOk();
    conv.setChoice(asking);
    asking = null;
    buttonEl?.focus();
  }
  function cancelOutside() {
    asking = null;
    buttonEl?.focus();
  }

  /** @param {KeyboardEvent} e */
  function menuKeydown(e) {
    const all = /** @type {HTMLElement[]} */ (items());
    const at = all.indexOf(/** @type {HTMLElement} */ (document.activeElement));
    const go = (/** @type {number} */ i) => all[(i + all.length) % all.length]?.focus();
    if (e.key === 'ArrowDown') go(at + 1);
    else if (e.key === 'ArrowUp') go(at < 0 ? -1 : at - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(-1);
    else if (e.key === 'Escape') {
      // the window closes Termi on Escape: the menu closes first
      e.stopPropagation();
      close();
    } else if (e.key === 'Tab') close(false);
    else return;
    if (e.key !== 'Tab') e.preventDefault();
  }
  /** @param {PointerEvent} e */
  function outsideClick(e) {
    if (open && !sheet && !rootEl?.contains(/** @type {Node} */ (e.target))) close(false);
  }
</script>

<svelte:document onpointerdown={outsideClick} />

{#snippet status(/** @type {'ready'|'busy'|'down'} */ s)}
  <span class="flex shrink-0 items-center gap-1 text-xs text-base-content/70">
    {#if s === 'ready'}
      <CheckIcon class_="h-3.5 w-3.5 text-success" title="" />
    {:else if s === 'busy'}
      <ClockIcon class_="h-3.5 w-3.5 text-warning" title="" />
    {:else}
      <AlertIcon class_="h-3.5 w-3.5 text-error" title="" />
    {/if}
    {STATE[s]()}
  </span>
{/snippet}

{#snippet item(/** @type {import('$lib/termi/model-choice.js').ModelEntry} */ x)}
  <button
    type="button"
    role="menuitemradio"
    aria-checked={x.id === chosen}
    class="btn h-auto min-h-11 w-full flex-nowrap justify-start gap-2 text-left font-normal btn-ghost btn-sm md:min-h-9 {x.id ===
    chosen
      ? 'bg-base-200 font-semibold'
      : ''}"
    onclick={() => pick(x.id)}
  >
    <span class="w-3 shrink-0 text-center" aria-hidden="true">{x.id === chosen ? '●' : ''}</span>
    <span class="min-w-0 flex-1 truncate">{x.name}</span>
    {#if x.id === list?.default}
      <span class="badge badge-ghost badge-sm">{m.termi_model_default()}</span>
    {/if}
    {#if x.state}{@render status(x.state)}{/if}
  </button>
{/snippet}

{#snippet menu(/** @type {boolean} */ inSheet)}
  {#if list}
    <div
      role="menu"
      tabindex="-1"
      aria-label={m.termi_model_menu_title()}
      class="flex flex-col gap-1"
      onkeydown={menuKeydown}
    >
      <div class="px-2 pb-1">
        {#if !inSheet}<div class="text-sm font-semibold">{m.termi_model_menu_title()}</div>{/if}
        <div class="text-xs text-base-content/60">{m.termi_model_menu_sub()}</div>
      </div>
      {#each list.models as x (x.id)}{@render item(x)}{/each}
      <p class="px-2 pt-1 text-xs text-base-content/60">{m.termi_model_menu_footer()}</p>
      {#if list.external?.models?.length}
        {@const ext = list.external}
        <div class="mt-1 border-t border-base-300 px-2 pt-2 text-xs">
          <div class="font-semibold">{m.termi_outside_group_title()}</div>
          <div class="text-base-content/70">
            {m.termi_outside_group_body()}
            {#if ext.left !== undefined && ext.total !== undefined}
              {m.termi_outside_group_left({ left: ext.left, total: ext.total })}
            {/if}
          </div>
        </div>
        {#each ext.models as x (x.id)}{@render item(x)}{/each}
      {/if}
    </div>
  {/if}
{/snippet}

{#if list && hasChoice(list)}
  <div class="relative mt-2" bind:this={rootEl}>
    {#if outside}
      <div
        data-testid="termi-outside-notice"
        class="mb-1.5 flex flex-wrap items-center gap-2 rounded-lg bg-warning/15 px-2.5 py-1 text-xs"
      >
        <span class="min-w-0 flex-1">{m.termi_outside_notice()}</span>
        <button type="button" class="btn btn-ghost btn-sm" onclick={() => conv.setChoice(null)}
          >{m.termi_outside_back()}</button
        >
      </div>
    {/if}
    <button
      type="button"
      data-testid="termi-model-button"
      bind:this={buttonEl}
      aria-haspopup="menu"
      aria-expanded={open}
      class="btn max-w-full flex-nowrap font-normal btn-sm {outside
        ? 'btn-soft btn-warning'
        : 'text-base-content/70 btn-ghost'}"
      onclick={toggle}
    >
      <span class="truncate"
        >{m.termi_model_button({
          service: serviceLabel(chosen),
          model: modelLabel(chosen, names)
        })}</span
      >
      {#if chosenState === 'busy' || chosenState === 'down'}{@render status(chosenState)}{/if}
      <ChevronDownIcon class_="h-3.5 w-3.5 shrink-0" title="" />
    </button>
    {#if open && !sheet}
      <div
        class="absolute bottom-full left-0 z-20 mb-1 max-h-[min(26rem,60dvh)] w-80 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-box border border-base-300 bg-base-100 p-2 shadow-lg"
      >
        {@render menu(false)}
      </div>
    {/if}
    <BottomSheet
      open={open && sheet}
      title={m.termi_model_menu_title()}
      onClose={() => close()}
      testid="termi-model-sheet"
    >
      <div class="px-2 pb-3">{@render menu(true)}</div>
    </BottomSheet>
  </div>
{/if}
{#if asking}
  {@const Confirm = outsideConfirm.Component}
  {#if Confirm}
    <Confirm
      model={modelLabel(asking, names)}
      total={list?.external?.total}
      onCancel={cancelOutside}
      onConfirm={confirmOutside}
    />
  {/if}
{/if}
