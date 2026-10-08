<script>
  import emblaCarouselSvelte from 'embla-carousel-svelte';
  import { resolve } from '$app/paths';
  import CommunikeyCard from '$lib/components/CommunikeyCard.svelte';
  import { ChevronLeftIcon, ChevronRightIcon } from '$lib/components/icons';
  import {
    useAllCommunities,
    useAllCommunitiesLoaded
  } from '$lib/stores/all-communities.svelte.js';
  import { useProfileMap } from '$lib/stores/profile-map.svelte.js';
  import { hasDisplayableCommunityProfile } from '$lib/helpers/communityContent.js';
  import * as m from '$lib/paraglide/messages';

  const getAllCommunities = useAllCommunities();
  const getCommunitiesLoaded = useAllCommunitiesLoaded();
  const allCommunities = $derived(getAllCommunities());
  const getProfiles = useProfileMap(() => allCommunities.map((c) => c.pubkey));

  // Same rule as the discover communities tab: a community without a named
  // kind 0 profile would render as a meaningless "Unknown User" card.
  const communities = $derived(
    allCommunities.filter((community) =>
      hasDisplayableCommunityProfile(getProfiles().get(community.pubkey))
    )
  );
  // Spin only while the initial load is still running — once it has finished,
  // "nothing displayable" must not look like "still loading".
  const isLoading = $derived(communities.length === 0 && !getCommunitiesLoaded());

  let showAll = $state(false);
  /** @type {ReturnType<typeof setInterval> | null} */
  let autoScrollInterval = $state(null);
  let isHovered = $state(false);
  /** @type {any} */
  let emblaApi = $state(null);
  let selectedIndex = $state(0);

  // Calculate how many cards to show per slide based on screen width
  let cardsPerSlide = $state(4);

  // Update cards per slide on mount and resize
  $effect(() => {
    function updateCardsPerSlide() {
      const width = window.innerWidth;
      if (width < 768) {
        cardsPerSlide = 1;
      } else if (width < 1024) {
        cardsPerSlide = 2;
      } else {
        cardsPerSlide = 3;
      }
    }

    updateCardsPerSlide();
    window.addEventListener('resize', updateCardsPerSlide);

    return () => {
      window.removeEventListener('resize', updateCardsPerSlide);
    };
  });

  // Group communities into slides
  const slides = $derived.by(() => {
    if (communities.length === 0) return [];

    const result = [];
    for (let i = 0; i < communities.length; i += cardsPerSlide) {
      result.push(communities.slice(i, i + cardsPerSlide));
    }
    return result;
  });

  // Initialize Embla carousel
  /** @param {any} emblaInstance */
  function handleEmblaInit(emblaInstance) {
    emblaApi = emblaInstance;

    // Set up event listeners
    emblaApi.on('select', () => {
      selectedIndex = emblaApi.selectedScrollSnap();
    });

    // Initialize selected index
    selectedIndex = emblaApi.selectedScrollSnap();
  }

  // Auto-scroll functionality
  $effect(() => {
    if (!isHovered && !showAll && emblaApi && slides.length > 1) {
      autoScrollInterval = setInterval(() => {
        if (emblaApi) {
          emblaApi.scrollNext();
        }
      }, 5000);

      return () => {
        if (autoScrollInterval) {
          clearInterval(autoScrollInterval);
        }
      };
    }
  });

  function handleMouseEnter() {
    isHovered = true;
  }

  function handleMouseLeave() {
    isHovered = false;
  }

  function toggleShowAll() {
    showAll = !showAll;
    if (!showAll && emblaApi) {
      // Reset to first slide when collapsing
      emblaApi.scrollTo(0);
    }
  }

  function scrollPrev() {
    if (emblaApi) {
      emblaApi.scrollPrev();
    }
  }

  function scrollNext() {
    if (emblaApi) {
      emblaApi.scrollNext();
    }
  }

  /** @param {number} index */
  function scrollTo(index) {
    if (emblaApi) {
      emblaApi.scrollTo(index);
    }
  }
