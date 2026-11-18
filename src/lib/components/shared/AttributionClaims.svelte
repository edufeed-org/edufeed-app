<!--
  AttributionClaims — claiming a name-only credit (wiki article
  `edufeed-attribution-claims`). A logged-in reader who is the named person
  sends a claim ("Das bin ich") or withdraws it; the publisher sees the open
  claims and confirms, which re-publishes the content. Renders nothing for
  everyone else: a claim alone never changes what readers see.
  Data model: $lib/helpers/attribution-claims.js
-->

<script>
  import * as m from '$lib/paraglide/messages.js';
  import { resolve } from '$app/paths';
  import { getDisplayName } from 'applesauce-core/helpers';
  import { TimelineModel } from 'applesauce-core/models';
  import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
  import { fetchEvents } from '$lib/loaders/base.js';
  import { useActiveUser } from '$lib/stores/accounts.svelte';
  import { useProfileMap } from '$lib/stores/profile-map.svelte.js';
  import { useAuthorDeletions } from '$lib/stores/author-deletions.svelte.js';
  import { getAMBCreators, getAMBContributors } from '$lib/helpers/educational/ambHelpers.js';
  import {
    CLAIM_KIND,
    CLAIM_NAMESPACE,
    addressOf,
    parseClaim,
    claimStatus
  } from '$lib/helpers/attribution-claims.js';
  import {
    claimRelays,
    publishClaim,
    acceptClaim,
    withdrawClaim
  } from '$lib/helpers/publishAttributionClaim.js';
  import { uniqueBy } from '$lib/helpers/unique.js';
  import { profileLink } from '$lib/helpers/nostrUtils.js';
  import { showToast } from '$lib/helpers/toast.js';
  import ProfileAvatar from './ProfileAvatar.svelte';

  /** @type {{ event: any }} - the content (kind 30142 or 30023) */
  let { event } = $props();

  const getActiveUser = useActiveUser();
  const activeUser = $derived(getActiveUser());

  const address = $derived(addressOf(event));
  // The route's copy does not follow the store; an acceptance must take its
  // claim off the list at once, so the status reads the store's latest version.
  let latest = $state.raw(/** @type {any} */ (undefined));
  const current = $derived(
    latest && addressOf(latest) === address && latest.created_at >= event.created_at
      ? latest
      : event
  );
  const isPublisher = $derived(activeUser?.pubkey === current.pubkey);

  /** @param {string} role */
  function roleLabel(role) {
    return role === 'contributor'
      ? m.amb_resource_role_contributor()
      : m.amb_resource_role_creator();
  }

  /** Name-only credits: what can be claimed. */
  const credits = $derived(
    uniqueBy(
      [
        ...getAMBCreators(current).map((p) => ({ ...p, role: 'creator' })),
        ...getAMBContributors(current).map((p) => ({ ...p, role: 'contributor' }))
      ]
        .filter((p) => p.name && !p.pubkey)
        .map((p) => ({
          role: /** @type {'creator' | 'contributor'} */ (p.role),
          name: /** @type {string} */ (p.name),
          key: `${p.role}:${p.name}`
        })),
      (c) => c.key
    )
  );

  let claimEvents = $state.raw(/** @type {any[]} */ ([]));
  // Without a name-only credit every claim is accepted or outdated: no request.
  const active = $derived(!!activeUser && credits.length > 0);

  $effect(() => {
    if (!active) return;
    const filter = { kinds: [CLAIM_KIND], '#a': [address], '#L': [CLAIM_NAMESPACE] };
    const [kind, pubkey, ...d] = address.split(':');
    const loaderSub = fetchEvents(claimRelays(event), filter).subscribe();
    const modelSub = eventStore.model(TimelineModel, filter).subscribe((events) => {
      claimEvents = events ?? [];
    });
    const latestSub = eventStore.replaceable(Number(kind), pubkey, d.join(':')).subscribe((e) => {
      latest = e;
    });
    return () => {
      loaderSub.unsubscribe();
      modelSub.unsubscribe();
      latestSub.unsubscribe();
      // No state reset here: `active` depends on `latest`, clearing it would
      // re-run this effect forever. Leftovers of another address are ignored.
    };
  });

  /** Open claims, newest first, one per claimant + role + name. */
  const openClaims = $derived(
    uniqueBy(
      claimEvents.flatMap((e) => {
        const claim = parseClaim(e);
        return claim && claimStatus(claim, current) === 'open' ? [{ ...claim, event: e }] : [];
      }),
      (c) => `${c.pubkey}:${c.role}:${c.name}`
    )
  );
  const ownClaim = $derived(openClaims.find((c) => c.pubkey === activeUser?.pubkey));
  const incoming = $derived(
    isPublisher ? openClaims.filter((c) => c.pubkey !== activeUser?.pubkey) : []
  );

  const getProfiles = useProfileMap(() => incoming.map((c) => c.pubkey));
  // Withdrawn claims (NIP-09) only disappear once the claimants' deletions are known.
  useAuthorDeletions(() => claimEvents.map((e) => e.pubkey));

  let modalOpen = $state(false);
  let selectedKey = $state('');
  /** Key of the action in flight: 'send', 'withdraw' or a claim event id. */
  let busy = $state('');
  /** Where the last action failed, same keys as `busy`. */
  let failed = $state('');

  function openModal() {
    selectedKey = credits[0]?.key ?? '';
    failed = '';
    modalOpen = true;
  }

  /**
   * @param {string} key
   * @param {() => Promise<any>} action
   * @returns {Promise<boolean>} whether it succeeded
   */
  async function run(key, action) {
    busy = key;
    failed = '';
    try {
      await action();
      return true;
    } catch (error) {
      console.error('Attribution claim action failed:', error);
      failed = key;
      return false;
    } finally {
      busy = '';
    }
  }

  async function send() {
    const credit = credits.find((c) => c.key === selectedKey);
    if (!credit) return;
    if (await run('send', () => publishClaim(current, credit, activeUser))) {
      modalOpen = false;
      showToast(m.attribution_claim_sent_toast(), 'success');
    }
  }
