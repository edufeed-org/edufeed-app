<script>
  import { page } from '$app/stores';
  import { manager } from '$lib/stores/accounts.svelte';
  import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
  import { publishEvent } from '$lib/services/publish-service.js';
  import { joinCommunity } from '$lib/helpers/community';
  import { createAppEventFactory } from '$lib/helpers/event-factory.js';
  import { addressLoader, timedPool } from '$lib/loaders/base.js';
  import { getCommunikeyRelays } from '$lib/helpers/relay-helper.js';
  import {
    buildResponseTags,
    decodeFormNaddr,
    buildUserResponseFilter,
    parseFormTemplate,
    nip44EncryptWith,
    signerHasNip44
  } from '$lib/helpers/forms.js';
  import {
    isCommunityApplication,
    resolveReviewers,
    buildApplicationCopies
  } from '$lib/helpers/community-application.js';
  import { createTimelineLoader } from 'applesauce-loaders/loaders';
  import FormRenderer from '$lib/components/forms/FormRenderer.svelte';
  import * as m from '$lib/paraglide/messages';

  /** @type {{ data: { naddr: string } }} */
  let { data } = $props();

  let formEvent = $state(/** @type {import('nostr-tools').NostrEvent | null} */ (null));
  let isLoading = $state(true);
  let error = $state('');
  let isSubmitting = $state(false);
  let submitted = $state(false);
  let alreadyResponded = $state(false);
  // Set when a community application copy reached some root-group reviewers
  // but not all. Not an error — any one reviewer can act on it, mirroring
  // MembershipApplicationForm's partialDelivery — but the applicant should
  // know review may be slower than usual.
  let partialDelivery = $state(/** @type {{ delivered: number, total: number } | null} */ (null));

  /** @type {{ pubkey: string, identifier: string } | null} */
  let decodedForm = $state(null);
  /** @type {import('nostr-tools').NostrEvent | null} */
  let communityEvent = $state(null);

  let returnTo = $derived($page.url.searchParams.get('returnTo'));
  let communityId = $derived($page.url.searchParams.get('communityId'));
  let parsedTemplate = $derived(formEvent ? parseFormTemplate(formEvent) : null);

  // Decode naddr and load form template
  $effect(() => {
    const decoded = decodeFormNaddr(data.naddr);
    if (decoded.error) {
      error = decoded.error;
      isLoading = false;
      return;
    }

    const pubkey = /** @type {string} */ (decoded.pubkey);
    const identifier = /** @type {string} */ (decoded.identifier);
    decodedForm = { pubkey, identifier };

    const relays = getCommunikeyRelays();
    const loaderSub = addressLoader({ kind: 30168, pubkey, identifier, relays }).subscribe();

    /** @type {import('rxjs').Subscription | undefined} */
    let modelSub;
    modelSub = eventStore.replaceable(30168, pubkey, identifier).subscribe((event) => {
      if (event) {
        formEvent = event;
        isLoading = false;
      }
    });

    return () => {
      loaderSub.unsubscribe();
      modelSub?.unsubscribe();
    };
  });

  // Load the community's kind:10222 event when this form was reached via a
  // community join flow (?communityId=) — needed to decide whether this
  // form IS the community's own application (isCommunityApplication) and,
  // if so, to resolve its reviewers (resolveReviewers reads the membership
  // pointer off this event). Every other path (legacy forms, the deployment
  // membership form) never sets communityId or never matches, so formEvent
  // stays the only dependency for those.
  $effect(() => {
    if (!communityId) {
      communityEvent = null;
      return;
    }
    const pointer = { kind: 10222, pubkey: communityId };
    const relays = getCommunikeyRelays();
    const loaderSub = addressLoader({ ...pointer, relays }).subscribe();
    const modelSub = eventStore.replaceable(pointer).subscribe((event) => {
      communityEvent = event || null;
    });

    return () => {
      loaderSub.unsubscribe();
      modelSub.unsubscribe();
    };
  });

  // Check if user already submitted a response
  $effect(() => {
    if (!decodedForm || !manager.active) return;

    const formAddress = `30168:${decodedForm.pubkey}:${decodedForm.identifier}`;
    const filter = buildUserResponseFilter(formAddress, manager.active.pubkey);
    const relays = getCommunikeyRelays();

    const loaderSub = createTimelineLoader(timedPool, relays, filter, {
      eventStore,
      limit: 1
    })().subscribe();

    const modelSub = eventStore.timeline(filter).subscribe((events) => {
      if (events && events.length > 0) {
        alreadyResponded = true;
      }
    });

    return () => {
      loaderSub.unsubscribe();
      modelSub.unsubscribe();
    };
  });

  /** @param {Record<string, string>} values */
  async function handleSubmit(values) {
    if (!manager.active || !formEvent || !decodedForm) return;

    isSubmitting = true;
    error = '';
    partialDelivery = null;

    try {
      const { pubkey: creatorPubkey, identifier } = decodedForm;
      const formAddress = `30168:${creatorPubkey}:${identifier}`;

      // A community's own application form — reached via ?communityId= and
      // whose `application` pointer resolves to this exact address — fans
      // out to one NIP-44 copy per root-group reviewer (39001 admins)
      // instead of the single copy to the form author below. Every other
      // case (legacy public/private forms, the deployment-wide membership
      // form, or a communityId that just hasn't loaded its 10222 yet) keeps
      // the original single-copy path byte-identical.
      if (communityId && isCommunityApplication(formAddress, communityEvent)) {
        const reviewers = await resolveReviewers(communityEvent);
        const copies = await buildApplicationCopies({
          formAddress,
          values,
          signer: manager.active.signer,
          reviewers
        });

        // allSettled, not all: one reviewer's relay outcome must not cancel
        // another's, and any single reviewer seeing the application is
        // enough to promise review — mirrors MembershipApplicationForm.
        const results = await Promise.allSettled(
          copies.map((copy, i) => publishEvent(copy, [reviewers[i]]))
        );
        const delivered = results.filter(
          (r) => r.status === 'fulfilled' && r.value?.success
        ).length;

        if (delivered === 0) throw new Error(m.forms_submit_failed());
        if (delivered < copies.length) {
          partialDelivery = { delivered, total: copies.length };
        }

        // Mirror into the local store only for copies that actually landed.
        results.forEach((r, i) => {
          if (r.status === 'fulfilled' && r.value?.success) eventStore.add(copies[i]);
        });
      } else {
        const responseTags = buildResponseTags(values);
        const isPublic = !!parsedTemplate?.isPublic;

        /** @type {string[][]} */
        const tags = [
          ['a', formAddress],
          ['p', creatorPubkey]
        ];

        let content = '';

        if (isPublic) {
          tags.push(...responseTags);
        } else {
          // Encrypt response tags with NIP-44
          const plaintext = JSON.stringify(responseTags);
          content = await nip44EncryptWith(manager.active.signer, creatorPubkey, plaintext);
          tags.push(['encrypted']);
        }

        const factory = createAppEventFactory({ signer: manager.active.signer });
        const template = await factory.build({ kind: 1069, tags, content });
        const signed = await factory.sign(template);
        await publishEvent(signed);
        eventStore.add(signed);
      }

      // Auto-join community if this form was reached via join flow
      if (communityId) {
        await joinCommunity(communityId).catch((err) =>
          console.error('Auto-join after form submit failed:', err)
        );
      }

      submitted = true;
    } catch (err) {
      // resolveReviewers' typed error gets a dedicated message; everything
      // else falls back to the error's own message or the generic one.
      if (/** @type {any} */ (err)?.code === 'no-reviewers') {
        error = m.form_respond_no_reviewers();
      } else {
        error = err instanceof Error ? err.message : m.forms_submit_failed();
      }
    } finally {
      isSubmitting = false;
    }
  }