</script>

<section id="community-showcase" class="bg-base-100 py-16">
  <div class="container mx-auto px-4">
    <!-- Section header -->
    <div class="mb-12 text-center">
      <h2 class="mb-4 text-3xl font-bold text-base-content md:text-4xl">
        {m.landing_carousel_title()}
      </h2>
      <p class="text-lg text-base-content/70">
        {m.landing_carousel_subtitle()}
      </p>
    </div>

    {#if isLoading}
      <!-- Loading state -->
      <div class="flex justify-center py-12">
        <div class="loading loading-lg loading-spinner text-primary"></div>
      </div>
    {:else if showAll}
      <!-- Grid view - all communities -->
      <div class="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {#each communities as community (community.pubkey)}
          <CommunikeyCard pubkey={community.pubkey} />
        {/each}
      </div>

      <!-- Show less button -->
      <div class="mt-8 text-center">
        <button onclick={toggleShowAll} class="btn btn-lg btn-primary">
          {m.landing_carousel_show_less()}
        </button>
      </div>
    {:else}
      <!-- Carousel view -->
      <div
        class="relative"
        role="region"
        aria-label="Community carousel"
        onmouseenter={handleMouseEnter}
        onmouseleave={handleMouseLeave}
      >
        <div
          class="overflow-hidden rounded-box"
          use:emblaCarouselSvelte={{
            options: { loop: true, align: 'start' },
            plugins: []
          }}
          onemblaInit={(/** @type {CustomEvent} */ e) => handleEmblaInit(e.detail)}
        >
          <div class="flex">
            {#each slides as slide, index (index)}
              <div class="min-w-0 flex-[0_0_100%]">
                <!-- Grid of community cards -->
                <div class="grid w-full grid-cols-1 gap-4 p-4 md:grid-cols-2 lg:grid-cols-3">
                  {#each slide as community (community.pubkey)}
                    <CommunikeyCard pubkey={community.pubkey} />
                  {/each}
                </div>
              </div>
            {/each}
          </div>
        </div>

        <!-- Navigation buttons -->
        {#if slides.length > 1}
          <div
            class="pointer-events-none absolute top-1/2 right-5 left-5 flex -translate-y-1/2 transform justify-between"
          >
            <button
              onclick={scrollPrev}
              class="btn pointer-events-auto btn-circle shadow-lg btn-primary"
              aria-label={m.landing_carousel_previous_slide()}
            >
              <ChevronLeftIcon class_="h-6 w-6" />
            </button>
            <button
              onclick={scrollNext}
              class="btn pointer-events-auto btn-circle shadow-lg btn-primary"
              aria-label={m.landing_carousel_next_slide()}
            >
              <ChevronRightIcon class_="h-6 w-6" />
            </button>
          </div>
        {/if}

        <!-- Dot indicators -->
        {#if slides.length > 1}
          <div class="mt-8 flex justify-center gap-3">
            {#each slides as _, index (index)}
              <button
                onclick={() => scrollTo(index)}
                class="group flex items-center justify-center rounded-full p-2 transition-all duration-300 hover:bg-base-200"
                aria-label={m.landing_carousel_go_to_slide({ index: index + 1 })}
              >
                <div
                  class="h-3 w-3 rounded-full transition-all duration-300 {selectedIndex === index
                    ? 'scale-125 bg-primary'
                    : 'bg-base-300 group-hover:scale-125 group-hover:bg-primary'}"
                ></div>
              </button>
            {/each}
          </div>
        {/if}
      </div>

      <!-- View all link -->
      <div class="mt-8 text-center">
        <a href={resolve('/discover')} class="link text-lg font-medium link-primary">
          {m.landing_carousel_view_all()}
        </a>
      </div>
    {/if}
  </div>
</section>
