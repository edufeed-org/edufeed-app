<script>
  import { resolve } from '$app/paths';
  import * as m from '$lib/paraglide/messages';
  import { modalStore } from '$lib/stores/modal.svelte.js';
  import { runtimeConfig } from '$lib/stores/config.svelte.js';
  import { getProxiedImageUrl } from '$lib/helpers/image-proxy.js';

  // Note: These functions are kept for future CTA buttons
  function _handleGetStarted() {
    modalStore.openModal('signup');
  }

  function _scrollToCommunities() {
    const carousel = document.querySelector('#community-showcase');
    if (carousel) {
      carousel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }
</script>

<section
  class="relative shrink-0 overflow-hidden py-20 text-primary-content {runtimeConfig.ui
    ?.landingHeroImage
    ? ''
    : 'bg-gradient-to-br from-primary to-secondary'}"
>
  {#if runtimeConfig.ui?.landingHeroImage}
    <img
      src={getProxiedImageUrl(runtimeConfig.ui.landingHeroImage, 'hero') ||
        runtimeConfig.ui.landingHeroImage}
      alt=""
      class="absolute inset-0 h-full w-full object-cover"
    />
  {/if}
  <div class="relative z-10 container mx-auto px-4">
    <!-- Frosted glass card -->
    <div class="mx-auto max-w-4xl rounded-2xl bg-black/30 p-8 text-center backdrop-blur-md md:p-12">
      <h1 class="mb-6 text-4xl leading-tight font-bold text-white md:text-5xl lg:text-6xl">
        {m.landing_hero_title()}
      </h1>
      <p class="mb-4 text-lg text-white/90 md:text-xl lg:text-2xl">
        {m.landing_hero_subtitle()}
      </p>

      <!-- Onboarding link -->
      <a
        href="https://onboarding.edufeed.org"
        target="_blank"
        rel="noopener noreferrer"
        class="group mb-8 inline-flex items-center gap-2 rounded-full border border-white/30 bg-white/15 px-5 py-2.5 text-sm font-medium text-white backdrop-blur-sm transition-all hover:border-white/50 hover:bg-white/25 md:text-base"
      >
        <span class="text-lg">🚀</span>
        {m.landing_hero_onboarding()}
        <svg
          xmlns="http://www.w3.org/2000/svg"
          class="h-4 w-4 transition-transform group-hover:translate-x-0.5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          stroke-width="2"
        >
          <path stroke-linecap="round" stroke-linejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
        </svg>
      </a>

      <!-- Feature badges -->
      <div class="mb-10 flex flex-wrap justify-center gap-4">
        <a
          href={resolve('/discover?type=communities')}
          class="flex items-center gap-2 rounded-full bg-white/20 px-4 py-2 text-white backdrop-blur-sm transition-opacity hover:opacity-80"
        >
          <span class="text-2xl">🏘️</span>
          <span class="font-medium">{m.landing_features_communities()}</span>
        </a>
        <a
          href={resolve('/calendar')}
          class="flex items-center gap-2 rounded-full bg-white/20 px-4 py-2 text-white backdrop-blur-sm transition-opacity hover:opacity-80"
        >
          <span class="text-2xl">📅</span>
          <span class="font-medium">{m.landing_features_calendar()}</span>
        </a>
        <a
          href={resolve('/discover?type=boards')}
          class="flex items-center gap-2 rounded-full bg-white/20 px-4 py-2 text-white backdrop-blur-sm transition-opacity hover:opacity-80"
        >
          <span class="text-2xl">📋</span>
          <span class="font-medium">{m.landing_features_kanban()}</span>
        </a>
      </div>

      <!-- Call to action buttons -->
      <div class="flex flex-col items-center justify-center gap-4 sm:flex-row">
        <a
          href={resolve('/calendar')}
          class="btn border-none bg-white text-primary shadow-lg btn-lg hover:bg-white/90"
        >
          📅 {m.landing_hero_browse_calendar()}
        </a>
        <a
          href={resolve('/discover')}
          class="btn border-2 border-white text-white btn-outline btn-lg hover:bg-white hover:text-primary"
        >
          🔭 {m.landing_hero_discover()}
        </a>
      </div>
    </div>
  </div>
</section>
