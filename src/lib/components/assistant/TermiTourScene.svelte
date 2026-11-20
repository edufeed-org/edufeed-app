<!--
  The moving picture beside each step of Termi's "what's new" tour: an example, built from the
  window's own look (no screenshots to go stale). Its parts appear one after another, once.
-->
<script>
  import * as m from '$lib/paraglide/messages';
  import { getLocale } from '$lib/paraglide/runtime';
  import { PHASE_LABELS } from '$lib/termi/lesson-state.js';
  import TermiAvatar from './TermiAvatar.svelte';
  import { searchContent } from './termi-router.js';
  import { keepItem } from './cards/filter.js';
  import { linkFor } from './cards/links.js';

  /** @type {{ id: string, onClose?: () => void }} */
  let { id, onClose } = $props();

  // Step 1 is real: the example question goes through the open content search, and the hits
  // link to their pages. No answer (or none found) leaves the question standing alone.
  let hits = $state.raw(
    /** @type {import('$lib/termi/items.d.js').Item[] | undefined} */ (undefined)
  );
  $effect(() => {
    if (id !== 'material') return;
    let live = true;
    searchContent(m.tour_scene_search_q(), {
      locale: getLocale() === 'en' ? 'en' : 'de',
      fetch: (...a) => fetch(...a)
    }).then(({ items }) => {
      if (live)
        hits = items
          .filter((it) => it.type === 'resource' && keepItem(it) && linkFor(it))
          .slice(0, 3);
    });
    return () => {
      live = false;
    };
  });
  // sample dates in the app's DD.MM.YYYY
  const events = () => [
    [m.tour_scene_ev1(), '12.01.2027'],
    [m.tour_scene_ev2(), '08.02.2027'],
    [m.tour_scene_ev3(), '20.03.2027'],
    [m.tour_scene_ev4(), '14.04.2027']
  ];
  const phases = () => (getLocale() === 'en' ? PHASE_LABELS.en : PHASE_LABELS.de).slice(0, 5);
  const CURRENT_PHASE = 3;
</script>

<div
  class="seq flex flex-col gap-2.5 text-[13px]"
  aria-hidden={id === 'material' ? undefined : 'true'}
  data-testid="tour-scene-{id}"
>
  <div
    class="flex items-center gap-2.5 text-[10px] font-semibold tracking-wide text-base-content/60 uppercase"
  >
    <TermiAvatar size={48} />
    {id === 'material' ? m.tour_scene_live() : m.tour_scene_example()}
  </div>
  {#if id === 'material'}
    <div style="--i:0" class="flex justify-end">
      <div class="rounded-2xl rounded-br-md bg-primary px-3 py-2 text-primary-content">
        {m.tour_scene_search_q()}
      </div>
    </div>
    {#if hits === undefined}
      <div style="--i:2" class="ml-10 flex flex-col gap-2" data-testid="tour-scene-loading">
        {#each [0, 1, 2] as i (i)}
          <div class="h-11 animate-pulse rounded-xl bg-base-300/60"></div>
        {/each}
      </div>
    {:else if hits.length}
      <div class="flex items-end gap-2.5">
        <TermiAvatar />
        <div class="rounded-2xl rounded-bl-md border border-base-300 bg-base-100 px-3 py-2">
          {m.tour_scene_search_a()}
        </div>
      </div>
      {#each hits as item, i (item.id ?? i)}
        {@const link = linkFor(item)}
        {#if link}
          <a
            style="--i:{i}"
            href={link.href}
            target={link.target}
            rel={link.rel}
            data-testid="tour-scene-hit"
            class="ml-10 block rounded-xl border border-base-300 bg-base-100 px-2.5 py-2 leading-snug hover:border-primary"
            onclick={() => !link.target && onClose?.()}
          >
            <span class="line-clamp-1 font-semibold">{item.title}</span>
            <span class="line-clamp-1 text-xs text-base-content/70">
              {[item.subtitle, item.license, item.publisher].filter(Boolean).join(' · ')}
            </span>
          </a>
        {/if}
      {/each}
    {/if}
  {:else if id === 'lesson'}
    <div class="grid grid-cols-[9.5rem_minmax(0,1fr)] items-center gap-3.5">
      <div class="seq flex flex-col gap-1 text-xs">
        {#each phases() as label, i (i)}
          <div
            style="--i:{i}"
            class="flex items-center gap-2 rounded-lg px-2 py-1 {i === CURRENT_PHASE
              ? 'border border-base-300 bg-base-100 font-semibold'
              : i < CURRENT_PHASE
                ? ''
                : 'text-base-content/60'}"
          >
            <span
              class="grid h-4 w-4 shrink-0 place-items-center rounded-full border text-[10px] {i <
              CURRENT_PHASE
                ? 'border-primary bg-primary text-primary-content'
                : 'border-base-300'}">{i < CURRENT_PHASE ? '✓' : ''}</span
            >
            {label}
          </div>
        {/each}
      </div>
      <div class="seq rounded-xl border border-base-300 bg-base-100 px-3.5 py-3">
        <div style="--i:3" class="font-semibold">{m.tour_scene_lesson_title()}</div>
        <div style="--i:3" class="text-[10px] tracking-wide text-base-content/60 uppercase">
          {m.tour_scene_lesson_meta()}
        </div>
        {#each [92, 78, 85, 60, 88, 40] as width, i (i)}
          <div
            style="--i:{i + 4};width:{width}%"
            class="my-1.5 h-1.5 rounded-full bg-base-300"
          ></div>
        {/each}
      </div>
    </div>
  {:else}
    <div
      style="--i:0"
      class="self-start rounded-xl border border-dashed border-base-content/50 bg-base-100 px-3 py-2 text-xs font-semibold"
    >
      {m.tour_scene_file()}
    </div>
    {#each events() as [title, date], i (i)}
      <div
        style="--i:{i + 2}"
        class="flex items-center gap-2 rounded-xl border border-base-300 bg-base-100 px-2.5 py-1.5 text-xs"
      >
        <span
          class="grid h-3.5 w-3.5 shrink-0 place-items-center rounded bg-primary text-[10px] text-primary-content"
          >✓</span
        >
        <span class="flex-1 font-semibold">{title}</span>
        <span class="text-base-content/70">{date}</span>
      </div>
    {/each}
  {/if}
</div>

<style>
  @media (prefers-reduced-motion: no-preference) {
    .seq > :global([style*='--i']) {
      animation: tour-show 0.45s both;
      animation-delay: calc(var(--i) * 0.45s + 0.2s);
    }
  }
  @keyframes tour-show {
    from {
      opacity: 0;
      transform: translateY(8px);
    }
  }
</style>
