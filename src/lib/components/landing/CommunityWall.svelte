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
  import { PlusIcon } from '$lib/components/icons';

  /**
   * @type {{
   *   communities: { pubkey: string, name: string, about?: string, picture?: string }[],
   *   loaded: boolean
   * }}
   */
  let { communities, loaded } = $props();

  const tile =
    'flex w-24 shrink-0 snap-start flex-col items-center gap-2 text-center text-sm leading-tight font-semibold md:w-28';
</script>

{#if communities.length > 0 || !loaded}
  <section data-testid="landing-wall" class="container mx-auto px-4 pt-2 pb-12">
    <div class="mb-5 flex items-baseline justify-between gap-4">
      <h2 class="text-2xl font-bold text-balance">{m.landing_wall_title()}</h2>
      <a
        data-testid="landing-wall-all"
        href={resolve('/discover?type=communities')}
        class="shrink-0 font-semibold text-primary"
      >
        {m.landing_wall_all()} →
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
