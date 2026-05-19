<!--
  ExtensionMetadataPanel
  ----------------------
  Renders all NIP-AMB extension metadata (`ext:<ns>:<facet>(:<sub>)?` tags,
  plus the legacy unprefixed `ekw:<facet>(:<sub>)?` shape) attached to a
  kind-30142 resource event.

  Three label-resolution strategies, in priority order:

    1. **Form-driven** — when `<ns>` is `30168:<pub>:<d>` AND the resource
       carries an `["a", <ns>, <relay>, "form"]` back-ref, subscribe to the
       referenced kind-30168 form via `eventStore.replaceable` (with an
       address-loader for network fallback) and use the form authors
       `field.label` for each facet.
    2. **Registered variant** — when `<ns>` matches a registered variant
       in `resource-form-variants.js` that declares `extensionLabels`,
       map facet ids to Paraglide message keys for both the section
       heading and per-row labels.
    3. **Humanized facet id** — fallback for unknown deployments. Splits
       camelCase / kebab-case into Title Case ("gradeLevel" → "Grade Level").
-->

<script>
  import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
  import { addressLoader } from '$lib/loaders/base.js';
  import { getCommunikeyRelays } from '$lib/helpers/relay-helper.js';
  import { parseExtensionTags } from '$lib/helpers/educational/parseExtensionTags.js';
  import { parseFormTemplate } from '$lib/helpers/forms.js';
  import { getFormReferenceFromResource } from '$lib/helpers/form-to-amb.js';
  import { ALL_VARIANTS, EXTENSION_NAMESPACE_LABELS } from '$lib/config/resource-form-variants.js';
  import { toDieBibelUrl } from '$lib/helpers/educational/bibleReference.js';
  import { CheckIcon } from '$lib/components/icons';
  import * as m from '$lib/paraglide/messages.js';
  import { getLocale } from '$lib/paraglide/runtime.js';

  /**
   * Classify a scalar facet as a boolean (single 'true' / 'false' value).
   * @param {{ kind: string, items: string[] }} facet
   * @returns {boolean | null} true / false for booleans, null otherwise.
   */
  function booleanFacetValue(facet) {
    if (facet.kind === 'concept') return null;
    if (facet.items.length !== 1) return null;
    const v = facet.items[0];
    if (v === 'true') return true;
    if (v === 'false') return false;
    return null;
  }

  /**
   * @typedef {Object} Props
   * @property {{ tags?: string[][] | null } | null | undefined} event
   */

  /** @type {Props} */
  let { event } = $props();

  // 1. Pure parse step — recompute whenever the event's tags change.
  const parsed = $derived(parseExtensionTags(event ?? null));

  // 2. Form back-reference (used to resolve a 30168 form for label lookup).
  // The helper expects a full NostrEvent, but only reads `tags` — narrow with
  // a structural cast so the panel can accept a minimal `{ tags }` event in
  // tests without forcing callers to construct a full event shape.
  const formRef = $derived(event ? getFormReferenceFromResource(/** @type {any} */ (event)) : null);
  const formCoord = $derived(parseFormCoord(formRef?.address));

  // 3. Subscribe to the form event when the resource references one.
  let formEvent = $state(/** @type {any} */ (null));
  $effect(() => {
    formEvent = null;
    if (!formCoord) return;
    const { pubkey, identifier } = formCoord;
    const relays = [...(formRef?.relay ? [formRef.relay] : []), ...getCommunikeyRelays()];
    const loaderSub = addressLoader({
      kind: 30168,
      pubkey,
      identifier,
      relays
    }).subscribe();
    const modelSub = eventStore
      .replaceable(30168, pubkey, identifier)
      .subscribe((/** @type {any} */ ev) => {
        if (ev) formEvent = ev;
      });
    return () => {
      loaderSub.unsubscribe();
      modelSub.unsubscribe();
    };
  });

  // Map fieldId → { label } from the resolved form template (form-driven path).
  const formFieldLabels = $derived.by(() => {
    if (!formEvent) return /** @type {Record<string, string>} */ ({});
    try {
      const template = parseFormTemplate(formEvent);
      /** @type {Record<string, string>} */
      const map = {};
      for (const f of template.fields) map[f.id] = f.label || f.id;
      return map;
    } catch {
      return /** @type {Record<string, string>} */ ({});
    }
  });

  // Build registered-variant lookup keyed by ns. Only variants declaring
  // `extensionLabels` participate. The `ns` in tag keys for variants is the
  // variant id (e.g. "ekw"); for form-driven content it is the form coord.
  const variantsByNs = $derived(
    new Map(ALL_VARIANTS.filter((v) => v.extensionLabels).map((v) => [v.id, v]))
  );

  // Final render model: an array of namespace sections, each with section
  // heading + per-facet label + items.
  const sections = $derived.by(() => {
    /** @type {{ ns: string, sectionLabel: string, facets: { facetName: string, label: string, kind: 'concept'|'scalar', items: any[] }[] }[]} */
    const out = [];
    for (const [ns, nsEntry] of parsed.namespaces) {
      const isFormDriven = !!formCoord && ns === formCoordToNs(formCoord);
      // Registry takes precedence over variant lookup; this lets nested
      // namespaces (e.g. `ekw:konfi`) declare labels without a 1:1 variant.id.
      const nsLabels = EXTENSION_NAMESPACE_LABELS[ns] ?? variantsByNs.get(ns)?.extensionLabels;

      const sectionLabel = isFormDriven
        ? formEvent
          ? readFormName(formEvent)
          : humanize(ns)
        : nsLabels?.sectionKey
          ? translate(nsLabels.sectionKey)
          : humanize(ns);

      const facets = [];
      for (const [facetName, facet] of nsEntry.facets) {
        let label;
        if (isFormDriven && formFieldLabels[facetName]) {
          label = formFieldLabels[facetName];
        } else if (nsLabels?.facets?.[facetName]) {
          label = translate(nsLabels.facets[facetName]);
        } else {
          label = humanize(facetName);
        }
        facets.push({ facetName, label, kind: facet.kind, items: facet.items });
      }
      if (facets.length > 0) out.push({ ns, sectionLabel, facets });
    }
    return out;
  });

  /**
   * @param {{ id: string, prefLabels: Record<string, string> }} item
   */
  function pickLabel(item) {
    const locale = getLocale();
    return (
      item.prefLabels[locale] ||
      item.prefLabels.de ||
      item.prefLabels.en ||
      Object.values(item.prefLabels)[0] ||
      item.id
    );
  }

  /**
   * @param {string | undefined} address  e.g. "30168:<pub>:<d>"
   * @returns {{ pubkey: string, identifier: string } | null}
   */
  function parseFormCoord(address) {
    if (!address) return null;
    const parts = address.split(':');
    if (parts.length < 3 || parts[0] !== '30168') return null;
    return { pubkey: parts[1], identifier: parts.slice(2).join(':') };
  }

  /**
   * @param {{ pubkey: string, identifier: string }} c
   */
  function formCoordToNs(c) {
    return `30168:${c.pubkey}:${c.identifier}`;
  }

  /**
   * @param {any} ev
   */
  function readFormName(ev) {
    const tags = Array.isArray(ev?.tags) ? ev.tags : [];
    return (
      tags.find((/** @type {any} */ t) => t[0] === 'name')?.[1] ||
      humanize(formCoord?.identifier ?? '')
    );
  }

  /**
   * Convert "someFieldId" / "some-field-id" / "30168:abc:my-form" into a
   * human-readable Title Case string.
   * @param {string} s
   */
  function humanize(s) {
    if (!s) return '';
    return s
      .replace(/^30168:/, '')
      .replace(/[-_:]/g, ' ')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  }

  /**
   * Look up a paraglide message by key. Returns the humanized key as a fallback
   * if the key is missing (e.g. variant declares a key paraglide doesn't have).
   * @param {string} key
   */
  function translate(key) {
    /** @type {any} */
    const fn = /** @type {Record<string, any>} */ (m)[key];
    if (typeof fn === 'function') return fn();
    return humanize(key);
  }
