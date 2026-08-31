/**
 * EditableList — the `normalize` hook lets relay lists (community wizard,
 * community settings) accept a bare hostname and store the wss:// form.
 * Normalization has to happen BEFORE the duplicate check, otherwise
 * "relay.example.org" slips past an entry already stored as
 * "wss://relay.example.org".
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';

vi.mock('$lib/paraglide/messages', () => ({
  editable_list_default_label: () => 'label',
  editable_list_default_placeholder: () => 'placeholder',
  editable_list_default_button: () => 'Add',
  editable_list_default_item_type: () => 'item',
  editable_list_error_empty: () => 'error_empty',
  editable_list_error_duplicate: () => 'error_duplicate',
  editable_list_error_min_items: () => 'error_min_items',
  editable_list_remove_aria: () => 'remove',
  editable_list_empty_state: () => 'empty_state'
}));

import { normalizeRelayInput } from '$lib/helpers/relay-input.js';
import EditableList from '../shared/EditableList.svelte';

/** @param {string} raw */
const relayNormalize = (raw) => normalizeRelayInput(raw, { trailingSlash: false }) ?? raw;

/**
 * @param {HTMLElement} container
 * @param {string} value
 */
async function addItem(container, value) {
  const input = /** @type {HTMLInputElement} */ (container.querySelector('input[type="text"]'));
  await fireEvent.input(input, { target: { value } });
  const button = /** @type {HTMLButtonElement} */ (
    [...container.querySelectorAll('button')].find((b) => b.textContent?.includes('Add'))
  );
  await fireEvent.click(button);
}

describe('EditableList normalize prop', () => {
  it('stores the normalized value, not the raw input', async () => {
    const { container, getByText } = render(EditableList, {
      props: { items: [], normalize: relayNormalize }
    });

    await addItem(container, 'relay.example.org');

    expect(getByText('wss://relay.example.org')).toBeTruthy();
  });

  it('detects a duplicate typed in bare form', async () => {
    const { container, getByText } = render(EditableList, {
      props: { items: ['wss://relay.example.org'], normalize: relayNormalize }
    });

    await addItem(container, 'relay.example.org');

    expect(getByText('error_duplicate')).toBeTruthy();
    expect(container.querySelectorAll('.bg-base-200').length).toBe(1);
  });

  it('leaves the raw value for the validator to reject when it cannot normalize', async () => {
    const { container, getByText, queryByText } = render(EditableList, {
      props: {
        items: [],
        normalize: relayNormalize,
        validator: (/** @type {string} */ v) => (v.startsWith('wss://') ? null : 'bad relay')
      }
    });

    await addItem(container, 'https://relay.example.org');

    expect(getByText('bad relay')).toBeTruthy();
    expect(queryByText('https://relay.example.org')).toBeNull();
  });

  it('is a no-op when no normalize prop is passed', async () => {
    const { container, getByText } = render(EditableList, { props: { items: [] } });

    await addItem(container, 'some-blossom-server.example');

    expect(getByText('some-blossom-server.example')).toBeTruthy();
  });
});
