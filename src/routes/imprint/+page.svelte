<script>
  import { runtimeConfig } from '$lib/stores/config.svelte.js';
  import * as m from '$lib/paraglide/messages';

  let imprint = $derived(runtimeConfig.imprint);
</script>

<svelte:head>
  <title>{m.imprint_title()} - {runtimeConfig.appName}</title>
</svelte:head>

<div class="bg-base-100 px-4 py-8">
  <div class="mx-auto max-w-3xl">
    <div class="card bg-base-200 shadow-xl">
      <div class="card-body">
        <h1 class="mb-6 card-title text-3xl">{m.imprint_title()}</h1>

        <p class="mb-6 text-base-content/70">
          <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- external: git repo link -->
          <a
            href={runtimeConfig.gitRepo}
            target="_blank"
            rel="noopener noreferrer"
            class="link font-medium link-primary"
          >
            {runtimeConfig.appName}
          </a>
          — {m.imprint_attribution()}, <span>{runtimeConfig.footer.fundingText}</span>
        </p>

        {#if imprint.enabled}
          <!-- Organization -->
          <div class="mb-6">
            <p class="text-lg font-medium">{imprint.organization}</p>
          </div>

          {#if imprint.address.street || imprint.address.postalCode || imprint.address.city || imprint.address.country}
            <!-- Address -->
            <div class="mb-6">
              <h3 class="mb-2 font-semibold">{m.imprint_address()}</h3>
              <p>{imprint.address.street}</p>
              <p>{imprint.address.postalCode} {imprint.address.city}</p>
              <p>{imprint.address.country}</p>
            </div>
          {/if}

          <!-- Contact -->
          <div class="mb-6">
            <h3 class="mb-2 font-semibold">{m.imprint_contact()}</h3>
            <p>
              {m.imprint_email()}
              <a href="mailto:{imprint.contact.email}" class="link link-primary">
                {imprint.contact.email}
              </a>
            </p>
            {#if imprint.contact.phone}
              <p>{m.imprint_phone()} {imprint.contact.phone}</p>
            {/if}
          </div>

          <!-- Representative -->
          {#if imprint.representative}
            <div class="mb-6">
              <h3 class="mb-2 font-semibold">{m.imprint_represented_by()}</h3>
              <p>{imprint.representative}</p>
            </div>
          {/if}
          <!-- Funding Information -->
          {#if imprint.funding.length > 0}
            <div class="mb-6">
              <h3 class="mb-2 font-semibold">{m.imprint_funding()}</h3>
              <div class="flex flex-col gap-4">
                {#each imprint.funding as entry, i (i)}
                  <div class="flex flex-col gap-2">
                    {#if entry.image}
                      <img
                        src={entry.image}
                        alt={m.imprint_funding_logo_alt()}
                        class="h-auto w-auto"
                      />
                    {/if}
                    {#if entry.text}
                      <p class="text-sm">{entry.text}</p>
                    {/if}
                  </div>
                {/each}
              </div>
            </div>
          {/if}

          <!-- Optional fields -->
          {#if imprint.registrationNumber}
            <div class="mb-6">
              <h3 class="mb-2 font-semibold">{m.imprint_registration_number()}</h3>
              <p>{imprint.registrationNumber}</p>
            </div>
          {/if}

          {#if imprint.vatId}
            <div class="mb-6">
              <h3 class="mb-2 font-semibold">{m.imprint_vat_id()}</h3>
              <p>{imprint.vatId}</p>
            </div>
          {/if}

          {#if imprint.responsibleForContent}
            <div class="mb-6">
              <h3 class="mb-2 font-semibold">{m.imprint_responsible_for_content()}</h3>
              <p>{imprint.responsibleForContent}</p>
            </div>
          {/if}

          <!-- Disclaimer -->
          <div class="mt-8 border-t border-base-300 pt-6">
            <h3 class="mb-2 font-semibold">{m.imprint_disclaimer()}</h3>
            <p class="text-sm opacity-70">
              {m.imprint_disclaimer_text()}
            </p>
          </div>

          <!-- Image license notice -->
          <div class="mt-6 border-t border-base-300 pt-6">
            <h3 class="mb-2 font-semibold">{m.imprint_image_license_title()}</h3>
            <p class="text-sm opacity-70">
              {m.imprint_image_license_text()}
            </p>
            <p class="mt-2 text-sm opacity-70">
              {m.imprint_image_license_takedown()}
              <a href="mailto:{imprint.contact.email}" class="link link-primary">
                {imprint.contact.email}
              </a>
            </p>
          </div>
        {:else}
          <p class="text-lg">{m.imprint_not_available()}</p>
        {/if}
      </div>
    </div>
  </div>
</div>
