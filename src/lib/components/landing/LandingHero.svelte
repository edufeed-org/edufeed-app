<script>
  // Landing hero (mobile UX round 2026-10-13): say what Edufeed is for in
  // education words, make "Konto erstellen" the primary action, and offer the
  // three things first-time visitors came for as task tiles. The protocol
  // shrinks to one line linking the guide.
  import { resolve } from '$app/paths';
  import * as m from '$lib/paraglide/messages';
  import { modalStore } from '$lib/stores/modal.svelte.js';
  import { runtimeConfig } from '$lib/stores/config.svelte.js';
  import ImageWithFallback from '$lib/components/shared/ImageWithFallback.svelte';
  import { isDiscoverTypeEnabled } from '$lib/helpers/discover-content-types.js';
  import { helpLinkAttrs } from '$lib/helpers/help-link.js';
  import { BookOpenIcon, CalendarIcon, PeopleIcon } from '$lib/components/icons';

  // Tiles deep-link into /discover tabs; hide the ones a deployment disabled
  // via DISCOVER_CONTENT_TYPES so they never lead to a fallback tab.
  const discoverTypes = $derived(runtimeConfig.discover?.contentTypes || []);
  const helpLink = $derived(helpLinkAttrs(runtimeConfig.help?.url));
  const tasks = $derived(
    [
      {
        id: 'material',
        href: resolve('/discover?type=learning'),
        icon: BookOpenIcon,
        title: m.landing_task_material_title(),
        sub: m.landing_task_material_sub(),
        show: isDiscoverTypeEnabled('learning', discoverTypes)
      },
      {
        id: 'training',
        href: resolve('/calendar'),
        icon: CalendarIcon,
        title: m.landing_task_training_title(),
        sub: m.landing_task_training_sub(),
        show: true
      },
      {
        id: 'community',
        href: resolve('/discover?type=communities'),
        icon: PeopleIcon,
        title: m.landing_task_community_title(),
        sub: m.landing_task_community_sub(),
        show: isDiscoverTypeEnabled('communities', discoverTypes)
      }
    ].filter((t) => t.show)
  );
</script>

<section
  class="relative shrink-0 overflow-hidden py-12 text-primary-content md:py-20 {runtimeConfig.ui
    ?.landingHeroImage
    ? ''
    : 'bg-gradient-to-br from-primary to-secondary'}"
>
  {#if runtimeConfig.ui?.landingHeroImage}
    <ImageWithFallback
      src={runtimeConfig.ui.landingHeroImage}
      alt=""
      size="hero"
      loading="eager"
      fallbackType="banner"
      class="absolute inset-0 h-full w-full object-cover"
    />
  {/if}
  <div class="relative z-10 container mx-auto px-4">
    <!-- Frosted glass card -->
    <div class="mx-auto max-w-4xl rounded-2xl bg-black/30 p-6 text-center backdrop-blur-md md:p-12">
      <h1 class="mb-4 text-3xl leading-tight font-bold text-balance text-white md:text-5xl">
        {m.landing_hero_title()}
      </h1>
      <p class="mb-6 text-base text-white/90 md:text-xl">
        {m.landing_hero_subtitle()}
      </p>
      <div class="flex flex-col items-center gap-3">
        <button
          type="button"
          data-testid="landing-cta-signup"
          class="btn w-full max-w-sm border-none btn-lg btn-accent"
          onclick={() => modalStore.openModal('signup')}
        >
          {m.landing_cta_create_account()}
        </button>
        <a data-testid="landing-cta-browse" href={resolve('/discover')} class="link text-white">
          {m.landing_cta_browse()}
        </a>
      </div>
    </div>

    <!-- Task tiles: what first-time visitors came for -->
    <div class="mx-auto mt-6 grid max-w-4xl gap-3 sm:grid-cols-3">
      {#each tasks as task (task.id)}
        {@const Icon = task.icon}
        <a
          data-testid="landing-task-{task.id}"
          href={task.href}
          class="flex min-h-16 items-center gap-3 rounded-2xl bg-base-100 p-4 text-base-content shadow-sm transition-shadow hover:shadow-md"
        >
          <span
            class="grid size-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"
          >
            <Icon class_="h-6 w-6" title="" />
          </span>
          <span class="min-w-0">
            <span class="block font-semibold">{task.title}</span>
            <span class="block text-sm text-base-content/70">{task.sub}</span>
          </span>
        </a>
      {/each}
    </div>

    <!-- Own scrim: the line sits outside the frosted card, on the raw hero
         photo or gradient, where white text alone can be unreadable. -->
    <div class="mt-4 text-center">
      <p
        data-testid="landing-network-line"
        class="inline-block rounded-full bg-black/40 px-3 py-1 text-sm text-white backdrop-blur-sm"
      >
        {m.landing_network_line({ appName: runtimeConfig.appName })}
        {#if helpLink}
          <a data-testid="landing-network-link" {...helpLink} class="link">
            {m.landing_network_link()}
          </a>
        {/if}
      </p>
    </div>
  </div>
</section>