</script>

{#if sections.length > 0}
  {#each sections as section (section.ns)}
    <div class="mb-8">
      <h2 class="mb-4 text-2xl font-bold text-base-content">
        {section.sectionLabel}
      </h2>

      <div class="grid gap-6 md:grid-cols-2">
        {#each section.facets as facet (facet.facetName)}
          {@const boolValue = booleanFacetValue(facet)}
          {#if boolValue === false}
            <!-- Hide rows representing a boolean flag set to false -->
          {:else}
            <div class="rounded-lg bg-base-200 p-4">
              {#if boolValue === true}
                <div class="flex items-center gap-2">
                  <CheckIcon class_="w-5 h-5 text-success" />
                  <span class="font-medium text-base-content">{facet.label}</span>
                </div>
              {:else}
                <h3 class="mb-2 text-sm font-semibold text-base-content/70">
                  {facet.label}
                </h3>

                {#if facet.kind === 'concept'}
                  <div class="flex flex-wrap gap-2">
                    {#each facet.items as item (item.id)}
                      <span class="badge badge-secondary">{pickLabel(item)}</span>
                    {/each}
                  </div>
                {:else}
                  <div class="flex flex-wrap gap-2">
                    {#each facet.items as value, i (value + '|' + i)}
                      {@const bibleUrl = toDieBibelUrl(value)}
                      {@const isLongText = value.includes('\n') || value.length > 40}
                      {#if bibleUrl}
                        <a
                          href={bibleUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          class="badge link badge-ghost font-mono link-hover"
                        >
                          {value}
                        </a>
                      {:else if isLongText}
                        <p class="w-full text-sm whitespace-pre-wrap text-base-content">{value}</p>
                      {:else}
                        <span class="badge badge-ghost font-mono">{value}</span>
                      {/if}
                    {/each}
                  </div>
                {/if}
              {/if}
            </div>
          {/if}
        {/each}
      </div>
    </div>
  {/each}
{/if}
