<script>
  // Landing hero, design 5b (Claude Design "Landing Round 3"): what Edufeed is
  // for in copy A, on the theme's hero colour, with a collage of live cards on
  // the right — real content instead of a stock photo. On phones the cards
  // become a swipeable row. Every card is optional; with none, the text takes
  // the full width.
  import { resolve } from '$app/paths';
  import * as m from '$lib/paraglide/messages';
  import { modalStore } from '$lib/stores/modal.svelte.js';
  import { runtimeConfig } from '$lib/stores/config.svelte.js';
  import ImageWithFallback from '$lib/components/shared/ImageWithFallback.svelte';
  import { helpLinkAttrs } from '$lib/helpers/help-link.js';
  import { encodeEventToNaddr, hexToNpub } from '$lib/helpers/nostrUtils.js';
  import { getUpcomingDateParts } from '$lib/helpers/dates.js';
  import { getTagValue } from 'applesauce-core/helpers';
  import { LocationIcon } from '$lib/components/icons';

  /** @typedef {{ pubkey: string, name: string, about?: string, picture?: string }} LandingCommunity */
  /** @type {{ heroMaterial?: any, nextEvent?: any, article?: any, community?: LandingCommunity | null, pending?: boolean }} */
  let {
    heroMaterial = null,
    nextEvent = null,
    article = null,
    community = null,
    // Content still loading: keep the card column (with placeholders) so the
    // headline does not jump from full to half width when the first card lands.
    pending = false
  } = $props();

  const helpLink = $derived(helpLinkAttrs(runtimeConfig.help?.url));
  const hasCards = $derived(Boolean(heroMaterial || nextEvent || article || community));
  const eventDate = $derived(
    nextEvent ? getUpcomingDateParts(nextEvent.start, nextEvent.kind) : null
  );

  /** @param {any} event */
  const detailHref = (event) => resolve(`/${encodeEventToNaddr(event)}`);

  // Desktop: loose, slightly rotated stack. Phones: a plain swipe row —
  // deliberately without scroll-snap: cards arrive one by one, and snap keeps
  // the first-loaded card in view, scrolling the row away from its start.
  const card =
    'block shrink-0 basis-[84%] overflow-hidden rounded-2xl bg-base-100 text-base-content shadow-xl transition-transform hover:-translate-y-0.5 lg:absolute lg:basis-auto';
</script>

<section
  data-testid="landing-hero"
  class="shrink-0 text-primary-content"
  style="background: var(--c-hero-2)"
