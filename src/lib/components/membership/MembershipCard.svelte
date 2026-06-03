<script>
  import * as m from '$lib/paraglide/messages';
  import { manager } from '$lib/stores/accounts.svelte';
  import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
  import { runtimeConfig } from '$lib/stores/config.svelte.js';
  import { buildUserResponseFilter, parseResponseTags } from '$lib/helpers/forms.js';
  import { createTimelineLoader } from 'applesauce-loaders/loaders';
  import { timedPool } from '$lib/loaders/base.js';
  import { getCommunikeyRelays } from '$lib/helpers/relay-helper.js';
  import { actionRunner } from '$lib/stores/action-runner.svelte.js';
  import { UpdateProfile } from 'applesauce-actions/actions';
  import MembershipApplicationForm from './MembershipApplicationForm.svelte';
  import { formatTimestamp } from '$lib/helpers/dates.js';

  const cfg = $derived(runtimeConfig.membership);
  const enabled = $derived(cfg?.enabled === true);
  const formAddress = $derived(cfg?.formAddress || '');
  const handleDomain = $derived(cfg?.handleDomain || '');
  const adminPubkey = $derived(cfg?.adminPubkeys?.[0] || '');

  /** @type {import('nostr-tools').NostrEvent | null} */
  let existingResponse = $state(null);
  let showForm = $state(false);

  /** Wished handle from the decrypted (or plaintext) response, e.g. "maria". */
  let wishedHandle = $state('');
  /** Current nip05 string in the user's kind 0, if any. */
  let currentNip05 = $state('');
  /** Whether the upstream `.well-known` lookup maps wishedHandle → user's pubkey. */
  let upstreamMatchesUser = $state(false);
  /** UI state for the add-to-profile button. */
  let addState = $state(/** @type {'idle' | 'saving' | 'saved' | 'error'} */ ('idle'));

  const addressForProfile = $derived(
    wishedHandle && handleDomain ? `${wishedHandle}@${handleDomain}` : ''
  );
  const showAddToProfile = $derived(
    upstreamMatchesUser && !!addressForProfile && currentNip05 !== addressForProfile
  );

  $effect(() => {
    if (!enabled || !manager.active || !formAddress) return;
    const filter = buildUserResponseFilter(formAddress, manager.active.pubkey);
    const relays = getCommunikeyRelays();

    const loaderSub = createTimelineLoader(timedPool, relays, filter, {
      eventStore,
      limit: 1
    })().subscribe();

    const modelSub = eventStore.timeline(filter).subscribe((events) => {
      existingResponse = events?.[0] || null;
    });

    return () => {
      loaderSub.unsubscribe();
      modelSub.unsubscribe();
    };
  });

  // Subscribe to the user's own kind 0 so we know what nip05 (if any) is set.
  $effect(() => {
    const active = manager.active;
    if (!active) return;
    const sub = eventStore.replaceable(0, active.pubkey).subscribe((event) => {
      if (!event?.content) {
        currentNip05 = '';
        return;
      }
      try {
        currentNip05 = JSON.parse(event.content)?.nip05 || '';
      } catch {
        currentNip05 = '';
      }
    });
    return () => sub.unsubscribe();
  });

  // Decrypt (or read plaintext) the wished_handle out of the user's own response.
  $effect(() => {
    const response = existingResponse;
    const active = manager.active;
    if (!response || !active) {
      wishedHandle = '';
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const isEncrypted = response.tags.some((/** @type {string[]} */ t) => t[0] === 'encrypted');
        let tags;
        if (isEncrypted) {
          if (!adminPubkey || !active.signer?.nip44?.decrypt) return;
          const plaintext = await active.signer.nip44.decrypt(adminPubkey, response.content);
          tags = JSON.parse(plaintext);
        } else {
          tags = response.tags.filter((/** @type {string[]} */ t) => t[0] === 'response');
        }
        if (cancelled) return;
        const values = parseResponseTags(tags);
        wishedHandle = (values?.wished_handle || '').trim();
      } catch {
        if (!cancelled) wishedHandle = '';
      }
    })();
    return () => {
      cancelled = true;
    };
  });

  // Ask the public domain whether the wished_handle has been provisioned for this user.
  $effect(() => {
    upstreamMatchesUser = false;
    const active = manager.active;
    if (!active || !wishedHandle || !handleDomain) return;
    let cancelled = false;
    (async () => {
      try {
        const url = `https://${handleDomain}/.well-known/nostr.json?name=${encodeURIComponent(wishedHandle)}`;
        const res = await fetch(url, { headers: { accept: 'application/json' } });
        if (!res.ok) return;
        const body = await res.json();
        const mapped = body?.names?.[wishedHandle];
        if (!cancelled) upstreamMatchesUser = mapped === active.pubkey;
      } catch {
        // Network/CORS — leave as false; user can retry by reloading.
      }
    })();
    return () => {
      cancelled = true;
    };
  });

  async function addToProfile() {
    if (!addressForProfile) return;
    addState = 'saving';
    try {
      await actionRunner.run(UpdateProfile, { nip05: addressForProfile });
      addState = 'saved';
      currentNip05 = addressForProfile;
    } catch {
      addState = 'error';
    }
  }
</script>

{#if enabled}
  <div class="card bg-base-200 shadow-xl">
    <div class="card-body">
      <h2 class="mb-2 card-title text-2xl">
        {m.auth_signup_modal_membership_title()}
      </h2>
      <p class="mb-4 text-base-content/70">
        {m.auth_signup_modal_membership_help()}
      </p>

      {#if existingResponse}
        <div class="alert alert-info">
          <span>
            {m.membership_already_applied({
              date: formatTimestamp(existingResponse.created_at)
            })}
          </span>
        </div>

        {#if showAddToProfile}
          <div class="mt-4 alert alert-success">
            <div class="flex flex-col gap-2">
              <span>
                {m.membership_add_to_profile_intro({ address: addressForProfile })}
              </span>
              <div class="flex items-center gap-2">
                <button
                  class="btn btn-sm btn-primary"
                  disabled={addState === 'saving'}
                  onclick={addToProfile}
                >
                  {#if addState === 'saving'}
                    <span class="loading loading-xs loading-spinner"></span>
                  {/if}
                  {m.membership_add_to_profile_cta()}
                </button>
                {#if addState === 'saved'}
                  <span class="text-sm text-success">{m.membership_add_to_profile_success()}</span>
                {:else if addState === 'error'}
                  <span class="text-sm text-error">{m.membership_add_to_profile_error()}</span>
                {/if}
              </div>
            </div>
          </div>
        {/if}

        <div class="mt-4 card-actions">
          <button class="btn btn-ghost" onclick={() => (showForm = !showForm)}>
            {m.membership_already_applied_update()}
          </button>
        </div>
      {:else}
        <div class="card-actions">
          <button class="btn btn-primary" onclick={() => (showForm = !showForm)}>
            {m.auth_signup_modal_membership_title()}
          </button>
        </div>
      {/if}

      {#if showForm}
        <div class="mt-6 border-t border-base-300 pt-4">
          <MembershipApplicationForm onsubmitted={() => (showForm = false)} showHeader={false} />
        </div>
      {/if}
    </div>
  </div>
{/if}
