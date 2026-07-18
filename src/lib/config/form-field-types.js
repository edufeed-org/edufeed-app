/**
 * Field-type registry: maps a field's rich type (settings.renderElement on
 * the wire) to a Svelte component implementing the registry contract
 * { field, value, error, readonly, onchange }. Types absent here fall back
 * to FieldsRenderer's built-in branches, and unknown types degrade to a
 * plain text input (NIP-101: everything derives from text).
 */
import DateField from '$lib/components/forms/fields/DateField.svelte';

/** @type {Record<string, any>} */
export const FIELD_TYPE_REGISTRY = {
  date: DateField
};

/** @param {string} type */
export function getFieldComponent(type) {
  return FIELD_TYPE_REGISTRY[type];
}
