<script>
  import * as m from '$lib/paraglide/messages';
  import { manager } from '$lib/stores/accounts.svelte';
  import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
  import { runtimeConfig } from '$lib/stores/config.svelte.js';
  import { publishEvent } from '$lib/services/publish-service.js';
  import { createAppEventFactory } from '$lib/helpers/event-factory.js';
  import { addressLoader } from '$lib/loaders/base.js';
  import { getCommunikeyRelays } from '$lib/helpers/relay-helper.js';
  import { buildResponseTags, buildUserResponseFilter } from '$lib/helpers/forms.js';
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
  const adminPubkey = $derived(cfg?.adminPubkeys?.[0] || '');
  const handleDomain = $derived(cfg?.handleDomain || '');

  /** @type {import('nostr-tools').NostrEvent | null} */
  let formEvent = $state(null);
  let isLoading = $state(true);
  let isSubmitting = $state(false);
  let submitted = $state(false);
  let error = $state('');

  /** @type {{ kind: number, pubkey: string, tags: string[][], content: string, created_at: number, id: string, sig: string } | null} */
  let existingResponse = $state(null);

  let wishedHandle = $state('');
  /** @type {'idle' | 'checking' | 'available' | 'taken' | 'invalid'} */
  let handleStatus = $state('idle');
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let debounceTimer;
  /** @type {AbortController | undefined} */
  let activeCheck;

  // Load the form template (kind 30168) from communikey relays
  $effect(() => {
    if (!adminPubkey) {
      isLoading = false;
      return;
    }
    const relays = getCommunikeyRelays();
    const loaderSub = addressLoader({
      kind: 30168,
      pubkey: adminPubkey,
      identifier: 'edufeed-membership',
      relays
    }).subscribe();

    const modelSub = eventStore
      .replaceable(30168, adminPubkey, 'edufeed-membership')
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
    if (!manager.active || !formEvent || !adminPubkey || !formAddress) return;
    if (handleStatus === 'taken' || handleStatus === 'invalid') return;

    isSubmitting = true;
    error = '';
    try {
      const responseTags = buildResponseTags(values);

      /** @type {string[][]} */
      const tags = [
        ['a', formAddress],
        ['p', adminPubkey]
      ];

      let content = '';
      const signer = manager.active.signer;
      if (signer?.nip44Encrypt) {
        const plaintext = JSON.stringify(responseTags);
        content = await signer.nip44Encrypt(adminPubkey, plaintext);
        tags.push(['encrypted']);
      } else {
        tags.push(...responseTags);
      }

      const factory = createAppEventFactory({ signer });
      const template = await factory.build({ kind: 1069, tags, content });
      const signed = await factory.sign(template);
      await publishEvent(signed, [adminPubkey]);
      eventStore.add(signed);

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
  $effect(() => {
    if (!formEvent) return;
    const el = document.getElementById('wished_handle');
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
  // styling and the sibling status element's text. Reads handleStatus +
  // wishedHandle so Svelte re-runs whenever either changes.
  $effect(() => {
    const el = /** @type {HTMLInputElement | null} */ (document.getElementById('wished_handle'));
    if (!el) return;
    const statusEl = /** @type {HTMLElement | null} */ (
      el.nextElementSibling instanceof HTMLElement &&
      el.nextElementSibling.dataset?.testid === 'wished-handle-status'
        ? el.nextElementSibling
        : null
    );

    const isError = handleStatus === 'invalid' || handleStatus === 'taken';
    el.classList.toggle('input-error', isError);
    if (isError) el.setAttribute('aria-invalid', 'true');
    else el.removeAttribute('aria-invalid');

    if (!statusEl) return;
    if (!wishedHandle) {
      statusEl.textContent = '';
      statusEl.className = 'mt-1 text-sm';
      return;
    }
    if (handleStatus === 'checking') {
      statusEl.textContent = m.membership_handle_checking();
      statusEl.className = 'mt-1 text-sm text-base-content/60';
    } else if (handleStatus === 'available') {
      statusEl.textContent = `✓ ${m.membership_handle_available()} — ${m.membership_handle_preview({ handle: wishedHandle, domain: handleDomain })}`;
      statusEl.className = 'mt-1 text-sm text-success';
    } else if (handleStatus === 'taken') {
      statusEl.textContent = `✗ ${m.membership_handle_taken()}`;
      statusEl.className = 'mt-1 text-sm text-error';
    } else if (handleStatus === 'invalid') {
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
{:else if formEvent}
  {#if showHeader && existingResponse}
    <div class="mb-4 alert alert-info">
      {m.membership_already_applied({
        date: formatTimestamp(existingResponse.created_at)
      })}
    </div>
  {/if}

  <FormRenderer {formEvent} onsubmit={handleSubmit} />

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
