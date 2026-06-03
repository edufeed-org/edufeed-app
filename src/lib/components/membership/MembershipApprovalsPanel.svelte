<script>
  /**
   * Admin-only approvals panel.
   *
   * Lists kind 1069 membership applications and offers Approve / Reject /
   * Revoke actions. Renders each pending application as a single self-contained
   * card (applicant identity + form values + actions) so the admin doesn't
   * have to cross-reference a separate response list — that was confusing
   * when both surfaces grew. Already-approved handles render as a compact
   * summary list below.
   *
   * Provisioning goes through the SvelteKit `/api/nip05` proxy: the admin
   * signs a NIP-98 header, the proxy verifies it and forwards to the
   * standalone nip-05-service with the server-held Bearer token.
   */
  import { TimelineModel } from 'applesauce-core/models';
  import { manager } from '$lib/stores/accounts.svelte';
  import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
  import { runtimeConfig } from '$lib/stores/config.svelte.js';
  import { formResponseLoader } from '$lib/loaders/community.js';
  import { parseResponseTags, parseFormTemplate } from '$lib/helpers/forms.js';
  import { createNIP98AuthHeader } from '$lib/helpers/nip98.js';
  import { actionRunnerOptimistic } from '$lib/stores/action-runner.svelte.js';
  import { SendWrappedMessage } from 'applesauce-actions/actions';
  import { useProfileMap } from '$lib/stores/profile-map.svelte.js';
  import { formatTimestamp } from '$lib/helpers/dates.js';
  import ProfileAvatar from '$lib/components/shared/ProfileAvatar.svelte';
  import { ChevronDownIcon, ChevronUpIcon } from '$lib/components/icons';
  import { SvelteSet } from 'svelte/reactivity';
  import { nip19 } from 'nostr-tools';
  import * as m from '$lib/paraglide/messages';

  /**
   * @type {{
   *   formEvent: { kind: number, pubkey: string, tags: string[][], content: string, created_at: number } | null
   * }}
   */
  let { formEvent } = $props();
  const parsedTemplate = $derived(formEvent ? parseFormTemplate(formEvent) : { fields: [] });

  const cfg = $derived(runtimeConfig.membership);
  const formAddress = $derived(cfg?.formAddress || '');
  const adminPubkey = $derived(cfg?.adminPubkeys?.[0] || '');
  const handleDomain = $derived(cfg?.handleDomain || '');

  /** @type {import('nostr-tools').NostrEvent[]} */
  let responses = $state.raw([]);

  /** @type {Map<string, {wished_handle?: string, full_name?: string} & Record<string, string>>} */
  let decrypted = $state.raw(new Map());

  /** Approval state per response id: 'idle' | 'pending' | 'approved' | error message */
  /** @type {Map<string, string>} */
  let approvalState = $state.raw(new Map());

  /**
   * Locally-persisted set of response IDs the admin has rejected. Scoped per
   * admin pubkey via the localStorage key. Single-admin v1: not synced across
   * devices. Easy upgrade path is a private NIP-51 list later.
   *
   * @type {Set<string>}
   */
  let rejectedIds = $state.raw(new Set());

  /** @param {string} pubkey */
  function rejectedKey(pubkey) {
    return `membership-rejected:${pubkey}`;
  }

  $effect(() => {
    const pubkey = manager.active?.pubkey;
    if (!pubkey || typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem(rejectedKey(pubkey));
      rejectedIds = new Set(raw ? JSON.parse(raw) : []);
    } catch {
      rejectedIds = new Set();
    }
  });

  const visibleResponses = $derived(responses.filter((r) => !rejectedIds.has(r.id)));
  const pendingResponses = $derived(
    visibleResponses.filter((r) => approvalState.get(r.id) !== 'approved')
  );
  const approvedResponses = $derived(
    visibleResponses.filter((r) => approvalState.get(r.id) === 'approved')
  );
  const getProfiles = useProfileMap(() => visibleResponses.map((r) => r.pubkey));

  /**
   * Per-row expansion state. Pending applications default to expanded so the
   * admin sees everything at once; approved rows default to collapsed to keep
   * the history list scannable. Tracked as "diffs from the default" — a
   * pending row in `collapsedPending` is collapsed; an approved row in
   * `expandedApproved` is expanded.
   */
  const collapsedPending = new SvelteSet();
  const expandedApproved = new SvelteSet();

  /** @param {string} id */
  function isPendingExpanded(id) {
    return !collapsedPending.has(id);
  }

  /** @param {string} id */
  function togglePending(id) {
    if (collapsedPending.has(id)) collapsedPending.delete(id);
    else collapsedPending.add(id);
  }

  /** @param {string} id */
  function isApprovedExpanded(id) {
    return expandedApproved.has(id);
  }

  /** @param {string} id */
  function toggleApproved(id) {
    if (expandedApproved.has(id)) expandedApproved.delete(id);
    else expandedApproved.add(id);
  }

  // Subscribe to kind 1069 responses for this form.
  $effect(() => {
    if (!formAddress || !adminPubkey) return;

    const loader = formResponseLoader(formAddress, adminPubkey);
    const sub = loader().subscribe();

    const modelSub = eventStore.model(TimelineModel, { kinds: [1069] }).subscribe((events) => {
      responses = (events || []).filter((e) =>
        e.tags.some((t) => t[0] === 'a' && t[1] === formAddress)
      );
    });

    return () => {
      sub.unsubscribe();
      modelSub.unsubscribe();
    };
  });

  // Decrypt each response as it arrives.
  $effect(() => {
    for (const response of responses) {
      if (decrypted.has(response.id)) continue;
      decryptOne(response);
    }
  });

  // After decryption, check upstream NIP-05 to reflect already-provisioned handles.
  $effect(() => {
    if (!handleDomain) return;
    for (const response of responses) {
      const values = decrypted.get(response.id);
      const name = values?.wished_handle?.trim();
      if (!name) continue;
      if (approvalState.has(response.id)) continue;
      checkUpstream(response, name);
    }
  });

  /**
   * Check whether the wished_handle already resolves on the public domain. If
   * it maps to the applicant's pubkey, mark the row as already approved. If it
   * maps to a different pubkey, mark it taken.
   *
   * @param {import('nostr-tools').NostrEvent} response
   * @param {string} name
   */
  async function checkUpstream(response, name) {
    try {
      const url = `https://${handleDomain}/.well-known/nostr.json?name=${encodeURIComponent(name)}`;
      const res = await fetch(url);
      if (!res.ok) return;
      const json = await res.json();
      const mapped = json?.names?.[name];
      if (!mapped) return;
      const state = mapped === response.pubkey ? 'approved' : m.admin_membership_taken();
      approvalState = new Map([...approvalState, [response.id, state]]);
    } catch {
      // Network/CORS — leave row as idle; admin can still try Approve.
    }
  }

  /**
   * @param {import('nostr-tools').NostrEvent} response
   */
  async function decryptOne(response) {
    if (!manager.active) return;
    const isEncrypted = response.tags.some((/** @type {string[]} */ t) => t[0] === 'encrypted');
    let values;
    try {
      if (isEncrypted) {
        const plaintext = await manager.active.signer.nip44.decrypt(
          response.pubkey,
          response.content
        );
        const tags = JSON.parse(plaintext);
        values = parseResponseTags(tags);
      } else {
        const tags = response.tags.filter((/** @type {string[]} */ t) => t[0] === 'response');
        values = parseResponseTags(tags);
      }
      decrypted = new Map([...decrypted, [response.id, values]]);
    } catch {
      // Skip — FormResponses surfaces decrypt errors already.
    }
  }

  /**
   * @param {import('nostr-tools').NostrEvent} response
   */
  async function approve(response) {
    const values = decrypted.get(response.id);
    const name = values?.wished_handle?.trim();
    if (!name) {
      approvalState = new Map([...approvalState, [response.id, m.admin_membership_no_handle()]]);
      return;
    }

    const active = manager.active;
    if (!active) {
      approvalState = new Map([
        ...approvalState,
        [response.id, m.admin_membership_login_required()]
      ]);
      return;
    }
    approvalState = new Map([...approvalState, [response.id, 'pending']]);

    const url = new URL('/api/nip05', window.location.origin).toString();
    const body = JSON.stringify({ name, pubkey: response.pubkey });

    try {
      const authHeader = await createNIP98AuthHeader(url, 'POST', body, (draft) =>
        active.signer.signEvent(draft)
      );
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: authHeader },
        body
      });
      if (res.ok) {
        approvalState = new Map([...approvalState, [response.id, 'approved']]);
        // Best-effort: notify the applicant via NIP-17 DM. Failures here must
        // not roll back the approval — the handle is provisioned upstream and
        // the row is already marked approved.
        try {
          const dmBody = m.admin_membership_notify_dm({
            address: `${name}@${handleDomain}`
          });
          await actionRunnerOptimistic.run(SendWrappedMessage, response.pubkey, dmBody);
        } catch (notifyErr) {
          console.warn('Failed to send approval notification DM', notifyErr);
        }
        return;
      }
      if (res.status === 409) {
        approvalState = new Map([...approvalState, [response.id, m.admin_membership_taken()]]);
        return;
      }
      const errText = await res.text().catch(() => '');
      approvalState = new Map([
        ...approvalState,
        [
          response.id,
          `${m.admin_membership_approve_failed()} (${res.status})${errText ? `: ${errText}` : ''}`
        ]
      ]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      approvalState = new Map([
        ...approvalState,
        [response.id, `${m.admin_membership_approve_failed()}: ${msg}`]
      ]);
    }
  }

  /**
   * Hide a pending application from this admin's queue. Persists the response
   * ID in localStorage (keyed by admin pubkey). Not a Nostr-level deletion —
   * the kind 1069 event remains on relays; we just stop showing it.
   *
   * @param {import('nostr-tools').NostrEvent} response
   */
  function reject(response) {
    if (!confirm(m.admin_membership_reject_confirm())) return;
    const pubkey = manager.active?.pubkey;
    if (!pubkey || typeof window === 'undefined') return;
    const next = new Set([...rejectedIds, response.id]);
    rejectedIds = next;
    try {
      window.localStorage.setItem(rejectedKey(pubkey), JSON.stringify([...next]));
    } catch {
      // localStorage may be disabled — UI still hides for this session.
    }
  }

  /**
   * Revoke a previously approved handle. Proxies a DELETE to the NIP-05 service
   * via /api/nip05/<name>; the proxy verifies a NIP-98 Authorization signed by
   * an admin and forwards with the server-held Bearer token.
   *
   * @param {import('nostr-tools').NostrEvent} response
   */
  async function revoke(response) {
    const values = decrypted.get(response.id);
    const name = values?.wished_handle?.trim();
    if (!name) return;
    if (!confirm(m.admin_membership_revoke_confirm({ handle: `${name}@${handleDomain}` }))) return;

    const active = manager.active;
    if (!active) {
      approvalState = new Map([
        ...approvalState,
        [response.id, m.admin_membership_login_required()]
      ]);
      return;
    }
    approvalState = new Map([...approvalState, [response.id, 'pending']]);

    const url = new URL(
      `/api/nip05/${encodeURIComponent(name)}`,
      window.location.origin
    ).toString();
    try {
      const authHeader = await createNIP98AuthHeader(url, 'DELETE', '', (draft) =>
        active.signer.signEvent(draft)
      );
      const res = await fetch(url, {
        method: 'DELETE',
        headers: { authorization: authHeader }
      });
      if (res.ok) {
        // Row drops back to idle — admin can re-approve or reject.
        approvalState = new Map([...approvalState].filter(([k]) => k !== response.id));
        return;
      }
      const errText = await res.text().catch(() => '');
      approvalState = new Map([
        ...approvalState,
        [
          response.id,
          `${m.admin_membership_revoke_failed()} (${res.status})${errText ? `: ${errText}` : ''}`
        ]
      ]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      approvalState = new Map([
        ...approvalState,
        [response.id, `${m.admin_membership_revoke_failed()}: ${msg}`]
      ]);
    }
  }

  /** @param {string} hex */
  function shortNpub(hex) {
    try {
      const npub = nip19.npubEncode(hex);
      return npub.slice(0, 12) + '…' + npub.slice(-6);
    } catch {
      return hex.slice(0, 10) + '…';
    }
  }
</script>

{#snippet formFieldsBody(/** @type {Record<string, string> | undefined} */ values)}
  <div class="space-y-3 border-t border-base-300 p-4 text-sm">
    {#if values}
      {#each parsedTemplate.fields as field (field.id)}
        {#if field.id !== 'wished_handle'}
          <div>
            <div class="text-xs text-base-content/50">{field.label}</div>
            <div class="break-words">{values[field.id] || '—'}</div>
          </div>
        {/if}
      {/each}
    {:else}
      <div class="flex justify-center p-2">
        <span class="loading loading-sm loading-spinner"></span>
      </div>
    {/if}
  </div>
{/snippet}

{#if pendingResponses.length > 0}
  <section class="mb-8">
    <h2 class="mb-3 text-xl font-semibold">
      {m.admin_membership_pending_title()} ({pendingResponses.length})
    </h2>
    <ul class="space-y-4">
      {#each pendingResponses as response (response.id)}
        {@const values = decrypted.get(response.id)}
        {@const state = approvalState.get(response.id) || 'idle'}
        {@const profile = getProfiles()?.get(response.pubkey)}
        {@const expanded = isPendingExpanded(response.id)}
        <li class="rounded-box border border-base-300 bg-base-100">
          <!-- Header: identity + wished handle + actions + expand toggle -->
          <div class="flex flex-wrap items-start gap-3 bg-base-200/40 p-4">
            <ProfileAvatar pubkey={response.pubkey} {profile} size="md" />
            <div class="min-w-0 flex-1">
              <div class="text-sm font-semibold">
                {profile?.name || profile?.display_name || response.pubkey.slice(0, 8) + '…'}
              </div>
              <div class="text-xs text-base-content/60">
                {formatTimestamp(response.created_at)}
                · <code class="text-xs">{shortNpub(response.pubkey)}</code>
              </div>
              {#if values?.wished_handle}
                <code class="mt-2 inline-block rounded bg-base-200 px-2 py-1 text-sm">
                  {values.wished_handle}@{cfg.handleDomain}
                </code>
              {/if}
            </div>
            <div class="flex flex-wrap items-center gap-2">
              {#if state === 'pending'}
                <span class="loading loading-sm loading-spinner"></span>
                <span class="text-sm text-base-content/60">{m.admin_membership_approve()}…</span>
              {:else}
                {#if state !== 'idle' && state !== 'approved'}
                  <span class="text-sm text-error">{state}</span>
                {/if}
                <button
                  class="btn btn-sm btn-primary"
                  disabled={!values?.wished_handle}
                  onclick={() => approve(response)}
                >
                  {m.admin_membership_approve()}
                </button>
                <button class="btn btn-ghost btn-sm" onclick={() => reject(response)}>
                  {m.admin_membership_reject()}
                </button>
              {/if}
              <button
                class="btn btn-circle btn-ghost btn-sm"
                aria-label={expanded ? m.admin_membership_collapse() : m.admin_membership_expand()}
                aria-expanded={expanded}
                onclick={() => togglePending(response.id)}
              >
                {#if expanded}
                  <ChevronUpIcon class_="w-4 h-4" />
                {:else}
                  <ChevronDownIcon class_="w-4 h-4" />
                {/if}
              </button>
            </div>
          </div>

          <!-- Body: form field values (collapsible) -->
          {#if expanded}
            {@render formFieldsBody(values)}
          {/if}
        </li>
      {/each}
    </ul>
  </section>
{/if}

{#if approvedResponses.length > 0}
  <section class="mb-6">
    <h2 class="mb-3 text-lg font-semibold text-base-content/70">
      {m.admin_membership_approved()} ({approvedResponses.length})
    </h2>
    <ul class="divide-y divide-base-300 rounded-box border border-base-300">
      {#each approvedResponses as response (response.id)}
        {@const values = decrypted.get(response.id)}
        {@const profile = getProfiles()?.get(response.pubkey)}
        {@const expanded = isApprovedExpanded(response.id)}
        <li>
          <div class="flex flex-wrap items-center gap-3 p-3 text-sm">
            <span class="badge badge-sm badge-success">{m.admin_membership_approved()}</span>
            <code class="text-sm">
              {values?.wished_handle ?? '…'}@{cfg.handleDomain}
            </code>
            <span class="text-base-content/60">
              {profile?.name || profile?.display_name || shortNpub(response.pubkey)}
            </span>
            <button
              class="btn ml-auto btn-outline btn-xs btn-error"
              onclick={() => revoke(response)}
            >
              {m.admin_membership_revoke()}
            </button>
            <button
              class="btn btn-circle btn-ghost btn-xs"
              aria-label={expanded ? m.admin_membership_collapse() : m.admin_membership_expand()}
              aria-expanded={expanded}
              onclick={() => toggleApproved(response.id)}
            >
              {#if expanded}
                <ChevronUpIcon class_="w-4 h-4" />
              {:else}
                <ChevronDownIcon class_="w-4 h-4" />
              {/if}
            </button>
          </div>
          {#if expanded}
            {@render formFieldsBody(values)}
          {/if}
        </li>
      {/each}
    </ul>
  </section>
{/if}
