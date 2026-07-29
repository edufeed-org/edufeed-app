/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';

// -----------------------------
// Spies that the SUT will import (copied verbatim from FormBuilder.test.js)
// -----------------------------
const buildSpy = vi.hoisted(() =>
  vi.fn(async (/** @type {any} */ tpl) => ({
    ...tpl,
    pubkey: 'author-pub',
    created_at: 1
  }))
);
const signSpy = vi.hoisted(() =>
  vi.fn(async (/** @type {any} */ tpl) => ({ ...tpl, id: 'eid', sig: 'sig' }))
);
const publishEventSpy = vi.hoisted(() => vi.fn(async (/** @type {any} */ _event) => {}));
const eventStoreAddSpy = vi.hoisted(() => vi.fn());
const gotoSpy = vi.hoisted(() => vi.fn());

vi.mock('$lib/helpers/event-factory.js', () => ({
  createAppEventFactory: () => ({ build: buildSpy, sign: signSpy })
}));

vi.mock('$lib/services/publish-service.js', () => ({
  publishEvent: publishEventSpy
}));

vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: { add: eventStoreAddSpy, getReplaceable: () => null },
  pool: {}
}));

vi.mock('$lib/loaders/base.js', () => ({
  addressLoader: () => ({ subscribe: () => ({ unsubscribe: () => {} }) })
}));

vi.mock('$lib/stores/accounts.svelte', () => ({
  manager: { active: { signer: {}, pubkey: 'author-pub' } }
}));

vi.mock('$lib/helpers/relay-helper.js', () => ({
  getCommunikeyRelays: () => ['wss://communikey.example'],
  getAllLookupRelays: () => ['wss://lookup.example'],
  getEventLoaderLookupRelays: () => []
}));

vi.mock('$app/navigation', () => ({ goto: gotoSpy }));

// useSchemeConcepts/useConceptScheme are called from the concept-count preview;
// we return stable getters to avoid real network activity.
vi.mock('$lib/stores/vocab-store.svelte.js', () => ({
  useConceptScheme: () => () => undefined,
  useSchemeConcepts: () => () => [],
  useConceptSchemes: () => () => []
}));

import { parseFormTemplate } from '$lib/helpers/forms.js';
import FormBuilder from '../forms/FormBuilder.svelte';

describe('FormBuilder section authoring', () => {
  beforeEach(() => {
    buildSpy.mockClear();
    signSpy.mockClear();
    publishEventSpy.mockClear();
    eventStoreAddSpy.mockClear();
    gotoSpy.mockClear();
  });

  it('adds a section, assigns a field, and publishes settings.sections', async () => {
    const { container, getByPlaceholderText, getByText } = render(FormBuilder);

    // name the form
    const nameInput = /** @type {HTMLInputElement} */ (
      getByPlaceholderText(/name|title|untitled|namenloses|formular/i)
    );
    await fireEvent.input(nameInput, { target: { value: 'My Form' } });

    // add a section
    const addSectionButton = /** @type {HTMLButtonElement} */ (
      Array.from(container.querySelectorAll('button')).find((b) =>
        /add section|abschnitt hinzuf/i.test(b.textContent || '')
      )
    );
    expect(addSectionButton, 'FormBuilder must offer an "Add section" button').toBeTruthy();
    await fireEvent.click(addSectionButton);

    // set the section title (placeholder = "Section title")
    const sectionTitleInput = /** @type {HTMLInputElement} */ (
      container.querySelector('[role="listitem"][data-item-type="section"] input[type="text"]')
    );
    expect(sectionTitleInput, 'expected a section title input').toBeTruthy();
    await fireEvent.input(sectionTitleInput, { target: { value: 'Basics' } });

    // add a text field, which falls after the section marker
    await fireEvent.click(getByText('text'));

    // the field row's label input is the first text input inside its listitem
    const fieldRows = container.querySelectorAll('[role="listitem"][data-item-type="field"]');
    const fieldRow = fieldRows[fieldRows.length - 1];
    const labelInput = /** @type {HTMLInputElement} */ (
      fieldRow.querySelector('input[type="text"]')
    );
    expect(labelInput, 'expected a field label input').toBeTruthy();
    await fireEvent.input(labelInput, { target: { value: 'Title' } });
    await fireEvent.change(labelInput, { target: { value: 'Title' } });

    // publish
    const publishButton = /** @type {HTMLButtonElement} */ (
      container.querySelector('button.btn-primary')
    );
    await fireEvent.click(publishButton);

    await Promise.resolve();
    await Promise.resolve();

    const signed = publishEventSpy.mock.calls.at(-1)?.[0];
    expect(signed).toBeTruthy();
    const parsed = parseFormTemplate(signed);
    expect(parsed.sections.length).toBe(1);
    expect(parsed.sections[0].title).toBe('Basics');
    expect(parsed.sections[0].questionIds.length).toBe(1);
    // the section marker is NOT a field
    expect(parsed.fields.every((f) => f.type !== 'section')).toBe(true);
  });
});
