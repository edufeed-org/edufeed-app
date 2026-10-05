<!--
  EventAttributesSummary — compact read-only badges for a calendar event's
  educational extension attributes (issue #13): registration, cost,
  attendance mode, educational levels. Renders nothing without statements.
-->
<script>
  import * as m from '$lib/paraglide/messages';
  import { getLocale } from '$lib/paraglide/runtime.js';
  import { getPriceKind, hasEventAttributes } from '$lib/helpers/calendar-attributes.js';
  import { pickConceptLabel } from '$lib/helpers/educational/educatorProfile.js';
  import { extractLabelFromUri } from '$lib/helpers/educational/skosLoader.js';

  /** @type {{ attributes?: import('$lib/helpers/calendar-attributes.js').CalendarEventAttributes }} */
  let { attributes } = $props();

  const locale = $derived(getLocale());
  const priceKind = $derived(getPriceKind(attributes?.price));
  const paidText = $derived(
    m
      .event_attrs_price_paid_amount({
        amount: attributes?.price?.amount ?? '',
        currency: attributes?.price?.currency ?? ''
      })
      .trim()
  );
  const modeLabel = $derived(
    attributes?.attendanceMode === 'online'
      ? m.event_attrs_mode_online()
      : attributes?.attendanceMode === 'offline'
        ? m.event_attrs_mode_offline()
        : attributes?.attendanceMode === 'mixed'
          ? m.event_attrs_mode_mixed_short()
          : ''
  );
  const levels = $derived(
    (attributes?.educationalLevels ?? []).map((c) => ({
      id: c.id,
      label: pickConceptLabel(c.labels, locale) || extractLabelFromUri(c.id)
    }))
  );
</script>

{#if hasEventAttributes(attributes)}
  <div class="flex flex-wrap items-center gap-1.5" data-testid="event-attributes-summary">
    {#if attributes?.registrationRequired === true}
      <span class="badge badge-outline badge-sm">{m.event_attrs_registration_required()}</span>
    {:else if attributes?.registrationRequired === false}
      <span class="badge badge-outline badge-sm">{m.event_attrs_registration_not_required()}</span>
    {/if}
    {#if priceKind === 'free'}
      <span class="badge badge-outline badge-sm">{m.event_attrs_price_free()}</span>
    {:else if priceKind === 'paid'}
      <span class="badge badge-outline badge-sm">{paidText}</span>
    {/if}
    {#if modeLabel}
      <span class="badge badge-outline badge-sm">{modeLabel}</span>
    {/if}
    {#if levels.length > 0}
      <span class="ml-1 text-xs text-base-content/60">{m.event_attrs_levels_label()}:</span>
      {#each levels as level (level.id)}
        <span class="badge badge-outline badge-sm badge-primary">{level.label}</span>
      {/each}
    {/if}
  </div>
{/if}
