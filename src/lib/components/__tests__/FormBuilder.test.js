/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import { nip19 } from 'nostr-tools';

// -----------------------------
// Spies that the SUT will import
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
const publishEventSpy = vi.hoisted(() => vi.fn(async () => {}));
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
  getAllLookupRelays: () => ['wss://lookup.example']
}));

vi.mock('$app/navigation', () => ({ goto: gotoSpy }));

// useSchemeConcepts/useConceptScheme are called from the concept-count preview;
// we return stable getters to avoid real network activity.
vi.mock('$lib/stores/vocab-store.svelte.js', () => ({
  useConceptScheme: () => () => undefined,
  useSchemeConcepts: () => () => [],
  useConceptSchemes: () => () => []
}));

import FormBuilder from '../forms/FormBuilder.svelte';

describe('FormBuilder: vocab + output authoring', () => {
  beforeEach(() => {
    buildSpy.mockClear();
    signSpy.mockClear();
    publishEventSpy.mockClear();
    eventStoreAddSpy.mockClear();
    gotoSpy.mockClear();
  });

  it('emits field-vocab and field-output tags from user input', async () => {
    const schemePubkey = 'a'.repeat(64);
    const schemeNaddr = nip19.naddrEncode({
      kind: 39737,
      pubkey: schemePubkey,
      identifier: 'schulfaecher',
      relays: ['wss://vocab.example']
    });

    const { container, getByPlaceholderText, getByText } = render(FormBuilder);

    // Fill form name (auto-derives d-tag)
    const nameInput = /** @type {HTMLInputElement} */ (
      getByPlaceholderText(/name|title|untitled|namenloses|formular/i)
    );
    await fireEvent.input(nameInput, { target: { value: 'My Vocab Form' } });

    // Add a select field
    await fireEvent.click(getByText('select'));

    // Set field label (the first text input inside the newly-added field row)
    const labelInput = /** @type {HTMLInputElement} */ (
      container.querySelector('[role="listitem"] input[type="text"]')
    );
    expect(labelInput).toBeTruthy();
    await fireEvent.input(labelInput, { target: { value: 'Fach' } });
    await fireEvent.change(labelInput, { target: { value: 'Fach' } });

    // The new field starts in the "unset" source-chooser state. Click the
    // "Use a vocabulary" CTA to reveal the per-field vocab naddr input.
    const vocabCta = /** @type {HTMLButtonElement | undefined} */ (
      Array.from(container.querySelectorAll('button')).find((b) =>
        /vocabulary|vokabular/i.test(b.textContent || '')
      )
    );
    expect(vocabCta, 'FormBuilder must offer a "Use a vocabulary" CTA').toBeTruthy();
    await fireEvent.click(/** @type {HTMLButtonElement} */ (vocabCta));

    // Paste scheme naddr into the per-field vocab input.
    const vocabInput = /** @type {HTMLInputElement} */ (
      container.querySelector('[data-testid="field-vocab-input"]')
    );
    expect(vocabInput, 'FormBuilder must render a vocab naddr input per field').toBeTruthy();
    await fireEvent.input(vocabInput, { target: { value: schemeNaddr } });
    await fireEvent.blur(vocabInput);

    // Change the output target
    const outputSelect = /** @type {HTMLSelectElement} */ (
      container.querySelector('[data-testid="field-output-select"]')
    );
    expect(outputSelect, 'FormBuilder must render a field-output select per field').toBeTruthy();
    await fireEvent.change(outputSelect, { target: { value: 'amb:about' } });

    // Click publish (button text varies between "Publish" / "Veröffentlichen")
    const publishButton = /** @type {HTMLButtonElement} */ (
      container.querySelector('button.btn-primary')
    );
    expect(publishButton).toBeTruthy();
    await fireEvent.click(publishButton);

    // Allow microtasks for the async publish() handler
    await Promise.resolve();
    await Promise.resolve();

    expect(buildSpy).toHaveBeenCalledTimes(1);
    const template = buildSpy.mock.calls[0][0];
    expect(template.kind).toBe(30168);

    const vocabTag = template.tags.find((/** @type {string[]} */ t) => t[0] === 'field-vocab');
    expect(vocabTag, 'expected a field-vocab tag in published template').toBeTruthy();
    expect(vocabTag[2]).toBe('a');
    expect(vocabTag[3]).toBe(`39737:${schemePubkey}:schulfaecher`);
    expect(vocabTag[4]).toBe('wss://vocab.example');

    const outputTag = template.tags.find((/** @type {string[]} */ t) => t[0] === 'field-output');
    expect(outputTag, 'expected a field-output tag in published template').toBeTruthy();
    expect(outputTag[2]).toBe('amb:about');
  });
});