</script>

{#if active}
  {#if incoming.length > 0}
    <div class="mt-4 space-y-2" data-testid="attribution-claims-incoming">
      <h4 class="text-sm font-medium text-base-content/70">{m.attribution_claims_heading()}</h4>
      <ul class="space-y-2">
        {#each incoming as claim (claim.event.id)}
          <li class="flex flex-wrap items-center gap-2 text-sm">
            <ProfileAvatar
              pubkey={claim.pubkey}
              profile={getProfiles().get(claim.pubkey)}
              size="sm"
              linkToProfile
            />
            <span>
              <a href={resolve(profileLink(claim.pubkey))} class="font-medium hover:underline"
                >{getDisplayName(
                  getProfiles().get(claim.pubkey),
                  claim.pubkey.slice(0, 8) + '…'
                )}</a
              >
              {m.attribution_claim_request({ name: claim.name })}
              <span class="badge badge-outline badge-xs">{roleLabel(claim.role)}</span>
            </span>
            <button
              type="button"
              class="btn btn-sm btn-primary"
              disabled={busy !== ''}
              onclick={() =>
                run(claim.event.id, () => acceptClaim(current, claim.event, activeUser))}
            >
              {#if busy === claim.event.id}
                <span class="loading loading-xs loading-spinner"></span>
              {/if}
              {m.attribution_claim_confirm()}
            </button>
            {#if failed === claim.event.id}
              <span role="alert" class="w-full text-error">{m.attribution_claim_error()}</span>
            {/if}
          </li>
        {/each}
      </ul>
    </div>
  {:else if ownClaim}
    <p class="mt-4 flex flex-wrap items-center gap-2 text-sm" data-testid="attribution-claim-own">
      <span class="text-base-content/70">
        {m.attribution_claim_pending({ name: ownClaim.name })}
      </span>
      <button
        type="button"
        class="btn btn-ghost btn-sm"
        disabled={busy !== ''}
        onclick={() => run('withdraw', () => withdrawClaim(ownClaim.event, activeUser, current))}
      >
        {#if busy === 'withdraw'}
          <span class="loading loading-xs loading-spinner"></span>
        {/if}
        {m.attribution_claim_withdraw()}
      </button>
      {#if failed === 'withdraw'}
        <span role="alert" class="w-full text-error">{m.attribution_claim_error()}</span>
      {/if}
    </p>
  {:else if !isPublisher}
    <button type="button" class="btn mt-4 btn-ghost btn-sm" onclick={openModal}>
      {m.attribution_claim_button()}
    </button>
  {/if}

  {#if modalOpen}
    <div class="modal-open modal" role="dialog" aria-modal="true" aria-labelledby="claim-title">
      <div class="modal-box max-w-sm">
        <h3 id="claim-title" class="text-lg font-bold">{m.attribution_claim_button()}</h3>
        {#if credits.length > 1}
          <fieldset class="mt-4 flex flex-col gap-2">
            <legend class="mb-2 text-sm text-base-content/70">
              {m.attribution_claim_choose()}
            </legend>
            {#each credits as credit (credit.key)}
              <label class="flex cursor-pointer items-center gap-2">
                <input
                  type="radio"
                  class="radio radio-sm"
                  name="attribution-claim-credit"
                  value={credit.key}
                  bind:group={selectedKey}
                />
                <span>{credit.name}</span>
                <span class="badge badge-outline badge-xs">{roleLabel(credit.role)}</span>
              </label>
            {/each}
          </fieldset>
        {:else if credits[0]}
          <p class="mt-4 flex items-center gap-2 font-medium">
            {credits[0].name}
            <span class="badge badge-outline badge-xs">{roleLabel(credits[0].role)}</span>
          </p>
        {/if}
        <p class="mt-4 text-sm text-base-content/70">{m.attribution_claim_explain()}</p>
        {#if failed === 'send'}
          <div role="alert" class="mt-4 alert text-sm alert-error">
            {m.attribution_claim_error()}
          </div>
        {/if}
        <div class="modal-action">
          <button
            type="button"
            class="btn btn-ghost"
            disabled={busy === 'send'}
            onclick={() => (modalOpen = false)}
          >
            {m.common_cancel()}
          </button>
          <button type="button" class="btn btn-primary" disabled={busy === 'send'} onclick={send}>
            {#if busy === 'send'}
              <span class="loading loading-xs loading-spinner"></span>
            {/if}
            {m.attribution_claim_send()}
          </button>
        </div>
      </div>
    </div>
  {/if}
{/if}
