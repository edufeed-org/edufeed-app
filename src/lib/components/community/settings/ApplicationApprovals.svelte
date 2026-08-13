<!--
  ApplicationApprovals — Task 7. Admin-facing queue of kind 1069 membership
  applications for a moderated community: loads the copies p-tagged to the
  ACTIVE admin (the reviewer, not necessarily the form's creator —
  formResponseLoader's `#p` filter param already accepts either, see the
  header note in loaders/community.js), decrypts and renders them, and lets
  the admin Approve (root put-user, then fan-out over the community's
  Stufe-2 channels, then a roster refresh, then a best-effort NIP-17 DM) or
  Decline (persistent localStorage dismissal, keyed by community + RESPONSE ID
  — not by admin, so any admin's decline sticks in THIS browser, and not by
  applicant pubkey, so a newer re-submission from a declined applicant
  resurfaces as a fresh pending item rather than staying hidden forever —
  precedent: MembershipApprovalsPanel.svelte's rejectedIds by r.id) plus a
  best-effort DM and an in-session Undo.

  Parallels MembershipApprovalsPanel.svelte (the deployment's NIP-05 handle
  queue) but provisions via the roster fan-out service (Task 1) instead of
  the NIP-05 proxy. Reuses selectAdminApplications verbatim — same
  newest-per-applicant / p-tagged-to-me rules apply here.

  Does not own a second useRootRoster subscription: MembershipPane already
  has one and threads its `roster` view down as a prop.
-->
<script>
  import { TimelineModel } from 'applesauce-core/models';
  import { normalizeURL } from 'applesauce-core/helpers';
  import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
  import { useActiveUser } from '$lib/stores/accounts.svelte';
  import { formResponseLoader } from '$lib/loaders/community.js';
  import { createCachedTimelineLoader } from '$lib/loaders/base.js';
  import { getCommunikeyRelays } from '$lib/helpers/relay-helper.js';
  import { RelayListModel } from '$lib/models/relay-list-model.js';
  import { selectAdminApplications } from '$lib/helpers/membership-applications.js';
  import { parseApplicationRef } from '$lib/groups/community-membership.js';
  import { stufe2Pointers } from '$lib/groups/area-members.js';
  import { channelKey } from '$lib/groups/community-pointer.js';
  import { putUserOn, fanOut } from '$lib/groups/roster-fanout.js';
  import { parseResponseTags, nip44DecryptWith } from '$lib/helpers/forms.js';
  import { sendWrappedDm } from '$lib/services/wrapped-dm.js';
  import { useProfileMap } from '$lib/stores/profile-map.svelte.js';
  import { showToast } from '$lib/helpers/toast';
  import ProfileAvatar from '$lib/components/shared/ProfileAvatar.svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import * as m from '$lib/paraglide/messages';

  /**
   * @type {{
   *   communikeyEvent: {pubkey?: string, tags?: string[][]} | null | undefined,
   *   communityId: string,
   *   communityName?: string,
   *   roster: {
   *     pointer: {id: string, relay: string} | null,
   *     members: Set<string>,
   *     refresh: () => void
   *   }
   * }}
   */
  let { communikeyEvent, communityId, communityName, roster } = $props();

  const applicationRef = $derived(parseApplicationRef(communikeyEvent));

  const getActiveUser = useActiveUser();
  const activeUser = $derived(getActiveUser());

  /** @type {import('nostr-tools').NostrEvent[]} */
  let responses = $state.raw([]);

  // Base loader over the reviewer-side relay set (communikey app relays;
  // see loaders/community.js). `#p` addressed to the ACTIVE admin — the
  // person reviewing, not necessarily the form's creator.
  $effect(() => {
    const address = applicationRef?.address;
    const myPubkey = activeUser?.pubkey;
    if (!address || !myPubkey) {
      responses = [];
      return;
    }

    const loader = formResponseLoader(address, myPubkey);
    const sub = loader().subscribe();

    const modelSub = eventStore.model(TimelineModel, { kinds: [1069] }).subscribe((events) => {
      responses = selectAdminApplications(events, address, myPubkey);
    });

    return () => {
      sub.unsubscribe();
      modelSub.unsubscribe();
    };
  });

  // Supplemental relay loading: union the admin's own NIP-65 read relays.
  // Cheap because the active account's kind 10002 is already prefetched into
  // EventStore at login (accounts.svelte.js) — this reads it, it doesn't
  // fetch. Mirrors the discover page's supplemental-relay pattern: track
  // which extra relays we've already spawned a loader for so a re-emission
  // of the same relay list doesn't requery.
  /** @type {SvelteSet<string>} */
  let loadedExtraRelays = new SvelteSet();
  // Tracks the address loadedExtraRelays was last accumulated against. Plain
  // `let`, read/written only inside the effect (channel-rosters.svelte.js
  // pointersKey lesson) — scope the dedupe set to the identity it was
  // computed against, so switching to a different community's application
  // (a new `address`) doesn't inherit a stale set and skip loaders for
  // relays it never actually loaded for THIS address.
  let loadedExtraRelaysAddress = '';
  $effect(() => {
    const address = applicationRef?.address;
    const myPubkey = activeUser?.pubkey;
    if (address !== loadedExtraRelaysAddress) {
      loadedExtraRelays = new SvelteSet();
      loadedExtraRelaysAddress = address ?? '';
    }
    if (!address || !myPubkey) return;

    // Cast sidesteps the applesauce model-constructor type mismatch (same
    // workaround as relay-service.svelte.js's fetchRelayListResolution).
    const sub = /** @type {any} */ (eventStore)
      .model(RelayListModel, myPubkey)
      .subscribe((/** @type {any} */ list) => {
        const readRelays = list?.readRelays;
        if (!Array.isArray(readRelays) || readRelays.length === 0) return;
        const base = new Set(getCommunikeyRelays().map(normalizeURL));
        const extra = readRelays.filter(
          (/** @type {string} */ r) =>
            !base.has(normalizeURL(r)) && !loadedExtraRelays.has(normalizeURL(r))
        );
        if (extra.length === 0) return;
        extra.forEach((/** @type {string} */ r) => loadedExtraRelays.add(normalizeURL(r)));
        createCachedTimelineLoader(extra, {
          kinds: [1069],
          '#a': [address],
          '#p': [myPubkey]
        })().subscribe();
      });

    return () => sub.unsubscribe();
  });

  const getProfiles = useProfileMap(() => responses.map((r) => r.pubkey));

  // --- Decryption ----------------------------------------------------------

  /** @type {Map<string, Record<string, string>>} */
  let decrypted = $state.raw(new Map());
  /** @type {Set<string>} response ids whose decryption failed */
  let decryptFailed = $state.raw(new Set());

  $effect(() => {
    for (const response of responses) {
      if (decrypted.has(response.id) || decryptFailed.has(response.id)) continue;
      decryptOne(response);
    }
  });

  /** @param {import('nostr-tools').NostrEvent} response */
  async function decryptOne(response) {
    if (!activeUser) return;
    try {
      const isEncrypted = response.tags.some((/** @type {string[]} */ t) => t[0] === 'encrypted');
      let values;
      if (isEncrypted) {
        const plaintext = await nip44DecryptWith(
          activeUser.signer,
          response.pubkey,
          response.content
        );
        values = parseResponseTags(JSON.parse(plaintext));
      } else {
        values = parseResponseTags(
          response.tags.filter((/** @type {string[]} */ t) => t[0] === 'response')
        );
      }
      decrypted = new Map([...decrypted, [response.id, values]]);
    } catch (err) {
      console.warn('community: application decrypt failed', err);
      decryptFailed = new Set([...decryptFailed, response.id]);
    }
  }

  // --- Decline (persistent, per community + RESPONSE ID) --------------------
  // Keyed by response.id (not applicant pubkey): declining a specific
  // submission never suppresses a LATER re-submission from the same
  // applicant, since selectAdminApplications already reduces `responses` to
  // one (newest) event per pubkey — a re-submission has a fresh id that
  // simply isn't in this set. Old pubkey-keyed localStorage entries from
  // before this change are inert and never migrated.

  /** @param {string} responseId */
  function declinedKey(responseId) {
    return `communityApplication:declined:${communityId}:${responseId}`;
  }

  /** @type {Set<string>} response ids declined; loaded lazily from localStorage as responses arrive */
  let declinedResponseIds = $state.raw(new Set());

  $effect(() => {
    if (typeof window === 'undefined') return;
    for (const response of responses) {
      if (declinedResponseIds.has(response.id)) continue;
      try {
        if (window.localStorage.getItem(declinedKey(response.id))) {
          declinedResponseIds = new Set([...declinedResponseIds, response.id]);
        }
      } catch {
        // localStorage may be disabled — nothing to load, no crash.
      }
    }
  });

  /** @param {import('nostr-tools').NostrEvent} response */
  function decline(response) {
    try {
      window.localStorage.setItem(declinedKey(response.id), '1');
    } catch {
      // localStorage may be disabled — still hides for this session below.
    }
    declinedResponseIds = new Set([...declinedResponseIds, response.id]);
    // Best-effort — the decline already took effect locally either way.
    sendWrappedDm(
      response.pubkey,
      m.community_application_declined_dm({ community: communityName || communityId })
    ).catch((err) => console.warn('community: application declined-DM failed', err));
  }

  /** @param {string} responseId */
  function undoDecline(responseId) {
    try {
      window.localStorage.removeItem(declinedKey(responseId));
    } catch {
      // ignore
    }
    declinedResponseIds = new Set([...declinedResponseIds].filter((id) => id !== responseId));
  }

  // --- Approve (root put-user, then fan-out, then refresh, then DM) --------

  /** @type {Set<string>} pubkeys with an in-flight approve */
  let approving = $state.raw(new Set());
  /** @type {Map<string, string>} pubkey -> last approve error message */
  let approveErrors = $state.raw(new Map());

  /** @param {import('nostr-tools').NostrEvent} response */
  async function approve(response) {
    const pubkey = response.pubkey;
    const rootPointer = roster?.pointer;
    if (!activeUser || !rootPointer || approving.has(pubkey)) return;

    approving = new Set([...approving, pubkey]);
    approveErrors = new Map([...approveErrors].filter(([k]) => k !== pubkey));
    try {
      // Root membership FIRST — the channel fan-out below is best-effort on
      // top of it, not a substitute for it.
      await putUserOn(rootPointer, pubkey, [], activeUser);

      const pointers = stufe2Pointers(communikeyEvent);
      const aggregate = await fanOut(
        pointers,
        (pointer) => channelKey(pointer) ?? pointer.id,
        (pointer) => putUserOn(pointer, pubkey, [], activeUser)
      );

      roster.refresh?.();

      if (aggregate.failed.length > 0) {
        showToast(
          m.area_members_fanout_partial({
            failed: aggregate.failed.length,
            total: aggregate.ok.length + aggregate.failed.length
          }),
          'warning'
        );
      }

      // Best-effort: the applicant is already a member either way.
      try {
        await sendWrappedDm(
          pubkey,
          m.community_application_approved_dm({ community: communityName || communityId })
        );
      } catch (dmErr) {
        console.warn('community: application approved-DM failed', dmErr);
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      approveErrors = new Map([...approveErrors, [pubkey, reason]]);
      showToast(m.community_application_approve_failed({ reason }), 'error');
    } finally {
      approving = new Set([...approving].filter((pk) => pk !== pubkey));
    }
  }

  // --- Derived lists ---------------------------------------------------------

  const visibleResponses = $derived(responses.filter((r) => !declinedResponseIds.has(r.id)));
  const pendingResponses = $derived(
    visibleResponses.filter((r) => !roster?.members?.has(r.pubkey))
  );
  const approvedResponses = $derived(
    visibleResponses.filter((r) => roster?.members?.has(r.pubkey))
  );
  const declinedResponses = $derived(responses.filter((r) => declinedResponseIds.has(r.id)));

  /** @param {string} hex */
  function shortPubkey(hex) {
    return hex.slice(0, 8) + '…';
  }
</script>

<div class="card mb-6 bg-base-100 shadow-xl" data-testid="application-approvals">
  <div class="card-body">
    <h2 class="card-title">{m.community_applications_title()}</h2>

    {#if pendingResponses.length === 0 && approvedResponses.length === 0}
      <p class="text-sm text-base-content/60">{m.community_applications_empty()}</p>
    {/if}

    {#if pendingResponses.length > 0}
      <ul class="space-y-3">
        {#each pendingResponses as response (response.id)}
          {@const values = decrypted.get(response.id)}
          {@const failed = decryptFailed.has(response.id)}
          {@const isApproving = approving.has(response.pubkey)}
          {@const approveError = approveErrors.get(response.pubkey)}
          {@const profile = getProfiles()?.get(response.pubkey)}
          <li class="rounded-box border border-base-300 p-3">
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div class="flex min-w-0 flex-1 items-start gap-3">
                <ProfileAvatar pubkey={response.pubkey} {profile} size="sm" />
                <div class="min-w-0 flex-1">
                  <div class="text-sm font-semibold">
                    {profile?.name || profile?.display_name || shortPubkey(response.pubkey)}
                  </div>
                  {#if failed}
                    <p class="text-xs text-error">{m.community_applications_decrypt_failed()}</p>
                  {:else if values}
                    <dl class="mt-1 space-y-1 text-xs text-base-content/70">
                      {#each Object.entries(values) as [key, value] (key)}
                        <div>
                          <dt class="inline font-medium">{key}:</dt>
                          <dd class="inline">{value}</dd>
                        </div>
                      {/each}
                    </dl>
                  {:else}
                    <span class="loading loading-xs loading-spinner"></span>
                  {/if}
                  {#if approveError}
                    <p class="mt-1 text-xs text-error">
                      {m.community_application_approve_failed({ reason: approveError })}
                    </p>
                  {/if}
                </div>
              </div>
              <div class="flex items-center gap-2">
                {#if isApproving}
                  <span class="loading loading-sm loading-spinner"></span>
                {:else}
                  <button
                    class="btn btn-sm btn-primary"
                    data-testid={`application-approve-${response.pubkey}`}
                    onclick={() => approve(response)}
                  >
                    {m.community_applications_approve()}
                  </button>
                  <button
                    class="btn btn-ghost btn-sm"
                    data-testid={`application-decline-${response.pubkey}`}
                    onclick={() => decline(response)}
                  >
                    {m.community_applications_decline()}
                  </button>
                {/if}
              </div>
            </div>
          </li>
        {/each}
      </ul>
    {/if}

    {#if approvedResponses.length > 0}
      <ul class="mt-2 divide-y divide-base-300">
        {#each approvedResponses as response (response.id)}
          {@const profile = getProfiles()?.get(response.pubkey)}
          <li class="flex items-center gap-2 py-2 text-sm">
            <span class="badge badge-sm badge-success">
              {m.community_applications_approved_badge()}
            </span>
            <span class="text-base-content/70">
              {profile?.name || profile?.display_name || shortPubkey(response.pubkey)}
            </span>
          </li>
        {/each}
      </ul>
    {/if}

    {#if declinedResponses.length > 0}
      <ul class="mt-2 space-y-1">
        {#each declinedResponses as response (response.id)}
          <li class="flex items-center gap-2 text-xs text-base-content/50">
            <span>{shortPubkey(response.pubkey)}</span>
            <button class="btn btn-ghost btn-xs" onclick={() => undoDecline(response.id)}>
              {m.community_applications_undo()}
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</div>