>
  <div
    data-testid="landing-hero-grid"
    class="container mx-auto grid gap-10 px-4 py-12 lg:items-center lg:py-16 {hasCards || pending
      ? 'lg:grid-cols-2'
      : ''}"
  >
    <div class="flex max-w-2xl flex-col gap-5">
      <span
        data-testid="landing-hero-eyebrow"
        class="text-sm font-semibold tracking-wide uppercase"
        style="color: var(--c-hero-accent)"
      >
        {m.landing_hero_eyebrow()}
      </span>
      <h1 class="text-3xl leading-tight font-bold text-balance md:text-5xl">
        {m.landing_hero_title()}
      </h1>
      <p class="text-base text-pretty text-primary-content/85 md:text-lg">
        {m.landing_hero_subtitle()}
      </p>
      <div class="flex flex-col gap-3 sm:flex-row">
        <button
          type="button"
          data-testid="landing-cta-signup"
          class="btn border-none btn-lg hover:brightness-95"
          style="background: var(--c-hero-accent); color: var(--c-hero-accent-ink)"
          onclick={() => modalStore.openModal('signup')}
        >
          {m.landing_cta_create_account()}
        </button>
        <a
          data-testid="landing-cta-browse"
          href={resolve('/discover')}
          class="btn border-primary-content text-primary-content btn-outline btn-lg hover:bg-primary-content hover:text-primary"
        >
          {m.landing_cta_browse()}
        </a>
      </div>
      <p data-testid="landing-cta-hint" class="text-sm text-primary-content/80">
        {m.landing_cta_hint()}
      </p>
    </div>

    {#if !hasCards && pending}
      <div
        data-testid="landing-collage-pending"
        aria-hidden="true"
        class="-mr-4 flex gap-3 overflow-hidden pr-4 lg:mr-0 lg:grid lg:h-[30rem] lg:grid-cols-2 lg:content-center lg:gap-4 lg:p-0"
      >
        {#each [0, 1, 2] as i (i)}
          <div
            class="h-28 shrink-0 basis-[84%] skeleton rounded-2xl opacity-30 lg:basis-auto"
          ></div>
        {/each}
      </div>
    {:else if hasCards}
      <div
        data-testid="landing-collage"
        class="-mr-4 flex gap-3 overflow-x-auto pr-4 pb-2 lg:relative lg:mr-0 lg:h-[30rem] lg:overflow-visible lg:p-0"
      >
        {#if heroMaterial}
          <a
            data-testid="landing-card-material"
            href={detailHref(heroMaterial.rawEvent)}
            class="{card} lg:top-2 lg:left-0 lg:w-[17rem] lg:-rotate-3"
          >
            {#if heroMaterial.image}
              <span class="block h-32 bg-base-200">
                <ImageWithFallback
                  src={heroMaterial.image}
                  alt=""
                  loading="eager"
                  fallbackType="generic"
                  class="h-full w-full object-cover"
                />
              </span>
            {/if}
            <span class="flex flex-col gap-1.5 p-4">
              <span class="flex flex-wrap gap-1.5">
                <span class="badge badge-sm badge-primary">{m.landing_card_material()}</span>
                {#if heroMaterial.license?.label}
                  <span class="badge badge-ghost badge-sm">{heroMaterial.license.label}</span>
                {/if}
              </span>
              <span class="leading-snug font-semibold">{heroMaterial.name}</span>
            </span>
          </a>
        {/if}

        {#if nextEvent && eventDate}
          <a
            data-testid="landing-card-event"
            href={detailHref(nextEvent.originalEvent)}
            class="{card} lg:top-8 lg:right-0 lg:w-[18rem] lg:rotate-2"
          >
            <span class="flex items-center gap-3 p-4">
              <span
                class="grid w-14 shrink-0 place-items-center rounded-xl bg-secondary/15 py-1.5 text-secondary"
              >
                <span class="text-xl leading-none font-bold">{eventDate.day}</span>
                <span class="text-xs font-semibold uppercase">{eventDate.month}</span>
              </span>
              <span class="flex min-w-0 flex-col gap-1">
                <span class="leading-snug font-semibold">{nextEvent.title}</span>
                <span class="flex items-center gap-1 text-sm text-base-content/70">
                  {#if eventDate.time}{eventDate.time}{/if}
                  {#if nextEvent.location}
                    <LocationIcon class_="h-4 w-4 shrink-0" />
                    <span class="truncate">{nextEvent.location}</span>
                  {/if}
                </span>
              </span>
            </span>
          </a>
        {/if}

        {#if community}
          <a
            data-testid="landing-card-community"
            href={resolve(`/c/${hexToNpub(community.pubkey) || community.pubkey}`)}
            class="{card} lg:top-[12.5rem] lg:right-2 lg:w-[19rem] lg:-rotate-1"
          >
            <span class="flex items-center gap-3 p-4">
              <span class="size-12 shrink-0 overflow-hidden rounded-full bg-base-300">
                <ImageWithFallback
                  src={community.picture || ''}
                  alt=""
                  fallbackType="community"
                  class="h-full w-full object-cover"
                />
              </span>
              <span class="flex min-w-0 flex-col">
                <span class="font-semibold">{community.name}</span>
                {#if community.about}
                  <span class="line-clamp-2 text-sm text-base-content/70">{community.about}</span>
                {/if}
              </span>
            </span>
          </a>
        {/if}

        {#if article}
          <a
            data-testid="landing-card-article"
            href={detailHref(article)}
            class="{card} lg:top-[22rem] lg:left-8 lg:w-[16rem] lg:rotate-2"
          >
            <span class="flex items-center gap-2.5 p-4">
              <span class="badge badge-sm badge-accent">{m.landing_card_article()}</span>
              <span class="min-w-0 leading-snug font-semibold">{getTagValue(article, 'title')}</span
              >
            </span>
          </a>
        {/if}
      </div>
    {/if}
  </div>

  <div class="container mx-auto px-4 pb-6">
    <p data-testid="landing-network-line" class="text-sm text-primary-content/80">
      {m.landing_network_line({ appName: runtimeConfig.appName })}
      {#if helpLink}
        <a data-testid="landing-network-link" {...helpLink} class="link">
          {m.landing_network_link()}
        </a>
      {/if}
    </p>
  </div>
</section>
