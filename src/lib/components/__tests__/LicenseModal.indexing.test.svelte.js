// @ts-nocheck
/** @vitest-environment jsdom */
/**
 * LicenseModal — the optional indexing section: keywords (`t`) and subjects
 * (`about:*` triples) on the kind-1063 attestation, carried over from an
 * existing attestation when re-attesting.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor, cleanup } from '@testing-library/svelte';
import { tick } from 'svelte';

const h = vi.hoisted(() => ({ subjectField: /** @type {any} */ (null) }));

const mockSignEvent = vi.fn(async (template) => ({
  ...template,
  id: 'signed-id',
  pubkey: 'b'.repeat(64),
  sig: 'c'.repeat(128)
}));
vi.mock('$lib/stores/accounts.svelte', () => ({
  manager: {
    get active() {
      return { pubkey: 'b'.repeat(64), signEvent: mockSignEvent };
    }
  }
}));
vi.mock('$lib/services/publish-service.js', () => ({ publishEventOptimistic: vi.fn() }));
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({ eventStore: { add: vi.fn() } }));
vi.mock('$lib/helpers/event-factory.js', () => ({
  createAppEventFactory: () => ({
    /** @param {any} template */
    build: async (template) => ({ ...template, created_at: 1000, pubkey: 'b'.repeat(64) })
  })
}));
vi.mock('$lib/helpers/educational/licenseOptions.js', () => ({
  getLicenseOptions: () => [
    { id: 'https://creativecommons.org/licenses/by/4.0/', label: 'CC BY 4.0' }
  ]
}));
vi.mock('$lib/helpers/educational/vocabResolver.js', () => ({
  resolveVocabField: (/** @type {string} */ key) => (key === 'schulfaecher' ? h.subjectField : null)
}));
vi.mock(
  '$lib/components/forms/FormConceptPicker.svelte',
  () => import('./fixtures/FormConceptPickerStub.svelte')
);
vi.mock('$lib/paraglide/runtime.js', () => ({ getLocale: () => 'de' }));
vi.mock('$lib/paraglide/messages', () => ({
  license_modal_title: () => 'License this image',
  license_modal_description: () => 'description',
  license_modal_existing_title: () => 'License already attested',
  license_modal_existing_description: () => 'someone has filed a license',
  license_modal_accept_existing: () => 'Use this license',
  license_modal_create_own: () => 'Create my own',
  license_modal_attested_by: () => 'Attested by',
  license_modal_license_label: () => 'License',
  license_modal_title_field_label: () => 'Title of the work',
  license_modal_title_field_placeholder: () => 'Title placeholder',
  license_modal_credit_label: () => 'Credit',
  license_modal_credit_placeholder: () => 'Credit',
  license_modal_self_creator: () => 'I am the creator',
  license_modal_source_label: () => 'Source URL',
  license_modal_ai_label: () => 'AI involvement',
  license_modal_ai_none: () => 'None',
  license_modal_ai_generated: () => 'Fully AI-generated',
  license_modal_ai_modified: () => 'Partially AI-modified',
  license_modal_ai_section_title: () => 'AI provenance & usage',
  license_modal_indexing_section_title: () => 'Indexing (optional)',
  license_modal_indexing_hint: () => 'indexing hint',
  license_modal_keywords_label: () => 'Keywords',
  license_modal_subjects_label: () => 'Subject',
  license_modal_remove_keyword: ({ keyword }) => `Remove keyword ${keyword}`,
  license_modal_remove_subject: ({ subject }) => `Remove subject ${subject}`,
  amb_form_placeholder_keywords: () => 'Enter, Tab or comma to add',
  license_modal_ai_training_label: () => 'Usable for AI training',
  license_modal_ai_training_hint: () => 'training hint',
  license_modal_ai_training_row_label: () => 'AI training',
  license_modal_ai_training_allowed: () => 'allowed',
  license_modal_ai_training_disallowed: () => 'not allowed',
  license_modal_ai_tool_label: () => 'Tool / model',
  license_modal_ai_tool_unknown: () => 'Not specified / unknown',
  license_modal_ai_tool_other: () => 'Other…',
  license_modal_ai_tool_other_placeholder: () => 'tool name',
  license_modal_ai_edited_label: () => 'Manually edited afterwards',
  license_modal_ai_edited_hint: () => 'edited hint',
  image_ai_label_generated: () => 'AI generated',
  image_ai_label_modified: () => 'AI modified',
  license_modal_description_label: () => 'Description',
  license_modal_save: () => 'Save',
  license_modal_cancel: () => 'Cancel',
  license_modal_publish_failed: () => 'Publish failed',
  license_modal_error_missing_hash: () => 'Missing hash',
  amb_form_validation_image_license_missing: () => 'License missing',
  license_modal_disclosure_label: () => 'I confirm responsibility',
  license_modal_disclosure_required_error: () => 'Please confirm'
}));

import LicenseModal from '$lib/components/shared/LicenseModal.svelte';

const SUBJECT_FIELD = {
  type: 'concept-picker',
  id: 'schulfaecher',
  label: 'schulfaecher',
  vocab: { address: '39737:pub:schulfaecher', relay: 'wss://r.example' }
};

const baseProps = {
  open: true,
  hash: 'a'.repeat(64),
  url: 'https://blossom.example/abc.jpg',
  mime: 'image/jpeg',
  size: 100,
  existingLicense: null
};

