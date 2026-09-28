<!--
  ThirdPartyCredits — the attribution section on /imprint for shipped
  third-party material (see helpers/third-party-credits.js). Always rendered,
  independent of the operator's imprint config.
-->
<script>
  import { asset } from '$app/paths';
  import { NOTICES_PATH, THIRD_PARTY_CREDITS } from '$lib/helpers/third-party-credits.js';
  import * as m from '$lib/paraglide/messages';
</script>

<section class="mt-6 border-t border-base-300 pt-6" data-testid="third-party-credits">
  <h3 class="mb-2 font-semibold">{m.imprint_credits_title()}</h3>
  <ul class="flex flex-col gap-3 text-sm opacity-70">
    {#each THIRD_PARTY_CREDITS as credit (credit.id)}
      <li data-testid="credit-{credit.id}">
        <p><span class="font-medium">{credit.title()}:</span> {credit.text()}</p>
        <p class="mt-1 flex flex-wrap gap-x-3">
          {#each credit.links as link (link.href)}
            <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- external license/source link -->
            <a href={link.href} target="_blank" rel="noopener noreferrer" class="link link-primary"
              >{link.label}</a
            >
          {/each}
        </p>
      </li>
    {/each}
  </ul>
  <p class="mt-3 text-sm">
    <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- static asset, not a route -->
    <a href={asset(NOTICES_PATH)} class="link link-primary" data-testid="third-party-notices-link"
      >{m.imprint_credits_full_texts()}</a
    >
  </p>
</section>
