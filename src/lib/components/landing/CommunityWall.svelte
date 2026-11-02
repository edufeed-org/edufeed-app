<script>
  // Community avatar wall for the landing (design 5b), replacing the dots
  // carousel: faces read as "people are here" faster than cards behind
  // pagination. A grid on wider screens, a swipe row on phones, and a
  // "start your own" tile at the end.
  import { resolve } from '$app/paths';
  import * as m from '$lib/paraglide/messages';
  import { modalStore } from '$lib/stores/modal.svelte.js';
  import ImageWithFallback from '$lib/components/shared/ImageWithFallback.svelte';
  import { hexToNpub } from '$lib/helpers/nostrUtils.js';
  import { ChevronRightIcon, PlusIcon } from '$lib/components/icons';

  /**
   * @type {{
   *   communities: { pubkey: string, name: string, about?: string, picture?: string }[],
   *   loaded: boolean
   * }}
   */
  let { communities, loaded } = $props();

  // The heading's last word rotates (colleagues → friends → …): playful, but
  // screen readers get the one static title, and reduced motion stands still.
  // Static message calls, never m[key] (see message-lookup.js).
  const words = [
    m.landing_wall_word_1(),
    m.landing_wall_word_2(),
    m.landing_wall_word_3(),
    m.landing_wall_word_4()
  ];
  const ROTATE_MS = 2800;
  let wordIndex = $state(0);
  /** The word that just left: it slides out upwards, the next comes from below. */
  let leavingIndex = $state(-1);

  $effect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const timer = setInterval(() => {
      leavingIndex = wordIndex;
      wordIndex = (wordIndex + 1) % words.length;
    }, ROTATE_MS);
    return () => clearInterval(timer);
  });

  const tile =
    'flex w-24 shrink-0 snap-start flex-col items-center gap-2 text-center text-sm leading-tight font-semibold md:w-28';
</script>

{#if communities.length > 0 || !loaded}
  <section data-testid="landing-wall" class="container mx-auto px-4 pt-2 pb-12">
    <div class="mb-5 flex items-baseline justify-between gap-4">
      <h2 class="text-2xl font-bold text-balance">
        <span class="sr-only">{m.landing_wall_title()}</span>
        <span aria-hidden="true">
          {m.landing_wall_title_before()}
          <!-- all words share one grid cell, so the heading keeps the width
               of the longest and nothing below it jumps -->
          <span class="rotating inline-grid text-primary">
            {#each words as word, i (i)}
              <span
                data-active={i === wordIndex}
                class:active={i === wordIndex}
                class:leaving={i === leavingIndex}>{word}</span
              >
            {/each}
          </span>
        </span>
      </h2>
      <a
        data-testid="landing-wall-all"
        href={resolve('/discover?type=communities')}
        class="btn -me-3 shrink-0 text-sm text-primary btn-ghost btn-sm"
      >
        {m.landing_wall_all()}
        <ChevronRightIcon class_="h-4 w-4" />
      </a>
    </div>

    <div
      class="-mr-4 flex snap-x gap-4 overflow-x-auto pr-4 pb-2 md:mr-0 md:flex-wrap md:gap-5 md:overflow-visible md:pr-0"
    >
      {#if communities.length === 0}
        {#each [0, 1, 2, 3, 4, 5] as i (i)}
          <div class="size-16 shrink-0 skeleton rounded-full md:size-[4.5rem]"></div>
        {/each}
      {:else}
        {#each communities as community (community.pubkey)}
          <a
            data-testid="landing-wall-item"
            href={resolve(`/c/${hexToNpub(community.pubkey) || community.pubkey}`)}
            class={tile}
          >
            <span
              class="size-16 shrink-0 overflow-hidden rounded-full bg-base-300 md:size-[4.5rem]"
            >
              <ImageWithFallback
                src={community.picture || ''}
                alt=""
                fallbackType="community"
                class="h-full w-full object-cover"
              />
            </span>
            <span class="line-clamp-2 w-full break-words">{community.name}</span>
          </a>
        {/each}
        <button
          type="button"
          data-testid="landing-wall-create"
          class={tile}
          onclick={() => modalStore.openModal('signup')}
        >
          <span
            class="grid size-16 place-items-center rounded-full border-2 border-dashed border-base-300 md:size-[4.5rem]"
          >
            <PlusIcon class_="h-6 w-6" />
          </span>
          <span>
            {m.landing_wall_create()}
            <span class="block font-normal text-base-content/70">{m.landing_wall_create_sub()}</span
            >
          </span>
        </button>
      {/if}
    </div>
  </section>
{/if}

<style>
  /* clipped like a slot machine; the padding keeps descenders visible */
  .rotating {
    overflow: hidden;
    padding-bottom: 0.12em;
    margin-bottom: -0.12em;
  }
  .rotating > span {
    grid-area: 1 / 1;
    opacity: 0;
    transform: translateY(100%);
    transition:
      opacity 0.4s ease,
      transform 0.4s ease;
  }
  .rotating > span.leaving {
    transform: translateY(-100%);
  }
  .rotating > span.active {
    opacity: 1;
    transform: none;
  }
  @media (prefers-reduced-motion: reduce) {
    .rotating > span {
      transition: none;
    }
  }
</style>
