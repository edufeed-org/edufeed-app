<script>
  import * as m from '$lib/paraglide/messages';
  import { manager } from '$lib/stores/accounts.svelte';
  import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
  import { runtimeConfig } from '$lib/stores/config.svelte.js';
  import { buildATagWithHint, buildPTagsWithHints } from '$lib/services/publish-service.js';
  import {
    publishApplicationCopy,
    ensureApplicantRelayLists
  } from '$lib/services/membership-publish.js';
  import { createAppEventFactory } from '$lib/helpers/event-factory.js';
  import { addressLoader } from '$lib/loaders/base.js';
  import { getCommunikeyRelays } from '$lib/helpers/relay-helper.js';
  import {
    buildResponseTags,
    buildUserResponseFilter,
    parseResponseTags,
    nip44EncryptWith,
    nip44DecryptWith,
    signerHasNip44,
    signerCanNip44Encrypt
  } from '$lib/helpers/forms.js';
  import FormRenderer from '$lib/components/forms/FormRenderer.svelte';
  import { formatTimestamp } from '$lib/helpers/dates.js';

  /**
   * @type {{
   *   onsubmitted?: () => void,
   *   showHeader?: boolean
   * }}
   */
  let { onsubmitted, showHeader = true } = $props();

  const HANDLE_PATTERN = /^[a-z0-9._-]+$/;
  const DEBOUNCE_MS = 400;

  const cfg = $derived(runtimeConfig.membership);
  const formAddress = $derived(cfg?.formAddress || '');
  const adminPubkeys = $derived(cfg?.adminPubkeys || []);
  // The kind 30168 template author is embedded in the form address
  // (30168:pubkey:d-tag) — independent of the admin list's order.
  const formAuthorPubkey = $derived(formAddress.split(':')[1] || adminPubkeys[0] || '');
  // d-tags may themselves contain colons, so rejoin everything after the pubkey.
  const formIdentifier = $derived(
    formAddress.split(':').slice(2).join(':') || 'edufeed-membership'
  );
  const handleDomain = $derived(cfg?.handleDomain || '');

  /** @type {import('nostr-tools').NostrEvent | null} */
  let formEvent = $state(null);
  let isLoading = $state(true);
  let isSubmitting = $state(false);
  let submitted = $state(false);
  let error = $state('');
  // Set when the application reached some admins but not all. Not an error —
  // any one admin can act on it — but the applicant should know the review may
  // be slower than usual rather than be told everything went perfectly.
  let partialDelivery = $state(/** @type {{ delivered: number, total: number } | null} */ (null));

  /** @type {{ kind: number, pubkey: string, tags: string[][], content: string, created_at: number, id: string, sig: string } | null} */
  let existingResponse = $state(null);

  /**
   * Decrypted values from the user's previous application, used to pre-fill
   * the form when they choose "Update application". null while loading; an
   * empty object means decrypt failed (FormRenderer falls back to empty).
   *
   * @type {Record<string, string> | null}
   */
  let prefilledValues = $state(null);

  let wishedHandle = $state('');
  /** @type {'idle' | 'checking' | 'available' | 'taken' | 'invalid'} */
  let handleStatus = $state('idle');
  /**
   * Wrapper around FormRenderer, bound so the DOM-syncing effects below get a
   * reactive "the form is actually in the DOM now" signal and stay scoped to
   * this component instance.
   * @type {HTMLElement | undefined}
   */
  let formContainer = $state();
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let debounceTimer;
  /** @type {AbortController | undefined} */
  let activeCheck;

  // Load the form template (kind 30168) from communikey relays
  $effect(() => {
    if (!formAuthorPubkey) {
      isLoading = false;
      return;
    }
    const relays = getCommunikeyRelays();
    const loaderSub = addressLoader({
      kind: 30168,
      pubkey: formAuthorPubkey,
      identifier: formIdentifier,
      relays
    }).subscribe();

    const modelSub = eventStore
      .replaceable(30168, formAuthorPubkey, formIdentifier)
      .subscribe((event) => {
        if (event) {
          formEvent = event;
          isLoading = false;
        }
      });

    return () => {
      loaderSub.unsubscribe();
      modelSub.unsubscribe();
    };
  });

  // Check for existing response from the active user
  $effect(() => {
    if (!manager.active || !formAddress) return;
    const filter = buildUserResponseFilter(formAddress, manager.active.pubkey);
    const sub = eventStore.timeline(filter).subscribe((events) => {
      existingResponse = events?.[0] || null;
    });
    return () => sub.unsubscribe();
  });

  // Decrypt the previous response so "Update application" pre-fills the form.
  // NIP-44 ECDH is symmetric — the applicant can decrypt their own response
  // using the admin pubkey on the other side of the shared secret.
  $effect(() => {
    const active = manager.active;
    const response = existingResponse;
    if (!response || !active) {
      prefilledValues = null;
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const isEncrypted = response.tags.some((t) => t[0] === 'encrypted');
        /** @type {string[][]} */
        let tags;
        if (isEncrypted) {
          if (!signerHasNip44(active.signer)) {
            prefilledValues = {};
            return;
          }
          // Each copy is encrypted to the admin in its own p-tag — with several
          // admins there is no single `adminPubkey` to decrypt against, and
          // guessing the wrong one just fails to decrypt.
          const counterparty =
            response.tags.find((t) => t[0] === 'p')?.[1] || adminPubkeys[0] || '';
          // Via the forms helper, which is the convention across every forms
          // call site. Not a portability fix: every applesauce signer that has
          // a flat nip44Decrypt also binds it into the nested namespace, and
          // ExtensionSigner exposes only the nested one.
          const plaintext = await nip44DecryptWith(active.signer, counterparty, response.content);
          tags = JSON.parse(plaintext);
        } else {
          tags = response.tags.filter((t) => t[0] === 'response');
        }
        if (cancelled) return;
        const values = parseResponseTags(tags);
        prefilledValues = values;
        // Seed wishedHandle so the live status check reflects the pre-filled
        // value without waiting for the user to retype.
        if (typeof values?.wished_handle === 'string') {
          scheduleHandleCheck(values.wished_handle.trim().toLowerCase());
        }
      } catch {
        if (!cancelled) prefilledValues = {};
      }
    })();
    return () => {
      cancelled = true;
    };
  });

  /**
   * @param {string} value
   */
  function scheduleHandleCheck(value) {
    if (debounceTimer) clearTimeout(debounceTimer);
    activeCheck?.abort();

    wishedHandle = value;
    if (!value) {
      handleStatus = 'idle';
      return;
    }
    if (!HANDLE_PATTERN.test(value)) {
      handleStatus = 'invalid';
      return;
    }

    handleStatus = 'checking';
    debounceTimer = setTimeout(async () => {
      const controller = new AbortController();
      activeCheck = controller;
      try {
        const url = `https://${handleDomain}/.well-known/nostr.json?name=${encodeURIComponent(value)}`;
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) {
          // Treat error responses as "unknown" but lean to available
          handleStatus = 'available';
          return;
        }
        const data = await res.json().catch(() => ({ names: {} }));
        const taken = !!data?.names?.[value];
        handleStatus = taken ? 'taken' : 'available';
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        // Network errors don't block submit
        handleStatus = 'available';
      }
    }, DEBOUNCE_MS);
  }

  /** @param {Event} ev */
  function onWishedHandleInput(ev) {
    const target = /** @type {HTMLInputElement} */ (ev.target);
    scheduleHandleCheck(target.value.trim().toLowerCase());
  }

  /** @param {Record<string, string>} values */
  async function handleSubmit(values) {
    if (!manager.active || !formEvent || !adminPubkeys.length || !formAddress) return;
    if (handleStatus === 'taken' || handleStatus === 'invalid') return;

    isSubmitting = true;
    error = '';
    try {
      const responseTags = buildResponseTags(values);
      const signer = manager.active.signer;
      // Applications carry name, affiliation and motivation — never publish
      // them in the clear. Without NIP-44 we abort instead of downgrading.
      //
      // signerCanNip44Encrypt, not signerHasNip44: that one asks whether the
      // signer can *decrypt*, which is the right question at the prefill site
      // above and the wrong one here. A decrypt-only signer would sail past it
      // and throw halfway through the submit.
      if (!signerCanNip44Encrypt(signer)) {
        error = m.membership_submit_encryption_unavailable();
        return;
      }
      // The single-admin tag/encrypt pair that used to sit here now happens
      // once per admin below — NIP-44 is pairwise, so there is no one
      // ciphertext or one p-tag that serves them all.

      const factory = createAppEventFactory({ signer });

      // An approval is answered with a NIP-17 DM, and everything else about
      // the applicant routes via NIP-65. Settle both lists before the
      // application exists, so an admin can never approve someone the reply
      // cannot reach. Never throws — see membership-publish.js.
      //
      // These three resolve relay hints for disjoint pubkeys — the applicant,
      // the form author, the admins — so nothing here reads what another
      // writes. Run together: each can sit out an 8s relay-lookup timeout, and
      // serialized that is three of them before the form even starts signing.
      const [, aTag, pTags] = await Promise.all([
        ensureApplicantRelayLists(),
        buildATagWithHint(formAddress),
        buildPTagsWithHints(adminPubkeys)
      ]);

      // NIP-44 is pairwise, so there is one copy per admin — each encrypted to
      // (and p-tagged with) its own recipient. Signing stays sequential: it is
      // local work, and some signers (NIP-07 extensions) serialize requests
      // anyway. Every copy is signed before any is published, so a failure
      // while encrypting cannot leave one admin holding an application.
      /** @type {import('nostr-tools').NostrEvent[]} */
      const signedCopies = [];
      for (const pTag of pTags) {
        const admin = pTag[1];
        /** @type {string[][]} */
        const tags = [aTag, pTag];

        const content = await nip44EncryptWith(signer, admin, JSON.stringify(responseTags));
        tags.push(['encrypted']);

        const template = await factory.build({ kind: 1069, tags, content });
        signedCopies.push(await factory.sign(template));
      }

      // Publish the copies together rather than one after another. Sequentially,
      // the first admin's relays failing meant the rest were never even tried,
      // and anything that killed the page mid-loop left admin 1 holding an
      // application admin 2 never saw. allSettled, not all: one admin's outcome
      // must not cancel another's, and we need every result to report on.
      // Scoped publisher, not the outbox model — an application must not be
      // fanned out to the applicant's public write relays.
      const results = await Promise.allSettled(signedCopies.map((s) => publishApplicationCopy(s)));
      const delivered = results.filter((r) => r.status === 'fulfilled' && r.value?.success).length;

      // Any single admin can act on an application, so one copy landing is
      // enough to promise "we will be in touch". Zero is not: no admin would
      // ever see it, and saying otherwise strands the applicant for good.
      if (delivered === 0) throw new Error(m.membership_submit_failed());
      if (delivered < signedCopies.length) {
        // Reachable, but not by everyone. Say so rather than report a clean
        // success — approvals may sit until the admin who has it looks.
        console.warn(`[membership] application reached ${delivered}/${signedCopies.length} admins`);
        partialDelivery = { delivered, total: signedCopies.length };
      }

      // Mirror into the local store only after the publishes have settled — an
      // earlier add flips the "existing response" UI while the submit is still
      // running. Only the copies that actually landed somewhere.
      results.forEach((r, i) => {
        if (r.status === 'fulfilled' && r.value?.success) eventStore.add(signedCopies[i]);
      });

      submitted = true;
      onsubmitted?.();
    } catch (err) {
      error = err instanceof Error ? err.message : m.membership_submit_failed();
    } finally {
      isSubmitting = false;
    }
  }

  // The membership-specific live availability/format checks live next to a
  // generic FormRenderer field, so we sync into the DOM directly:
  //   1) listen for input events on `#wished_handle`,
  //   2) toggle `input-error` + `aria-invalid` on the input itself,
  //   3) insert a sibling status element right below the input so the feedback
  //      appears next to the field rather than at the bottom of the form.
  // Both effects key off `formContainer` (bound when FormRenderer mounts) —
  // an unkeyed getElementById lookup can run before the form's DOM exists and,
  // via the early return, capture no dependencies and never re-run.
  $effect(() => {
    const el = formContainer?.querySelector('#wished_handle');
    if (!el) return;
    const handler = /** @type {EventListener} */ (
      (ev) => onWishedHandleInput(/** @type {Event} */ (ev))
    );
    el.addEventListener('input', handler);

    const statusEl = document.createElement('div');
    statusEl.dataset.testid = 'wished-handle-status';
    statusEl.className = 'mt-1 text-sm';
    el.insertAdjacentElement('afterend', statusEl);

    return () => {
      el.removeEventListener('input', handler);
      statusEl.remove();
      el.classList.remove('input-error');
      el.removeAttribute('aria-invalid');
    };
  });

  // Reactively reflect handleStatus / wishedHandle into the input's error
  // styling and the sibling status element's text. Reads its reactive deps
  // before the early return so the effect re-runs once the form is in the DOM.
  $effect(() => {
    const status = handleStatus;
    const handle = wishedHandle;
    const el = /** @type {HTMLInputElement | null} */ (
      formContainer?.querySelector('#wished_handle') ?? null
    );
    if (!el) return;
    const statusEl = /** @type {HTMLElement | null} */ (
      el.nextElementSibling instanceof HTMLElement &&
      el.nextElementSibling.dataset?.testid === 'wished-handle-status'
        ? el.nextElementSibling
        : null
    );

    const isError = status === 'invalid' || status === 'taken';
    el.classList.toggle('input-error', isError);
    if (isError) el.setAttribute('aria-invalid', 'true');
    else el.removeAttribute('aria-invalid');

    if (!statusEl) return;
    if (!handle) {
      statusEl.textContent = '';
      statusEl.className = 'mt-1 text-sm';
      return;
    }
    if (status === 'checking') {
      statusEl.textContent = m.membership_handle_checking();
      statusEl.className = 'mt-1 text-sm text-base-content/60';
    } else if (status === 'available') {
      statusEl.textContent = `✓ ${m.membership_handle_available()} — ${m.membership_handle_preview({ handle, domain: handleDomain })}`;
      statusEl.className = 'mt-1 text-sm text-success';
    } else if (status === 'taken') {
      statusEl.textContent = `✗ ${m.membership_handle_taken()}`;
      statusEl.className = 'mt-1 text-sm text-error';
    } else if (status === 'invalid') {
      statusEl.textContent = m.membership_handle_invalid();
      statusEl.className = 'mt-1 text-sm text-error';
    } else {
      statusEl.textContent = '';
      statusEl.className = 'mt-1 text-sm';
    }
  });
