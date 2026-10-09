<!--
  Nip05InfoCard
  Plain-language explainer behind the "Verifiziert" chip (issue
  "Erklärung/Anleitung Verifizierung", design option 2a). Worded after how
  NIP-05 providers introduce the address — a readable name for the key, the
  domain vouches for it, only the domain hands it out, every Nostr app finds
  it — and it names the e-mail misunderstanding instead of avoiding it.

  The address's own domain fills the texts: for the deployment's handle
  domain the lead mentions the team's review and the publishing point is
  shown; a foreign domain (bob@nostrplebs.com) gets the generic lead and
  two points. Ends with a deep link into the user guide and, for logged-in
  viewers whose own profile has no address yet, the "request your own" CTA.
  The viewer's kind 0 is subscribed only while the card is mounted.

  The guide anchor is the heading id of "Was bedeutet 'Verifiziert'?" in
  articles/edufeed-erste-schritte.md (edufeed/wikis) — keep both in sync.
-->
<script>
  import { resolve } from '$app/paths';
  import { runtimeConfig } from '$lib/stores/config.svelte.js';
  import { useActiveUser } from '$lib/stores/accounts.svelte';
  import { useUserProfile } from '$lib/stores/user-profile.svelte.js';
  import { helpSectionLinkAttrs } from '$lib/helpers/help-link.js';
  import { parseNip05Address } from '$lib/helpers/nip05-verify.js';
  import { CheckIcon, ChevronRightIcon } from '$lib/components/icons';
  import * as m from '$lib/paraglide/messages';

  const GUIDE_ANCHOR = 'was-bedeutet-verifiziert';

  /**
   * @type {{ nip05?: string | null, applyCta?: boolean }}
   * nip05    — the verified address the card explains (shown on top).
   * applyCta — offer "request your own address" to logged-in viewers without one.
   */
  let { nip05 = null, applyCta = true } = $props();

  const appName = $derived(runtimeConfig.appName || 'Edufeed');
  const membershipEnabled = $derived(Boolean(runtimeConfig.membership?.enabled));
  const houseDomain = $derived((runtimeConfig.membership?.handleDomain || '').toLowerCase());
  /** Domain the address lives on; the deployment's own when none is given. */
  const domain = $derived(parseNip05Address(nip05 || '')?.domain || houseDomain);
  const isHouse = $derived(membershipEnabled && domain !== '' && domain === houseDomain);
  const helpLink = $derived(helpSectionLinkAttrs(runtimeConfig.help?.url, GUIDE_ANCHOR));

  const getActiveUser = useActiveUser();
  const getViewerProfile = useUserProfile(() => getActiveUser()?.pubkey);
  // Only once the viewer's profile is known: a missing kind 0 must not read
  // as "no address" and flash the CTA at everyone.
  const showApplyCta = $derived.by(() => {
    if (!applyCta || !membershipEnabled || !getActiveUser()) return false;
    const profile = getViewerProfile();
    return Boolean(profile) && !profile.nip05;
  });
</script>

<div class="w-80 max-w-[calc(100vw-2rem)] p-3 text-left text-xs" data-testid="nip05-info-card">
  {#if nip05}
    <span
      class="inline-flex max-w-full items-center gap-1.5 rounded-full border border-base-300 bg-base-200 px-2.5 py-1 font-medium text-base-content"
      data-testid="nip05-info-address"
    >
      <CheckIcon class_="h-3.5 w-3.5 shrink-0 text-success" />
      <span class="truncate">{nip05}</span>
    </span>
  {/if}
  <p class="mt-2 text-base-content/80" data-testid="nip05-info-lead">
    {isHouse ? m.nip05_info_lead_house({ domain, appName }) : m.nip05_info_lead_generic({ domain })}
  </p>
  <dl class="mt-2.5 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2">
    <dt class="font-semibold text-base-content">{m.nip05_info_point_authentic_title()}</dt>
    <dd class="text-base-content/80" data-testid="nip05-info-point">
      {m.nip05_info_point_authentic({ domain })}
    </dd>
    <dt class="font-semibold text-base-content">{m.nip05_info_point_findable_title()}</dt>
    <dd class="text-base-content/80" data-testid="nip05-info-point">
      {m.nip05_info_point_findable({ appName })}
    </dd>
    {#if isHouse}
      <dt class="font-semibold text-base-content">{m.nip05_info_point_publish_title()}</dt>
      <dd class="text-base-content/80" data-testid="nip05-info-point">
        {m.nip05_info_point_publish({ domain, appName })}
      </dd>
    {/if}
  </dl>
  <p
    class="mt-2.5 border-t border-base-300 pt-2.5 text-base-content/80"
    data-testid="nip05-info-not-email"
  >
    <span class="font-semibold text-base-content">{m.nip05_info_not_email_lead()}</span>
    {m.nip05_info_not_email()}
  </p>
  {#if helpLink || showApplyCta}
    <div class="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
      {#if helpLink}
        <a {...helpLink} class="link font-medium link-primary" data-testid="nip05-info-help-link">
          {m.nip05_info_help_link()}
        </a>
      {/if}
      {#if showApplyCta}
        <a
          href={resolve('/settings')}
          class="inline-flex items-center gap-0.5 font-medium text-primary hover:underline"
          data-testid="nip05-info-apply-cta"
        >
          {m.impersonation_own_cta({ domain: `@${houseDomain}` })}
          <ChevronRightIcon class_="h-3.5 w-3.5" />
        </a>
      {/if}
    </div>
  {/if}
</div>
