<!--
  ImpersonationWarning — shown under the header of profiles without a
  verified NIP-05 address. Warns visitors that the identity is unconfirmed
  and, when a similarly named *verified* profile exists (NIP-50 kind-0
  search + nip05 check), links it as a "did you mean" row. Relays without
  NIP-50 return nothing → the card degrades to the plain warning.

  On the viewer's OWN profile the visitor wording makes no sense; instead
  the card explains the missing verification and — when the membership
  feature is enabled — offers requesting a handle in the settings.
-->
<script>
  import { resolve } from '$app/paths';
  import { profileNameSearchLoader } from '$lib/loaders/profile-search.js';
  import { rankImpersonationCandidates } from '$lib/helpers/impersonation.js';
  import { verifyNip05 } from '$lib/helpers/nip05-verify.js';
  import { hexToNpub } from '$lib/helpers/nostrUtils';
  import { runtimeConfig } from '$lib/stores/config.svelte.js';
  import { AlertIcon, CheckIcon, ChevronRightIcon } from '$lib/components/icons';
  import ImageWithFallback from '$lib/components/shared/ImageWithFallback.svelte';
  import * as m from '$lib/paraglide/messages';

  /**
   * @type {{
   *   pubkey: string,
   *   npub: string,
   *   profileName: string,
   *   isOwnProfile?: boolean,
   *   searchFn?: (name: string, limit?: number) => import('rxjs').Observable<any>
   * }}
   */
  let {
    pubkey,
    npub,
    profileName,
    isOwnProfile = false,
    searchFn = profileNameSearchLoader
  } = $props();

  /** @type {{ pubkey: string, name: string, nip05: string, picture?: string } | null} */
  let match = $state(null);

  let npubShort = $derived(npub ? `${npub.slice(0, 12)}…${npub.slice(-6)}` : '');

  let membershipEnabled = $derived(
    !!runtimeConfig.membership?.enabled && !!runtimeConfig.membership?.handleDomain
  );

  $effect(() => {
    match = null;
    if (isOwnProfile) return;
    if (!profileName) return;

    let cancelled = false;
    /** @type {any[]} */
    const results = [];

    const sub = searchFn(profileName, 10).subscribe({
      next: (event) => results.push(event),
      error: () => {},
      complete: async () => {
        if (cancelled) return;
        try {
          const candidates = rankImpersonationCandidates(results, profileName, pubkey);
          for (const candidate of candidates) {
            const status = await verifyNip05(candidate.nip05, candidate.pubkey);
            if (cancelled) return;
            if (status === 'verified') {
              match = candidate;
              return;
            }
          }
        } catch (err) {
          console.error('ImpersonationWarning: match lookup failed:', err);
        }
      }
    });

    return () => {
      cancelled = true;
      sub.unsubscribe();
    };
  });
</script>

