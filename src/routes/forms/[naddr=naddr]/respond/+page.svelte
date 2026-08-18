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
  // Distinct from `error`: `error` drives the top-level {:else if error}
  // ladder branch, which replaces the ENTIRE page (including the form) with
  // a bare alert — correct for pre-submit load failures (bad naddr, no
  // template found), where there is no form to preserve. A submit-time
  // failure happens AFTER the applicant has typed into the form, so it must
  // render above the still-mounted FormRenderer instead of tearing the
  // whole page down and losing their input.
  let submitError = $state('');
  /** @type {{ pubkey: string, identifier: string } | null} */
  let decodedForm = $state(null);

  let returnTo = $derived($page.url.searchParams.get('returnTo'));
  // Still set by legacy gated-section links (AccessGateBanner) — drives the
  // kind-30000 auto-join after submit, nothing else.
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
    // FormRenderer stays mounted (and its Submit button clickable) through
    // an in-flight submission, so typed input survives a submit-time error.
    // That trades away the old "submit button disappears while sending"
    // affordance for a double-click guard here instead.
    if (isSubmitting || !manager.active || !formEvent || !decodedForm) return;

    isSubmitting = true;
    submitError = '';

    try {
      const { pubkey: creatorPubkey, identifier } = decodedForm;
      const formAddress = `30168:${creatorPubkey}:${identifier}`;

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

      // Auto-join community if this form was reached via join flow
      if (communityId) {
        await joinCommunity(communityId).catch((err) =>
          console.error('Auto-join after form submit failed:', err)
        );
      }

      submitted = true;
    } catch (err) {
      submitError = err instanceof Error ? err.message : m.forms_submit_failed();
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
    {#if returnTo}
      <a href={returnTo} class="btn btn-primary">{m.forms_back_to_community()}</a>
    {:else}
      <button class="btn btn-primary" onclick={() => history.back()}>{m.forms_go_back()}</button>
    {/if}
  {:else if formEvent}
    {#if submitError}
      <div class="mb-4 alert alert-error" data-testid="form-respond-submit-error">
        {submitError}
      </div>
    {/if}
    <!-- Stays mounted through an in-flight submit (isSubmitting no longer
         swaps this out for a spinner) so typed input survives a
         submit-time error instead of being wiped by an unmount/remount. -->
    <FormRenderer {formEvent} onsubmit={handleSubmit} />
    {#if isSubmitting}
      <div class="mt-2 flex justify-center">
        <span class="loading loading-sm loading-spinner"></span>
      </div>
    {/if}
  {/if}
</div>
