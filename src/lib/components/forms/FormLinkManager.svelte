<script>
  import { parseCommunityContentTypes } from '$lib/helpers/communityRelays.js';
  import { parseFormTemplate } from '$lib/helpers/forms.js';
  import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
  import { addressLoader } from '$lib/loaders/base.js';
  import { formTemplateLoader } from '$lib/loaders/community.js';
  import { manager } from '$lib/stores/accounts.svelte';
  import { publishEvent } from '$lib/services/publish-service.js';
  import { showToast } from '$lib/helpers/toast';
  import { getCommunikeyRelays } from '$lib/helpers/relay-helper.js';
  import { TimelineModel } from 'applesauce-core/models';
  import { untrack } from 'svelte';

  let { communityEvent, communityPubkey } = $props();

  /** @type {any[]} */
  let formTemplates = $state.raw([]);

  /** @type {Map<string, string | null>} section name -> form address */
  let currentFormLinks = $state.raw(new Map());

  let saving = $state(false);

  // Gated sections derived from community event
  const gatedSections = $derived.by(() => {
    if (!communityEvent) return [];
    const sections = parseCommunityContentTypes(communityEvent);
    return sections.filter((s) => s.profileList);
  });

  // Load form templates for the community
  $effect(() => {
    if (!communityPubkey) return;

    /** @type {import('rxjs').Subscription | undefined} */
    let loaderSub;
    /** @type {import('rxjs').Subscription | undefined} */
    let modelSub;

    loaderSub = formTemplateLoader(communityPubkey)().subscribe();

    modelSub = eventStore
      .model(TimelineModel, { kinds: [30168], authors: [communityPubkey] })
      .subscribe((events) => {
        formTemplates = events || [];
      });

    return () => {
      loaderSub?.unsubscribe();
      modelSub?.unsubscribe();
    };
  });

  // Load profile list events for each gated section and read current form tags
  $effect(() => {
    const sections = gatedSections;
    if (sections.length === 0) return;

    /** @type {import('rxjs').Subscription[]} */
    const subs = [];

    for (const section of sections) {
      if (!section.profileList) continue;

      const parts = section.profileList.split(':');
      if (parts.length < 3) continue;

      const [, pubkey, ...identifierParts] = parts;
      const identifier = identifierParts.join(':');

      const loaderSub = addressLoader({
        kind: 30000,
        pubkey,
        identifier,
        relays: getCommunikeyRelays()
      }).subscribe();
      subs.push(loaderSub);

      /** @type {import('rxjs').Subscription | undefined} */
      let modelSub;
      modelSub = eventStore.replaceable(30000, pubkey, identifier).subscribe((event) => {
        const formTag = event?.tags?.find((/** @type {string[]} */ t) => t[0] === 'form');
        // eslint-disable-next-line svelte/prefer-svelte-reactivity -- reassignment pattern for $state.raw()
        const newMap = new Map(untrack(() => currentFormLinks));
        newMap.set(section.name, formTag?.[1] || null);
        currentFormLinks = newMap;
      });
      subs.push(modelSub);
    }

    return () => {
      for (const sub of subs) {
        sub.unsubscribe();
      }
    };
  });

  /**
   * @param {import('$lib/helpers/communityRelays.js').ContentTypeConfig} section
   * @param {string} formAddress - coordinate like "30168:pubkey:d-tag" or empty string
   */
  async function handleFormSelect(section, formAddress) {
    await saveFormLink(section, formAddress || null);
  }

  /**
   * @param {import('$lib/helpers/communityRelays.js').ContentTypeConfig} section
   * @param {string | null} formAddress
   */
  async function saveFormLink(section, formAddress) {
    const account = manager.active;
    if (!account?.signer) return;
    if (!section.profileList) return;

    saving = true;

    try {
      const parts = section.profileList.split(':');
      if (parts.length < 3) return;

      const [, pubkey, ...identifierParts] = parts;
      const identifier = identifierParts.join(':');

      // Get current event from eventStore
      const currentEvent = await new Promise((resolve) => {
        /** @type {import('rxjs').Subscription | undefined} */
        let sub;
        sub = eventStore.replaceable(30000, pubkey, identifier).subscribe((event) => {
          if (sub) sub.unsubscribe();
          resolve(event);
        });
      });

      if (!currentEvent) {
        showToast('Profile list event not found', 'error');
        return;
      }

      // Clone tags, remove old form tag, add new one
      const newTags = /** @type {any} */ (currentEvent).tags.filter(
        (/** @type {string[]} */ t) => t[0] !== 'form'
      );
      if (formAddress) {
        newTags.push(['form', formAddress]);
      }

      const newEvent = {
        kind: 30000,
        created_at: Math.floor(Date.now() / 1000),
        tags: newTags,
        content: /** @type {any} */ (currentEvent).content || '',
        pubkey: account.pubkey
      };

      const signed = await account.signer.signEvent(newEvent);
      const result = await publishEvent(signed);

      if (result.success) {
        eventStore.add(signed);
        showToast('Form linked successfully', 'success');
      } else {
        showToast('Failed to publish form link', 'error');
      }
    } catch (err) {
      console.error('Failed to save form link:', err);
      showToast('Failed to save form link', 'error');
    } finally {
      saving = false;
    }
  }
</script>

<div class="card bg-base-200 shadow-xl">
  <div class="card-body">
    <h2 class="card-title">Application Forms</h2>
    <p class="text-sm text-base-content/70">
      Link forms to gated content sections. Members apply by filling out the form.
    </p>

    {#if gatedSections.length === 0}
      <p class="text-sm text-base-content/50">No profile-list-gated sections configured.</p>
    {:else}
      {#each gatedSections as section (section.name)}
        <div class="form-control">
          <label class="label" for="form-link-{section.name}">
            <span class="label-text font-medium">{section.name}</span>
          </label>
          <select
            id="form-link-{section.name}"
            class="select-bordered select w-full"
            value={currentFormLinks.get(section.name) || ''}
            onchange={(e) =>
              handleFormSelect(section, /** @type {HTMLSelectElement} */ (e.target).value)}
            disabled={saving}
          >
            <option value="">No form linked</option>
            {#each formTemplates as template (template.id)}
              {@const parsed = parseFormTemplate(template)}
              <option value="{template.kind}:{template.pubkey}:{parsed.dTag}">
                {parsed.name || parsed.dTag}
              </option>
            {/each}
          </select>
        </div>
      {/each}
    {/if}

    {#if formTemplates.length === 0 && gatedSections.length > 0}
      <div class="mt-2 alert alert-info">
        <span>No form templates found. Create one at /forms/new first.</span>
      </div>
    {/if}
  </div>
</div>