<div class="pf-imp-warn" data-testid="impersonation-warning">
  <div class="in">
    <span class="wic"><AlertIcon class_="w-5 h-5" /></span>
    {#if isOwnProfile}
      <div class="body" data-testid="own-nip05-hint">
        <div class="tt">{m.impersonation_own_title()}</div>
        <div class="tx">
          {m.impersonation_own_text()}
          <code>{npubShort}</code>
        </div>
        {#if membershipEnabled}
          <a class="cta" data-testid="own-nip05-cta" href={resolve('/settings')}>
            {m.impersonation_own_cta({ domain: `@${runtimeConfig.membership.handleDomain}` })}
            <ChevronRightIcon class_="w-4 h-4" />
          </a>
        {/if}
      </div>
    {:else}
      <div class="body">
        <div class="tt">{m.impersonation_title()}</div>
        <div class="tx">
          {m.impersonation_text()}
          <code>{npubShort}</code>
        </div>
        {#if match}
          <a
            class="match"
            data-testid="impersonation-match"
            href={resolve(`/p/${hexToNpub(match.pubkey) || match.pubkey}`)}
          >
            {#snippet mavFallback()}
              <span class="mav fallback">{match?.name[0]?.toUpperCase()}</span>
            {/snippet}
            {#if match.picture}
              <ImageWithFallback
                src={match.picture}
                alt=""
                fallbackType="avatar"
                robohash={false}
                class="h-8 w-8 shrink-0 rounded-full object-cover"
                fallback={mavFallback}
              />
            {:else}
              {@render mavFallback()}
            {/if}
            <span class="mtext">
              <span class="mn">
                {m.impersonation_did_you_mean()}
                <b>{match.name}</b>
                <span class="verif"
                  ><CheckIcon class_="w-2.5 h-2.5" /> {m.profile_verified_chip()}</span
                >
              </span>
              <span class="mm">{match.nip05}</span>
            </span>
            <span class="go"><ChevronRightIcon class_="w-4 h-4" /></span>
          </a>
        {/if}
      </div>
    {/if}
  </div>
</div>

<style>
  .pf-imp-warn {
    max-width: 1180px;
    margin: 16px auto 0;
    padding: 0 var(--pad);
  }
  .in {
    display: flex;
    gap: 14px;
    align-items: flex-start;
    background: color-mix(in oklch, var(--color-warning) 10%, var(--c-paper));
    border: 1.5px solid color-mix(in oklch, var(--color-warning) 55%, transparent);
    border-radius: 14px;
    padding: 16px 18px;
  }
  .wic {
    width: 40px;
    height: 40px;
    border-radius: 11px;
    background: var(--color-warning);
    color: var(--color-warning-content);
    display: grid;
    place-items: center;
    flex-shrink: 0;
  }
  .body {
    min-width: 0;
    flex: 1;
  }
  .tt {
    font-family: var(--pf-display);
    font-weight: 700;
    font-size: 14px;
    line-height: 1.3;
    color: var(--c-ink);
  }
  .tx {
    font-family: var(--pf-display);
    font-size: 13.5px;
    line-height: 1.55;
    color: var(--c-ink-soft);
    margin-top: 4px;
  }
  .tx code {
    font-family: ui-monospace, 'JetBrains Mono', monospace;
    font-size: 11.5px;
    background: var(--c-paper);
    border: 1px solid var(--c-rule);
    border-radius: 5px;
    padding: 1px 6px;
  }
  .cta {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin-top: 12px;
    background: var(--c-paper);
    border: 1px solid var(--c-rule);
    border-radius: 11px;
    padding: 9px 14px;
    text-decoration: none;
    color: var(--c-ink);
    font-family: var(--pf-display);
    font-weight: 600;
    font-size: 13px;
  }
  .cta:hover {
    border-color: var(--color-primary);
  }
  .match {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-top: 12px;
    background: var(--c-paper);
    border: 1px solid var(--c-rule);
    border-radius: 11px;
    padding: 10px 12px;
    text-decoration: none;
    color: inherit;
  }
  .match:hover {
    border-color: var(--color-primary);
  }
  .mav {
    width: 32px;
    height: 32px;
    border-radius: 999px;
    flex-shrink: 0;
    object-fit: cover;
  }
  .mav.fallback {
    display: grid;
    place-items: center;
    background: linear-gradient(150deg, var(--c-hero), var(--c-hero-2));
    color: var(--c-on-dark);
    font-family: var(--pf-display);
    font-weight: 800;
    font-size: 13px;
  }
  .mtext {
    min-width: 0;
    flex: 1;
  }
  .mn {
    display: flex;
    align-items: center;
    gap: 7px;
    flex-wrap: wrap;
    font-family: var(--pf-display);
    font-weight: 600;
    font-size: 13px;
    color: var(--c-ink);
  }
  .verif {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    background: var(--color-primary);
    color: var(--color-primary-content);
    padding: 3px 7px;
    border-radius: 999px;
  }
  .mm {
    display: block;
    font-family: var(--pf-display);
    font-size: 11.5px;
    color: var(--c-ink-soft);
    margin-top: 2px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .go {
    margin-left: auto;
    color: var(--c-ink-soft);
    display: inline-flex;
    flex-shrink: 0;
  }
</style>
