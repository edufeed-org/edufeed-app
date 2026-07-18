<script>
  import { page } from '$app/stores';
  import { TimelineModel } from 'applesauce-core/models';
  import { isProfilePointerInList } from 'applesauce-common/helpers';
  import { AddUserToFollowSet } from 'applesauce-actions/actions';
  import { manager } from '$lib/stores/accounts.svelte';
  import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
  import { actionRunner } from '$lib/stores/action-runner.svelte.js';
  import { parseResponseTags, parseFormTemplate, nip44DecryptWith } from '$lib/helpers/forms.js';
  import { untrack } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import { parseCommunityContentTypes } from '$lib/helpers/communityRelays.js';
  import { formResponseLoader } from '$lib/loaders/community.js';
  import { addressLoader } from '$lib/loaders/base.js';
  import { getCommunikeyRelays } from '$lib/helpers/relay-helper.js';
  import { useProfileMap } from '$lib/stores/profile-map.svelte.js';
  import { formatTimestamp } from '$lib/helpers/dates.js';
  import { resolve } from '$app/paths';
  import { profileLink } from '$lib/helpers/nostrUtils.js';
  import ProfileAvatar from '../shared/ProfileAvatar.svelte';
  import * as m from '$lib/paraglide/messages';

  /**
   * @type {{
   *   formEvent: import('nostr-tools').NostrEvent,
   *   formAddress: string
   * }}
   */
  let { formEvent, formAddress } = $props();

  const parsed = $derived(parseFormTemplate(formEvent));

  /**
   * Map stored optionIds back to labels for display. Non-option fields and
   * unknown ids pass through unchanged (covers legacy label-valued responses).
   * @param {import('$lib/helpers/forms.js').FormField} field
   * @param {string | undefined} raw
   */
  function displayValue(field, raw) {
    if (!raw) return raw;
    /** @type {import('$lib/helpers/forms.js').FormFieldOption[] | undefined} */
    const opts = field.options?.options;
    if (!opts?.length) return raw;
    const byId = new Map(opts.map((o) => [o.id, o.label]));
    return raw
      .split(';')
      .map((v) => byId.get(v) ?? v)
      .join(', ');
  }

  /** @type {import('nostr-tools').NostrEvent[]} */
  let responses = $state.raw([]);
  let isLoading = $state(true);

  /** @type {Map<string, Record<string, string>>} event id -> decrypted values */
  let decryptedMap = $state.raw(new Map());
  /** @type {Map<string, string>} event id -> error message */
  let decryptErrors = $state.raw(new Map());

  /** @type {Set<string>} expanded response IDs */
  let expanded = $state.raw(new Set());

  // Load responses
  $effect(() => {
    const loader = formResponseLoader(formAddress, formEvent.pubkey);
    const sub = loader().subscribe();

    const modelSub = eventStore.model(TimelineModel, { kinds: [1069] }).subscribe((events) => {
      const filtered = (events || []).filter((e) =>
        e.tags.some((t) => t[0] === 'a' && t[1] === formAddress)
      );
      responses = filtered;
      isLoading = false;
    });

    return () => {
      sub.unsubscribe();
      modelSub.unsubscribe();
    };
  });

  // Profile loading for response authors
  const getProfiles = useProfileMap(() => responses.map((r) => r.pubkey));

  // Load the community event (kind 10222) for the form author to find gated sections
  let communityEvent = $state(/** @type {import('nostr-tools').NostrEvent | null} */ (null));

  $effect(() => {
    const relays = getCommunikeyRelays();
    const loaderSub = addressLoader({
      kind: 10222,
      pubkey: formEvent.pubkey,
      relays
    }).subscribe();

    /** @type {import('rxjs').Subscription | undefined} */
    let modelSub;
    modelSub = eventStore.replaceable(10222, formEvent.pubkey).subscribe((event) => {
      communityEvent = event || null;
    });

    return () => {
      loaderSub.unsubscribe();
      modelSub?.unsubscribe();
    };
  });

  // Parse gated sections from the community event and load each profile list
  /** @type {{ sectionName: string, event: import('nostr-tools').NostrEvent }[]} */
  let linkedSections = $state.raw([]);

  $effect(() => {
    if (!communityEvent) {
      linkedSections = [];
      return;
    }

    const sections = parseCommunityContentTypes(communityEvent).filter((s) => s.profileList);
    if (sections.length === 0) {
      linkedSections = [];
      return;
    }

    const relays = getCommunikeyRelays();
    /** @type {import('rxjs').Subscription[]} */
    const subs = [];

    for (const section of sections) {
      const address = section.profileList;
      if (!address) continue;

      const parts = address.split(':');
      if (parts.length < 3) continue;

      const [, pubkey, ...identifierParts] = parts;
      const identifier = identifierParts.join(':');
      const fetchRelays = section.profileListRelay ? [section.profileListRelay, ...relays] : relays;

      const loaderSub = addressLoader({
        kind: 30000,
        pubkey,
        identifier,
        relays: fetchRelays
      }).subscribe();
      subs.push(loaderSub);

      /** @type {import('rxjs').Subscription | undefined} */
      let modelSub;
      modelSub = eventStore.replaceable(30000, pubkey, identifier).subscribe((event) => {
        if (!event) return;
        // Update linkedSections reactively — add or replace this section
        const current = untrack(() => linkedSections);
        linkedSections = [
          ...current.filter((s) => s.sectionName !== section.name),
          { sectionName: section.name, event }
        ];
      });
      subs.push(modelSub);
    }

    return () => {
      for (const sub of subs) sub.unsubscribe();
    };
  });

  /** @type {SvelteSet<string>} session-only denied set: "responseId:sectionName" */
  let denied = new SvelteSet();

  /** @type {SvelteSet<string>} in-flight grant keys: "responseId:sectionName" */
  let granting = new SvelteSet();

  /**
   * Grant a respondent access to a section's profile list.
   * @param {string} pubkey
   * @param {string} sectionName
   * @param {string} responseId
   */
  async function grantAccess(pubkey, sectionName, responseId) {
    const key = `${responseId}:${sectionName}`;
    granting.add(key);
    try {
      await actionRunner.run(AddUserToFollowSet, pubkey, sectionName);
    } catch (err) {
      console.error('Failed to grant access:', err);
    } finally {
      granting.delete(key);
    }
  }

  /** @type {SvelteSet<string>} in-flight grant-all keys: responseId */
  let grantingAll = new SvelteSet();

  /**
   * Grant a respondent access to all linked sections.
   * @param {string} pubkey
   * @param {string} responseId
   */
  async function grantAllAccess(pubkey, responseId) {
    grantingAll.add(responseId);
    try {
      const results = await Promise.allSettled(
        linkedSections
          .filter((s) => !isProfilePointerInList(s.event, pubkey))
          .map((s) => actionRunner.run(AddUserToFollowSet, pubkey, s.sectionName))
      );
      const failures = results.filter((r) => r.status === 'rejected');
      if (failures.length > 0) {
        console.error('Some grant-all actions failed:', failures);
      }
    } finally {
      grantingAll.delete(responseId);
    }
  }

  /**
   * Deny a respondent (session-only).
   * @param {string} responseId
   * @param {string} sectionName
   */
  function denyAccess(responseId, sectionName) {
    denied.add(`${responseId}:${sectionName}`);
  }

  /**
   * Undo a denial.
   * @param {string} responseId
   * @param {string} sectionName
   */
  function undoDeny(responseId, sectionName) {
    denied.delete(`${responseId}:${sectionName}`);
  }

  // Deep-link: auto-expand + scroll to a specific response from URL hash
  const targetResponseId = $derived(
    $page.url.hash?.startsWith('#response-') ? $page.url.hash.slice('#response-'.length) : null
  );

  let didAutoScroll = false;
  $effect(() => {
    if (!targetResponseId || !responses.length || didAutoScroll) return;
    const target = responses.find((r) => r.id === targetResponseId);
    if (!target || expanded.has(target.id)) return;
    didAutoScroll = true;
    toggleExpand(target);
    requestAnimationFrame(() => {
      document
        .getElementById(`response-${target.id}`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  });

  /**
   * Decrypt a response's content
   * @param {import('nostr-tools').NostrEvent} response
   */
  async function decryptResponse(response) {
    if (decryptedMap.has(response.id)) return;
    if (!manager.active) return;

    const isEncrypted = response.tags.some((t) => t[0] === 'encrypted');

    if (!isEncrypted) {
      const tags = response.tags.filter((t) => t[0] === 'response');
      const values = parseResponseTags(tags);
      decryptedMap = new Map([...decryptedMap, [response.id, values]]);
      return;
    }

    try {
      const plaintext = await nip44DecryptWith(
        manager.active.signer,
        response.pubkey,
        response.content
      );
      const tags = JSON.parse(plaintext);
      const values = parseResponseTags(tags);
      decryptedMap = new Map([...decryptedMap, [response.id, values]]);
    } catch (_err) {
      decryptErrors = new Map([...decryptErrors, [response.id, m.form_responses_decrypt_failed()]]);
    }
  }

  /**
   * Toggle expand and decrypt if needed
   * @param {import('nostr-tools').NostrEvent} response
   */
  function toggleExpand(response) {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- $state.raw() requires plain Set to avoid proxy issues with .has()
    const newExpanded = new Set(expanded);
    if (newExpanded.has(response.id)) {
      newExpanded.delete(response.id);
    } else {
      newExpanded.add(response.id);
      decryptResponse(response);
    }
    expanded = newExpanded;
  }
</script>

<div class="space-y-3">
  {#if linkedSections.length > 0}
    <div class="flex flex-wrap items-center gap-2 rounded-lg bg-base-200/50 px-3 py-2 text-sm">
      <span class="text-base-content/60">{m.form_responses_linked_to()}</span>
      {#each linkedSections as section (section.sectionName)}
        <span class="badge badge-outline badge-sm">{section.sectionName}</span>
      {/each}
    </div>
  {/if}

  {#if isLoading}
    <div class="flex justify-center p-8">
      <span class="loading loading-md loading-spinner"></span>
    </div>
  {:else if responses.length === 0}
    <p class="py-8 text-center text-base-content/50">{m.form_responses_empty()}</p>
  {:else}
    {#each responses as response (response.id)}
      {@const profile = getProfiles()?.get(response.pubkey)}
      {@const isExpanded = expanded.has(response.id)}
      {@const values = decryptedMap.get(response.id)}
      {@const decryptError = decryptErrors.get(response.id)}

      <div
        id="response-{response.id}"
        class="overflow-hidden rounded-lg border border-base-content/15"
      >
        <!-- Header -->
        <div
          role="button"
          tabindex="0"
          class="flex w-full cursor-pointer items-center justify-between bg-base-200/30 p-3 transition-colors hover:bg-base-200/50"
          onclick={(e) => {
            if (e.target instanceof HTMLElement && e.target.closest('a')) return;
            toggleExpand(response);
          }}
          onkeydown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              toggleExpand(response);
            }
          }}
        >
          <div class="flex items-center gap-3">
            <ProfileAvatar pubkey={response.pubkey} {profile} size="sm" linkToProfile />
            <div class="text-left">
              <a
                href={resolve(profileLink(response.pubkey))}
                class="block text-sm font-semibold hover:underline"
              >
                {profile?.name || response.pubkey.slice(0, 8) + '...'}
              </a>
              <div class="text-xs text-base-content/40">
                {formatTimestamp(response.created_at)}
              </div>
            </div>
          </div>
        </div>

        <!-- Expanded content -->
        {#if isExpanded}
          <div class="space-y-2 p-3 text-sm">
            {#if decryptError}
              <div class="alert-sm alert alert-error">{decryptError}</div>
            {:else if values}
              {#each parsed.fields as field (field.id)}
                <div>
                  <div class="text-xs text-base-content/50">{field.label}</div>
                  <div>{displayValue(field, values[field.id]) || '\u2014'}</div>
                </div>
              {/each}
              <!-- Show unknown fields (from older form versions) -->
              {#each Object.entries(values).filter(([id]) => !parsed.fields.find((f) => f.id === id)) as [id, value] (id)}
                <div>
                  <div class="text-xs text-base-content/50">
                    {id} <span class="italic">{m.form_responses_field_removed()}</span>
                  </div>
                  <div>{value}</div>
                </div>
              {/each}
            {:else}
              <div class="flex justify-center p-2">
                <span class="loading loading-sm loading-spinner"></span>
              </div>
            {/if}

            <!-- Access control actions per linked section (shown regardless of decrypt status) -->
            {#if linkedSections.length > 0}
              <div class="mt-3 flex flex-wrap gap-2 border-t border-base-content/10 pt-3">
                {#if linkedSections.length > 1 && linkedSections.some((s) => !isProfilePointerInList(s.event, response.pubkey))}
                  <button
                    class="btn btn-xs btn-success"
                    disabled={grantingAll.has(response.id)}
                    onclick={() => grantAllAccess(response.pubkey, response.id)}
                  >
                    {#if grantingAll.has(response.id)}
                      <span class="loading loading-xs loading-spinner"></span>
                    {/if}
                    {m.form_responses_grant_all()}
                  </button>
                {/if}
                {#each linkedSections as section (section.sectionName)}
                  {@const isMember = isProfilePointerInList(section.event, response.pubkey)}
                  {@const denyKey = `${response.id}:${section.sectionName}`}
                  {@const isDenied = denied.has(denyKey)}
                  {@const isGranting = granting.has(denyKey)}

                  {#if isMember}
                    <span class="badge gap-1 badge-sm badge-success"
                      >{m.form_responses_member_of({ section: section.sectionName })}</span
                    >
                  {:else if isDenied}
                    <span class="inline-flex items-center gap-1 text-xs text-base-content/50">
                      {m.form_responses_denied({ section: section.sectionName })}
                      <button
                        class="link text-xs link-hover"
                        onclick={() => undoDeny(response.id, section.sectionName)}
                        >{m.form_responses_undo()}</button
                      >
                    </span>
                  {:else}
                    <div class="inline-flex gap-1">
                      <button
                        class="btn btn-xs btn-success"
                        disabled={isGranting}
                        onclick={() =>
                          grantAccess(response.pubkey, section.sectionName, response.id)}
                      >
                        {#if isGranting}
                          <span class="loading loading-xs loading-spinner"></span>
                        {/if}
                        {m.form_responses_grant({ section: section.sectionName })}
                      </button>
                      <button
                        class="btn btn-ghost btn-xs"
                        onclick={() => denyAccess(response.id, section.sectionName)}
                        >{m.form_responses_deny()}</button
                      >
                    </div>
                  {/if}
                {/each}
              </div>
            {/if}
          </div>
        {/if}
      </div>
    {/each}
  {/if}
</div>