</script>

<div class="container mx-auto max-w-2xl p-4">
  {#if isLoading}
    <div class="flex justify-center p-8">
      <span class="loading loading-lg loading-spinner"></span>
    </div>
  {:else if error}
    <div class="alert alert-error">{error}</div>
  {:else if !manager.active}
    <div class="alert alert-warning">{m.forms_submit_login_required()}</div>
  {:else if formEvent && !parsedTemplate?.isPublic && !signerHasNip44(manager.active?.signer)}
    <div class="alert alert-warning">
      {m.forms_submit_no_encryption()}
    </div>
  {:else if alreadyResponded && !submitted}
    <div class="mb-4 alert alert-warning">{m.forms_already_responded()}</div>
    {#if returnTo}
      <a href={returnTo} class="btn btn-primary">{m.forms_back_to_community()}</a>
    {:else}
      <button class="btn btn-primary" onclick={() => history.back()}>{m.forms_go_back()}</button>
    {/if}
  {:else if submitted}
    <div class="mb-4 alert alert-success">
      {parsedTemplate?.confirmationMessage || m.forms_submit_success()}
    </div>
    {#if partialDelivery}
      <div class="mb-4 alert alert-warning" data-testid="community-application-partial-delivery">
        {m.membership_submit_partial({
          delivered: partialDelivery.delivered,
          total: partialDelivery.total
        })}
      </div>
    {/if}
    {#if returnTo}
      <a href={returnTo} class="btn btn-primary">{m.forms_back_to_community()}</a>
    {:else}
      <button class="btn btn-primary" onclick={() => history.back()}>{m.forms_go_back()}</button>
    {/if}
  {:else if formEvent}
    {#if isSubmitting}
      <div class="flex justify-center p-8">
        <span class="loading loading-lg loading-spinner"></span>
      </div>
    {:else}
      <FormRenderer {formEvent} onsubmit={handleSubmit} />
    {/if}
  {/if}
</div>
