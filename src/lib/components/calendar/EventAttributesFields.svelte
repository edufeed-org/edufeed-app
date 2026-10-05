<!--
  EventAttributesFields — the educational extension attributes of a calendar
  event (NIP-52-Edufeed, issue #13): registration, cost, attendance mode and
  educational level. Every field defaults to "keine Angabe", which writes no
  tag. Bound value shape: CalendarEventAttributes (helpers/calendar-attributes.js).
-->
<script>
  import * as m from '$lib/paraglide/messages';
  import FormConceptPicker from '$lib/components/forms/FormConceptPicker.svelte';
  import { resolveVocabField } from '$lib/helpers/educational/vocabResolver.js';
  import {
    DEFAULT_CURRENCY,
    emptyEventAttributes,
    getPriceKind
  } from '$lib/helpers/calendar-attributes.js';

  /** @typedef {import('$lib/helpers/calendar-attributes.js').CalendarEventAttributes} CalendarEventAttributes */

  // No bindable fallback: the event form's state may hold `undefined` here
  // (Svelte forbids a fallback on a bound undefined prop); treat it as empty.
  /** @type {{ attributes?: CalendarEventAttributes, disabled?: boolean }} */
  let { attributes = $bindable(), disabled = false } = $props();

  // Same KIM educationalLevel vocabulary (SKOS kind 39737) as the AMB resource
  // form; the picker is hidden when the deployment configures none.
  const levelField = $derived(resolveVocabField('educationalLevel'));

  // "Kostenpflichtig" is picked before an amount exists; remember the choice
  // so an empty or "0" amount being typed doesn't flip the select around.
  let paidSelected = $state(false);

  const registrationChoice = $derived(
    attributes?.registrationRequired === true
      ? 'true'
      : attributes?.registrationRequired === false
        ? 'false'
        : ''
  );
  const priceChoice = $derived(
    !attributes?.price
      ? ''
      : paidSelected || getPriceKind(attributes.price) !== 'free'
        ? 'paid'
        : 'free'
  );
  const levelValue = $derived(
    (attributes?.educationalLevels ?? []).map((c) => ({
      id: c.id,
      nostrCoord: '',
      relay: levelField?.vocab.relay ?? '',
      labels: { ...c.labels }
    }))
  );

  /** @param {Partial<CalendarEventAttributes>} patch */
  function update(patch) {
    attributes = { ...emptyEventAttributes(), ...attributes, ...patch };
  }

  /** @param {Event} e */
  function handleRegistration(e) {
    const value = /** @type {HTMLSelectElement} */ (e.currentTarget).value;
    update({ registrationRequired: value === '' ? undefined : value === 'true' });
  }

  /** @param {Event} e */
  function handlePriceChoice(e) {
    const value = /** @type {HTMLSelectElement} */ (e.currentTarget).value;
    const currency = attributes?.price?.currency || DEFAULT_CURRENCY;
    paidSelected = value === 'paid';
    if (value === 'free') update({ price: { amount: '0', currency } });
    else if (value === 'paid') update({ price: { amount: '', currency } });
    else update({ price: undefined });
  }

  /** @param {Event} e */
  function handleAmount(e) {
    const amount = /** @type {HTMLInputElement} */ (e.currentTarget).value;
    update({ price: { amount, currency: attributes?.price?.currency || DEFAULT_CURRENCY } });
  }

  /** @param {Event} e */
  function handleCurrency(e) {
    const currency = /** @type {HTMLInputElement} */ (e.currentTarget).value.trim().toUpperCase();
    update({ price: { amount: attributes?.price?.amount ?? '', currency } });
  }

  /** @param {Event} e */
  function handleMode(e) {
    const value = /** @type {HTMLSelectElement} */ (e.currentTarget).value;
    update({
      attendanceMode:
        value === 'online' || value === 'offline' || value === 'mixed' ? value : undefined
    });
  }

  /** @param {import('$lib/helpers/educational/formReference.js').SelectedConcept[]} picked */
  function handleLevels(picked) {
    update({
      educationalLevels: picked.map((c) => ({ id: c.id, labels: { ...(c.labels ?? {}) } }))
    });
  }

  const priceAmountInvalid = $derived(
    priceChoice === 'paid' &&
      (attributes?.price?.amount ?? '') !== '' &&
      getPriceKind(attributes?.price) === undefined
  );
</script>

<fieldset class="rounded-lg border border-base-300 p-4" data-testid="event-attributes-fields">
  <legend class="px-1 text-sm font-semibold text-base-content">{m.event_attrs_section()}</legend>

  <div class="grid grid-cols-1 gap-4 md:grid-cols-3">
    <div>
      <label for="event-attr-registration" class="mb-1 block text-sm font-medium text-base-content"
        >{m.event_attrs_registration_label()}</label
      >
      <select
        id="event-attr-registration"
        class="select-bordered select w-full"
        value={registrationChoice}
        onchange={handleRegistration}
        {disabled}
      >
        <option value="">{m.event_attrs_no_statement()}</option>
        <option value="true">{m.event_attrs_yes()}</option>
        <option value="false">{m.event_attrs_no()}</option>
      </select>
    </div>

    <div>
      <label for="event-attr-price" class="mb-1 block text-sm font-medium text-base-content"
        >{m.event_attrs_price_label()}</label
      >
      <select
        id="event-attr-price"
        class="select-bordered select w-full"
        value={priceChoice}
        onchange={handlePriceChoice}
        {disabled}
      >
        <option value="">{m.event_attrs_no_statement()}</option>
        <option value="free">{m.event_attrs_price_free()}</option>
        <option value="paid">{m.event_attrs_price_paid()}</option>
      </select>
    </div>

    <div>
      <label for="event-attr-mode" class="mb-1 block text-sm font-medium text-base-content"
        >{m.event_attrs_mode_label()}</label
      >
      <select
        id="event-attr-mode"
        class="select-bordered select w-full"
        value={attributes?.attendanceMode ?? ''}
        onchange={handleMode}
        {disabled}
      >
        <option value="">{m.event_attrs_no_statement()}</option>
        <option value="offline">{m.event_attrs_mode_offline()}</option>
        <option value="online">{m.event_attrs_mode_online()}</option>
        <option value="mixed">{m.event_attrs_mode_mixed()}</option>
      </select>
    </div>
  </div>

  {#if priceChoice === 'paid'}
    <div class="mt-4 grid grid-cols-2 gap-4 md:grid-cols-3">
      <div>
        <label for="event-attr-amount" class="mb-1 block text-sm font-medium text-base-content"
          >{m.event_attrs_price_amount()}</label
        >
        <input
          id="event-attr-amount"
          type="text"
          inputmode="decimal"
          class="input-bordered input w-full"
          class:input-error={priceAmountInvalid}
          value={attributes?.price?.amount ?? ''}
          oninput={handleAmount}
          placeholder="25"
          {disabled}
        />
      </div>
      <div>
        <label for="event-attr-currency" class="mb-1 block text-sm font-medium text-base-content"
          >{m.event_attrs_price_currency()}</label
        >
        <input
          id="event-attr-currency"
          type="text"
          maxlength="3"
          class="input-bordered input w-full uppercase"
          value={attributes?.price?.currency ?? DEFAULT_CURRENCY}
          oninput={handleCurrency}
          {disabled}
        />
      </div>
    </div>
    {#if priceAmountInvalid}
      <p class="mt-1 text-xs text-error">{m.event_attrs_price_invalid()}</p>
    {/if}
  {/if}
  <p class="mt-2 text-xs text-base-content/60">{m.event_attrs_help()}</p>

  {#if levelField}
    <div class="mt-4">
      <span class="mb-1 block text-sm font-medium text-base-content"
        >{m.event_attrs_levels_label()}</span
      >
      <FormConceptPicker
        field={levelField}
        multiple={true}
        value={levelValue}
        onchange={handleLevels}
        {disabled}
      />
    </div>
  {/if}
</fieldset>
