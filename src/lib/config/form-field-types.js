/**
 * Field-type registry: maps a field's rich type (settings.renderElement on
 * the wire) to a Svelte component implementing the registry contract
 * { field, value, error, readonly, onchange }, plus `values` (the form's
 * current answers) for fields that depend on another answer (`datetime`). Types absent here fall back
 * to FieldsRenderer's built-in branches, and unknown types degrade to a
 * plain text input (NIP-101: everything derives from text).
 */
import DateField from '$lib/components/forms/fields/DateField.svelte';
import DateTimeField from '$lib/components/forms/fields/DateTimeField.svelte';
import CreatorFieldAdapter from '$lib/components/forms/fields/CreatorFieldAdapter.svelte';
import RelationFieldAdapter from '$lib/components/forms/fields/RelationFieldAdapter.svelte';
import ExternalUrlFieldAdapter from '$lib/components/forms/fields/ExternalUrlFieldAdapter.svelte';
import DoiFieldAdapter from '$lib/components/forms/fields/DoiFieldAdapter.svelte';

/** @type {Record<string, any>} */
export const FIELD_TYPE_REGISTRY = {
  date: DateField,
  datetime: DateTimeField,
  creator: CreatorFieldAdapter,
  'amb-relation': RelationFieldAdapter,
  'external-urls': ExternalUrlFieldAdapter,
  doi: DoiFieldAdapter
};

/** @param {string} type */
export function getFieldComponent(type) {
  return FIELD_TYPE_REGISTRY[type];
}