/** @param {ReturnType<typeof render>} r */
async function fillAndSave(r) {
  await fireEvent.input(r.getByLabelText('Credit'), { target: { value: 'Jane Doe' } });
  await fireEvent.click(r.getByTestId('license-modal-disclosure'));
  await fireEvent.click(r.getByTestId('license-modal-save'));
  await waitFor(() => expect(mockSignEvent).toHaveBeenCalled());
  return /** @type {string[][]} */ (mockSignEvent.mock.calls[0][0].tags);
}

beforeEach(() => {
  cleanup();
  mockSignEvent.mockClear();
  h.subjectField = SUBJECT_FIELD;
});

describe('LicenseModal — indexing section', () => {
  it('writes keywords typed into the section as lowercase t tags, deduped, and no about:* without a subject', async () => {
    const r = render(LicenseModal, { props: baseProps });
    await waitFor(() => r.getByTestId('license-modal-save'));
    const input = r.getByTestId('license-modal-keywords');
    await fireEvent.input(input, { target: { value: '#BarCamp, Metadaten' } });
    await fireEvent.keyDown(input, { key: 'Enter' });
    await fireEvent.input(input, { target: { value: 'barcamp' } });
    await fireEvent.keyDown(input, { key: 'Enter' });
    await tick();
    const chips = [...r.getByTestId('license-modal-keyword-chips').querySelectorAll('.badge')].map(
      (b) => b.textContent?.replace('✕', '').trim()
    );
    expect(chips).toEqual(['barcamp', 'metadaten']);

    const tags = await fillAndSave(r);
    expect(tags.filter((t) => t[0] === 't')).toEqual([
      ['t', 'barcamp'],
      ['t', 'metadaten']
    ]);
    expect(tags.some((t) => t[0].startsWith('about:'))).toBe(false);
  });

  it('writes a picked subject as an about:* triple and lists it as a removable chip', async () => {
    const r = render(LicenseModal, { props: baseProps });
    await waitFor(() => r.getByTestId('license-modal-save'));
    // The pickers only mount once the section is open (lazy vocabulary stack).
    expect(r.queryByTestId('concept-picker-pick')).toBeNull();
    const details = /** @type {HTMLDetailsElement} */ (
      r.getByTestId('license-modal-indexing-section')
    );
    details.open = true;
    await fireEvent(details, new Event('toggle'));
    await waitFor(() => r.getByTestId('concept-picker-pick'));
    await fireEvent.click(r.getByTestId('concept-picker-pick'));
    await tick();
    expect(r.getByTestId('license-modal-subject-chips').textContent).toContain('Fortbildung');

    const tags = await fillAndSave(r);
    expect(tags.filter((t) => t[0].startsWith('about:'))).toEqual([
      ['about:id', 'https://w3id.org/kim/educationalLevel/level_C'],
      ['about:prefLabel:de', 'Fortbildung'],
      ['about:prefLabel:en', 'Advanced training'],
      ['about:type', 'Concept']
    ]);
  });

  it("carries the existing attestation's t / about:* over when creating my own, and lets me drop one", async () => {
    const existingLicense = {
      id: 'existing-id',
      kind: 1063,
      pubkey: 'attestor-pubkey',
      content: '',
      tags: [
        ['url', 'https://blossom.example/abc.jpg'],
        ['x', 'a'.repeat(64)],
        ['m', 'image/jpeg'],
        ['license', 'https://creativecommons.org/licenses/by/4.0/'],
        ['credit', 'Jane Doe'],
        ['t', 'kirche'],
        ['t', 'church'],
        ['about:id', 'http://w3id.org/kim/schulfaecher/s1055'],
        ['about:prefLabel:de', 'Religion'],
        ['about:type', 'Concept']
      ]
    };
    const r = render(LicenseModal, { props: { ...baseProps, existingLicense } });
    await waitFor(() => r.getByTestId('license-modal-accept-existing'));
    expect(r.getByTestId('license-modal-existing-keywords').textContent).toContain('church');
    expect(r.getByTestId('license-modal-existing-subjects').textContent).toContain('Religion');

    await fireEvent.click(r.getByText('Create my own'));
    await waitFor(() => r.getByTestId('license-modal-save'));
    // Section opens by itself because there is something to edit.
    expect(
      /** @type {HTMLDetailsElement} */ (r.getByTestId('license-modal-indexing-section')).open
    ).toBe(true);
    await fireEvent.click(r.getByLabelText('Remove keyword church'));
    await tick();

    const tags = await fillAndSave(r);
    expect(tags.filter((t) => t[0] === 't')).toEqual([['t', 'kirche']]);
    expect(tags.filter((t) => t[0].startsWith('about:'))).toEqual([
      ['about:id', 'http://w3id.org/kim/schulfaecher/s1055'],
      ['about:prefLabel:de', 'Religion'],
      ['about:type', 'Concept']
    ]);
  });

  it('renders no subject picker when the deployment configures no subject vocabulary', async () => {
    h.subjectField = null;
    const r = render(LicenseModal, { props: baseProps });
    await waitFor(() => r.getByTestId('license-modal-save'));
    const details = /** @type {HTMLDetailsElement} */ (
      r.getByTestId('license-modal-indexing-section')
    );
    details.open = true;
    await fireEvent(details, new Event('toggle'));
    await tick();
    expect(r.queryByTestId('license-modal-subject-picker-schulfaecher')).toBeNull();
    expect(r.getByTestId('license-modal-keywords')).toBeTruthy();
  });
});
