/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import { buildFormTemplateTags, parseFormTemplate } from '$lib/helpers/forms.js';

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

import FormBuilder from '../forms/FormBuilder.svelte';

describe('FormBuilder: sections + displayIf round-trip', () => {
  beforeEach(() => {
    buildSpy.mockClear();
    signSpy.mockClear();
    publishEventSpy.mockClear();
    eventStoreAddSpy.mockClear();
    gotoSpy.mockClear();
  });

  it('preserves sections and per-field displayIf when re-saving an existing sectioned/branching template', async () => {
    const displayIf = { rules: [{ questionId: 'q', value: 'yes' }] };
    const sections = [{ id: 's1', title: 'Step 1', questionIds: ['q', 'detail'] }];
    const tags = buildFormTemplateTags(
      'branching-form',
      [
        {
          id: 'q',
          type: 'radio',
          label: 'Ready?',
          options: {
            options: [
              { id: 'yes', label: 'Yes' },
              { id: 'no', label: 'No' }
            ]
          }
        },
        {
          id: 'detail',
          type: 'text',
          label: 'Details',
          options: { displayIf }
        }
      ],
      { name: 'Branching', sections }
    );
    const existingEvent = {
      kind: 30168,
      pubkey: 'author-pub',
      id: 'orig-id',
      created_at: 0,
      content: '',
      sig: 'sig',
      tags
    };

    const { container } = render(FormBuilder, { props: { existingEvent } });

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

    const reparsed = parseFormTemplate({
      kind: 30168,
      pubkey: 'author-pub',
      tags: template.tags,
      content: '',
      created_at: 0
    });

    expect(reparsed.sections).toEqual(sections);
    const detailField = reparsed.fields.find((f) => f.id === 'detail');
    expect(detailField?.options?.displayIf).toEqual(displayIf);
  });
});
