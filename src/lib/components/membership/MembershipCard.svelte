<script>
  import * as m from '$lib/paraglide/messages';
  import { manager } from '$lib/stores/accounts.svelte';
  import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
  import { runtimeConfig } from '$lib/stores/config.svelte.js';
  import { useMembershipGrantState } from '$lib/stores/membership-grant.svelte.js';
  import { actionRunner } from '$lib/stores/action-runner.svelte.js';
  import { UpdateProfile } from 'applesauce-actions/actions';
  import { AddProfileNip05Tag } from '$lib/actions/profile-actions.js';
  import { getProfileNip05s } from '$lib/helpers/nip05-verify.js';
  import { modalStore } from '$lib/stores/modal.svelte.js';
  import { formatTimestamp } from '$lib/helpers/dates.js';

  const cfg = $derived(runtimeConfig.membership);
  const enabled = $derived(cfg?.enabled === true);

  // Application state (none / pending / granted) — shared with the Termi
  // assistant's nip05 hint.
  const grant = useMembershipGrantState();
  const existingResponse = $derived(grant.getResponse());
  const upstreamMatchesUser = $derived(grant.getState() === 'granted');
  const addressForProfile = $derived(grant.getAddress());

  /** The user's current kind 0 event, if any. */
  let profileEvent = $state(/** @type {import('nostr-tools').NostrEvent | null} */ (null));
  /** UI state for the add-to-profile button. */
  let addState = $state(/** @type {'idle' | 'saving' | 'saved' | 'error'} */ ('idle'));
  /** Hides the CTA immediately after a successful save, before the kind 0 refreshes. */
  let savedLocally = $state(false);
  /** All nip05 addresses on the profile: content nip05 + repeated nip05 tags. */
  const existingNip05s = $derived(getProfileNip05s(profileEvent));
  const alreadyOnProfile = $derived(
    !!addressForProfile &&
      existingNip05s.some((a) => a.toLowerCase() === addressForProfile.toLowerCase())
  );
  const showAddToProfile = $derived(
    upstreamMatchesUser && !!addressForProfile && !alreadyOnProfile && !savedLocally
  );
  /** A different nip05 already exists → offer "replace or add" instead of a single CTA. */
  const hasOtherNip05 = $derived(existingNip05s.length > 0);

  // Subscribe to the user's own kind 0 so we know what nip05s (if any) are set.
  $effect(() => {
    const active = manager.active;
    if (!active) return;
    const sub = eventStore.replaceable(0, active.pubkey).subscribe((event) => {
      profileEvent = event || null;
    });
    return () => sub.unsubscribe();
  });

  /**
   * The form lives in a modal shared with the Termi assistant's apply CTA, so
   * both entry points land on the form itself instead of unfolding a second
   * step inside the settings page.
   */
  function openApplyModal() {
    modalStore.openModal('membershipApply');
  }

  /** Replace the primary (content) nip05 with the new address. */
  async function replaceOnProfile() {
    if (!addressForProfile) return;
    addState = 'saving';
    try {
      await actionRunner.run(UpdateProfile, { nip05: addressForProfile });
      addState = 'saved';
      savedLocally = true;
    } catch {
      addState = 'error';
    }
  }

  /** Keep existing address(es), append the new one as an extra nip05 tag. */
  async function addAdditionally() {
    if (!addressForProfile) return;
    addState = 'saving';
    try {
      await actionRunner.run(AddProfileNip05Tag, addressForProfile);
      addState = 'saved';
      savedLocally = true;
    } catch {
      addState = 'error';
    }
  }
</script>

{#if enabled}
  <div class="card bg-base-100 shadow-xl">
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
              {#if hasOtherNip05}
                <span>
                  {m.membership_nip05_replace_or_add_intro({
                    address: addressForProfile,
                    current: existingNip05s.join(', ')
                  })}
                </span>
                <div class="flex flex-wrap items-center gap-2">
                  <button
                    class="btn btn-sm btn-primary"
                    disabled={addState === 'saving'}
                    onclick={replaceOnProfile}
                  >
                    {#if addState === 'saving'}
                      <span class="loading loading-xs loading-spinner"></span>
                    {/if}
                    {m.membership_nip05_replace_cta()}
                  </button>
                  <button
                    class="btn btn-outline btn-sm"
                    disabled={addState === 'saving'}
                    onclick={addAdditionally}
                  >
                    {m.membership_nip05_add_cta()}
                  </button>
                  {#if addState === 'error'}
                    <span class="text-sm text-error">{m.membership_add_to_profile_error()}</span>
                  {/if}
                </div>
              {:else}
                <span>
                  {m.membership_add_to_profile_intro({ address: addressForProfile })}
                </span>
                <div class="flex items-center gap-2">
                  <button
                    class="btn btn-sm btn-primary"
                    disabled={addState === 'saving'}
                    onclick={replaceOnProfile}
                  >
                    {#if addState === 'saving'}
                      <span class="loading loading-xs loading-spinner"></span>
                    {/if}
                    {m.membership_add_to_profile_cta()}
                  </button>
                  {#if addState === 'saved'}
                    <span class="text-sm text-success">{m.membership_add_to_profile_success()}</span
                    >
                  {:else if addState === 'error'}
                    <span class="text-sm text-error">{m.membership_add_to_profile_error()}</span>
                  {/if}
                </div>
              {/if}
            </div>
          </div>
        {/if}

        <div class="mt-4 card-actions">
          <button class="btn btn-ghost" onclick={openApplyModal}>
            {m.membership_already_applied_update()}
          </button>
        </div>
      {:else}
        <div class="card-actions">
          <button class="btn btn-primary" onclick={openApplyModal}>
            {m.membership_apply_cta()}
          </button>
        </div>
      {/if}
    </div>
  </div>
{/if}
