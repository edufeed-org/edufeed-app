<script>
  import { goto } from '$app/navigation';
  import { nip19 } from 'nostr-tools';
  import { decodeFormNaddr, parseFormTemplate } from '$lib/helpers/forms.js';
  import {
    buildAMBResourceTags,
    parseAMBResourceForForm,
    resolveResourceDTag
  } from '$lib/helpers/form-to-amb.js';
  import FormRenderer from '$lib/components/forms/FormRenderer.svelte';
  import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
  import { addressLoader } from '$lib/loaders/base.js';
  import { createAppEventFactory } from '$lib/helpers/event-factory.js';
  import { publishEvent } from '$lib/services/publish-service.js';
  import { manager } from '$lib/stores/accounts.svelte';
  import { getEducationalRelays, getCommunikeyRelays } from '$lib/helpers/relay-helper.js';

  /**
   * Template-driven "Share Learning Resource" form: loads a published kind-30168
   * form template (`templateNaddr`), renders it via `FormRenderer`, and on
   * submit builds/signs/publishes a kind-30142 event via `buildAMBResourceTags`.
   *
   * `communityPubkey` is accepted for interface parity with `ResourceFormWizard`
   * (community preselection) but is not yet consumed here — the template-driven
   * form has no community-selection step. Kept as `_communityPubkey` locally
   * so lint doesn't flag it while the prop stays part of the public interface.
   *
   * @type {{ templateNaddr: string, communityPubkey?: string, editNaddr?: string }}
   */
  let { templateNaddr, communityPubkey: _communityPubkey = '', editNaddr = '' } = $props();

  const decoded = $derived(decodeFormNaddr(templateNaddr));

  /** @type {import('nostr-tools').NostrEvent | undefined} */
  let formEvent = $state(undefined);
  let parsed = $derived(formEvent ? parseFormTemplate(formEvent) : undefined);
  let submitting = $state(false);
  let error = $state('');

  // Edit mode: editNaddr is a resource (kind 30142) naddr
  /** @type {{ pubkey?: string, identifier?: string, relays?: string[], error?: string } | null} */
  const editTarget = $derived.by(() => {
    if (!editNaddr) return null;
    try {
      const decoded = nip19.decode(editNaddr);
      if (decoded.type !== 'naddr') return { error: 'Invalid edit naddr' };
      const d = /** @type {any} */ (decoded.data);
      if (d.kind !== 30142) return { error: 'Edit target must be a kind-30142 resource' };
      return { pubkey: d.pubkey, identifier: d.identifier, relays: d.relays || [] };
    } catch {
      return { error: 'Invalid edit naddr' };
    }
  });

  /** @type {import('nostr-tools').NostrEvent | undefined} */
  let resourceEvent = $state(undefined);

  $effect(() => {
    if (decoded.error || !decoded.pubkey || !decoded.identifier) return;
    const pubkey = decoded.pubkey;
    const identifier = decoded.identifier;
    const relays = [...(decoded.relays || []), ...getCommunikeyRelays()];

    const loaderSub = addressLoader({ kind: 30168, pubkey, identifier, relays }).subscribe();
    const modelSub = eventStore.replaceable(30168, pubkey, identifier).subscribe((e) => {
      if (e) formEvent = e;
    });
    return () => {
      loaderSub.unsubscribe();
      modelSub.unsubscribe();
    };
  });

  // Load the resource being edited (if any)
  $effect(() => {
    resourceEvent = undefined;
    if (!editTarget || editTarget.error || !editTarget.pubkey || !editTarget.identifier) return;
    const pubkey = editTarget.pubkey;
    const identifier = editTarget.identifier;
    const relays = [...(editTarget.relays || []), ...getEducationalRelays()];

    const loaderSub = addressLoader({ kind: 30142, pubkey, identifier, relays }).subscribe();
    const modelSub = eventStore.replaceable(30142, pubkey, identifier).subscribe((e) => {
      if (e) resourceEvent = e;
    });
    return () => {
      loaderSub.unsubscribe();
      modelSub.unsubscribe();
    };
  });

  // Combine parsed values + selectedConcepts into a FormRenderer-shaped initialValues map
  const initialValues = $derived.by(() => {
    if (!parsed || !resourceEvent || !decoded.pubkey || !decoded.identifier) return undefined;
    const { values: parsedValues, selectedConcepts } = parseAMBResourceForForm(resourceEvent, {
      pubkey: decoded.pubkey,
      dTag: decoded.identifier,
      fields: parsed.fields
    });
    /** @type {Record<string, any>} */
    const out = {};
    for (const field of parsed.fields) {
      if (field.vocab) {
        out[field.id] = selectedConcepts[field.id] || [];
      } else {
        out[field.id] = parsedValues[field.id] ?? '';
      }
    }
    return out;
  });

  const isEditMode = $derived(!!editNaddr && !editTarget?.error);
  const editReady = $derived(!isEditMode || !!resourceEvent);

  /** @param {Record<string, any>} values */
  async function handleSubmit(values) {
    if (!manager.active) {
      error = 'Bitte anmelden.';
      return;
    }
    if (!parsed || !decoded.pubkey || !decoded.identifier) return;
    submitting = true;
    error = '';
    try {
      /** @type {Record<string, any>} */
      const rawValues = {};
      /** @type {Record<string, any>} */
      const selectedConcepts = {};
      for (const field of parsed.fields) {
        const v = values[field.id];
        if (field.vocab && Array.isArray(v)) {
          selectedConcepts[field.id] = v;
          rawValues[field.id] = v.map((c) => c.id);
        } else {
          rawValues[field.id] = v;
        }
      }

      const formRelay = (decoded.relays && decoded.relays[0]) || '';
      const builtTags = buildAMBResourceTags({
        form: { pubkey: decoded.pubkey, dTag: decoded.identifier, fields: parsed.fields },
        formRelay,
        values: rawValues,
        selectedConcepts
      });
      // buildAMBResourceTags MAY emit a 'd' tag itself (e.g. a url field mapped
      // to amb:id via dtagEmitter). Edit mode keeps the resource's existing
      // d-tag for addressable stability; create mode honors the emitted d
      // (the user's typed identifier) and only falls back to a UUID when none
      // was provided — see resolveResourceDTag for why this must not clobber it.
      const emittedD = builtTags.find((t) => t[0] === 'd')?.[1];
      const dTag = resolveResourceDTag({
        isEditMode,
        existingDTag:
          isEditMode && resourceEvent
            ? resourceEvent.tags.find((t) => t[0] === 'd')?.[1]
            : undefined,
        emittedD
      });
      const tags = [['d', dTag], ...builtTags.filter((t) => t[0] !== 'd')];
      // The description field's value (not a tag) becomes the event content.
      const descFieldId = parsed.fields.find((f) => f.output === 'amb:description')?.id;
      const content = (descFieldId ? rawValues[descFieldId] : rawValues.description) || '';

      const template = { kind: 30142, tags, content };
      const factory = createAppEventFactory({ signer: manager.signer });
      const built = await factory.build(template);
      const signed = await factory.sign(built);
      eventStore.add(signed);
      await publishEvent(signed, []);

      const naddr = nip19.naddrEncode({
        kind: 30142,
        pubkey: signed.pubkey,
        identifier: dTag,
        relays: getEducationalRelays().slice(0, 2)
      });
      goto(`/${naddr}`);
    } catch (err) {
      console.error(err);
      error = err instanceof Error ? err.message : 'Veröffentlichung fehlgeschlagen';
    } finally {
      submitting = false;
    }
  }
</script>

<div class="container mx-auto max-w-2xl p-4">
  {#if decoded.error}
    <div class="alert alert-error">{decoded.error}</div>
  {:else if editTarget?.error}
    <div class="alert alert-error">{editTarget.error}</div>
  {:else if !formEvent || !editReady}
    <div class="flex justify-center p-8">
      <span class="loading loading-lg loading-spinner"></span>
    </div>
  {:else if !parsed}
    <div class="alert alert-error">Formular konnte nicht gelesen werden.</div>
  {:else if !manager.active}
    <div class="alert alert-warning">Bitte anmelden, um eine Ressource anzulegen.</div>
  {:else}
    <FormRenderer {formEvent} {initialValues} onsubmit={handleSubmit} />
    {#if submitting}
      <p class="mt-4">Wird veröffentlicht …</p>
    {/if}
    {#if error}
      <p class="mt-4 text-error">{error}</p>
    {/if}
  {/if}
</div>