</script>

{#if isLoading}
  <div class="flex justify-center p-8">
    <span class="loading loading-lg loading-spinner"></span>
  </div>
{:else if !manager.active}
  <div class="alert alert-warning">{m.membership_submit_login_required()}</div>
{:else if submitted}
  <div class="alert alert-success">{m.membership_submit_success()}</div>
  {#if partialDelivery}
    <div class="mt-2 alert alert-warning" data-testid="membership-partial-delivery">
      {m.membership_submit_partial({
        delivered: partialDelivery.delivered,
        total: partialDelivery.total
      })}
    </div>
  {/if}
{:else if formEvent}
  {#if showHeader && existingResponse}
    <div class="mb-4 alert alert-info">
      {m.membership_already_applied({
        date: formatTimestamp(existingResponse.created_at)
      })}
    </div>
  {/if}

  <!-- Block render until the previous response is decrypted so FormRenderer's
       one-shot init picks up the pre-fill. -->
  {#if existingResponse && prefilledValues === null}
    <div class="flex justify-center p-4">
      <span class="loading loading-spinner"></span>
    </div>
  {:else}
    <div bind:this={formContainer}>
      <FormRenderer
        {formEvent}
        onsubmit={handleSubmit}
        initialValues={prefilledValues ?? undefined}
      />
    </div>
  {/if}

  {#if error}
    <div class="mt-2 alert alert-error">{error}</div>
  {/if}

  {#if isSubmitting}
    <div class="mt-2 flex justify-center">
      <span class="loading loading-spinner"></span>
      <span class="ml-2">{m.membership_submit_sending()}</span>
    </div>
  {/if}
{/if}
