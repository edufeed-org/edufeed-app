// @ts-nocheck
/**
 * LicenseModal — AI-content labelling select (issue: "add attribute for ai
 * generated content in 1063 metadata").
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';

vi.mock('$lib/paraglide/messages', () => ({
  license_modal_title: () => 'License this image',
  license_modal_description: () => 'desc',
  license_modal_license_label: () => 'License',
  license_modal_title_field_label: () => 'Title',
  license_modal_title_field_placeholder: () => 'placeholder',
  license_modal_credit_label: () => 'Credit',
  license_modal_credit_placeholder: () => 'credit placeholder',
  license_modal_self_creator: () => 'I am the creator',
  license_modal_source_label: () => 'Source',
  license_modal_description_label: () => 'Description',
  license_modal_ai_label: () => 'AI involvement',
  license_modal_ai_none: () => 'None',
  license_modal_ai_generated: () => 'Fully AI-generated',
  license_modal_ai_modified: () => 'Partially AI-modified',
  license_modal_ai_section_title: () => 'AI provenance & usage',
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
  license_modal_save: () => 'Save',
  license_modal_cancel: () => 'Cancel',
  license_modal_existing_title: () => 'Existing license found',
  license_modal_existing_description: () => 'existing desc',
  license_modal_accept_existing: () => 'Accept existing',
  license_modal_create_own: () => 'Create my own',
  license_modal_attested_by: () => 'Attested by',
  license_modal_disclosure_label: () => 'I confirm responsibility',
  license_modal_disclosure_required_error: () => 'Please confirm',
  license_modal_publish_failed: () => 'publish failed',
  license_modal_upload_failed: () => 'upload failed',
  license_modal_title_file: () => 'License this file',
  license_modal_description_file: () => 'file desc',
  license_modal_self_creator_file: () => 'I am the creator of this file',
  license_modal_existing_description_file: () => 'existing file desc',
  license_modal_file_label: () => 'File',
  license_modal_title_label: () => 'Title',
  amb_form_validation_image_license_missing: () => 'missing',
  license_modal_error_missing_hash: () => 'missing hash'
}));

vi.mock('$lib/stores/accounts.svelte', () => ({
  manager: {
    active: { pubkey: 'p1', signEvent: async (e) => ({ ...e, sig: 'x', id: 'i', pubkey: 'p1' }) }
  }
}));

vi.mock('$lib/helpers/image-license.js', () => ({
  publishLicenseAttestation: vi.fn(async (input, signer) => ({
    kind: 1063,
    pubkey: signer.pubkey,
    tags: input.ai ? [['ai', input.ai]] : []
  }))
}));

vi.mock('$lib/helpers/educational/licenseOptions.js', () => ({
  getLicenseOptions: () => [
    { id: 'https://creativecommons.org/licenses/by/4.0/', label: 'CC BY 4.0' }
  ]
}));

vi.mock('$lib/helpers/educational/licenseLabel.js', () => ({
  formatLicenseUrl: (u) => u
}));

import { publishLicenseAttestation } from '$lib/helpers/image-license.js';
import LicenseModal from '../shared/LicenseModal.svelte';

const baseProps = {
  open: true,
  hash: 'a'.repeat(64),
  url: 'https://blossom.example/a.jpg',
  mime: 'image/jpeg',
  size: 100,
  existingLicense: null
};

async function fillAndSave(utils) {
  await fireEvent.input(utils.getByLabelText('Credit'), { target: { value: 'Jane' } });
  await fireEvent.click(utils.getByTestId('license-modal-disclosure'));
  await fireEvent.click(utils.getByTestId('license-modal-save'));
  await new Promise((r) => setTimeout(r, 0));
}

describe('LicenseModal — AI involvement select', () => {
  it('defaults to "none" and publishes without an ai label', async () => {
    publishLicenseAttestation.mockClear();
    const utils = render(LicenseModal, { props: { ...baseProps, onsave: vi.fn() } });
    const select = utils.getByLabelText('AI involvement');
    expect(select.value).toBe('');
    await fillAndSave(utils);
    expect(publishLicenseAttestation).toHaveBeenCalledTimes(1);
    expect(publishLicenseAttestation.mock.calls[0][0].ai).toBeUndefined();
  });

  it('passes the chosen label to the attestation', async () => {
    publishLicenseAttestation.mockClear();
    const onsave = vi.fn();
    const utils = render(LicenseModal, { props: { ...baseProps, onsave } });
    await fireEvent.change(utils.getByLabelText('AI involvement'), {
      target: { value: 'generated' }
    });
    await fillAndSave(utils);
    expect(publishLicenseAttestation.mock.calls[0][0].ai).toBe('generated');
    expect(onsave).toHaveBeenCalledTimes(1);
  });

  it('shows the AI label on the Accept-existing view', () => {
    const existing = {
      id: 'e',
      pubkey: 'p2',
      kind: 1063,
      content: '',
      tags: [
        ['license', 'https://creativecommons.org/licenses/by/4.0/'],
        ['credit', 'Someone'],
        ['ai', 'modified']
      ]
    };
    const { getByTestId } = render(LicenseModal, {
      props: { ...baseProps, existingLicense: existing }
    });
    expect(getByTestId('license-modal-existing-ai').textContent).toContain('Partially AI-modified');
  });

  it('does not show an AI row for existing licenses without the tag', () => {
    const existing = {
      id: 'e',
      pubkey: 'p2',
      kind: 1063,
      content: '',
      tags: [
        ['license', 'https://creativecommons.org/licenses/by/4.0/'],
        ['credit', 'Someone']
      ]
    };
    const { queryByTestId } = render(LicenseModal, {
      props: { ...baseProps, existingLicense: existing }
    });
    expect(queryByTestId('license-modal-existing-ai')).toBeNull();
    expect(queryByTestId('license-modal-existing-ai-tool')).toBeNull();
    expect(queryByTestId('license-modal-existing-ai-training')).toBeNull();
  });
});

/*
 * twillo alignment ("Informationen zur KI-Herkunft & -Nutzung"): training
 * permission (default on), generated, tool, manually edited afterwards.
 */
const CHATGPT_URI =
  'http://w3id.org/edu-sharing/vocabs/aiTools/4dd60dfa-9f8a-4cc9-b733-0125448f77a3';

describe('LicenseModal — AI provenance & usage (twillo-aligned)', () => {
  it('AI-training permission defaults to allowed and is always published', async () => {
    publishLicenseAttestation.mockClear();
    const utils = render(LicenseModal, { props: { ...baseProps, onsave: vi.fn() } });
    const training = utils.getByTestId('license-modal-ai-training');
    expect(training.checked).toBe(true);
    await fillAndSave(utils);
    const input = publishLicenseAttestation.mock.calls[0][0];
    expect(input.aiTraining).toBe('allowed');
    expect(input.aiTool).toBeUndefined();
    expect(input.aiEdited).toBeFalsy();
  });

  it('unchecking the training box publishes "disallowed"', async () => {
    publishLicenseAttestation.mockClear();
    const utils = render(LicenseModal, { props: { ...baseProps, onsave: vi.fn() } });
    await fireEvent.click(utils.getByTestId('license-modal-ai-training'));
    await fillAndSave(utils);
    expect(publishLicenseAttestation.mock.calls[0][0].aiTraining).toBe('disallowed');
  });

  it('shows tool + edited controls only once AI involvement is chosen', async () => {
    const utils = render(LicenseModal, { props: { ...baseProps, onsave: vi.fn() } });
    expect(utils.queryByTestId('license-modal-ai-tool')).toBeNull();
    expect(utils.queryByTestId('license-modal-ai-edited')).toBeNull();

    await fireEvent.change(utils.getByLabelText('AI involvement'), {
      target: { value: 'generated' }
    });
    expect(utils.getByTestId('license-modal-ai-tool')).toBeTruthy();
    expect(utils.getByTestId('license-modal-ai-edited')).toBeTruthy();

    // "Manually edited afterwards" only makes sense for generated content.
    await fireEvent.change(utils.getByLabelText('AI involvement'), {
      target: { value: 'modified' }
    });
    expect(utils.getByTestId('license-modal-ai-tool')).toBeTruthy();
    expect(utils.queryByTestId('license-modal-ai-edited')).toBeNull();
  });

  it('publishes a vocabulary tool with its concept URI and the edited flag', async () => {
    publishLicenseAttestation.mockClear();
    const utils = render(LicenseModal, { props: { ...baseProps, onsave: vi.fn() } });
    await fireEvent.change(utils.getByLabelText('AI involvement'), {
      target: { value: 'generated' }
    });
    await fireEvent.change(utils.getByTestId('license-modal-ai-tool'), {
      target: { value: CHATGPT_URI }
    });
    await fireEvent.click(utils.getByTestId('license-modal-ai-edited'));
    await fillAndSave(utils);
    const input = publishLicenseAttestation.mock.calls[0][0];
    expect(input.ai).toBe('generated');
    expect(input.aiTool).toEqual({ label: 'OpenAI ChatGPT', id: CHATGPT_URI });
    expect(input.aiEdited).toBe(true);
  });

  it('publishes a free-text tool when "Other" is chosen', async () => {
    publishLicenseAttestation.mockClear();
    const utils = render(LicenseModal, { props: { ...baseProps, onsave: vi.fn() } });
    await fireEvent.change(utils.getByLabelText('AI involvement'), {
      target: { value: 'generated' }
    });
    expect(utils.queryByTestId('license-modal-ai-tool-other')).toBeNull();
    await fireEvent.change(utils.getByTestId('license-modal-ai-tool'), {
      target: { value: 'other' }
    });
    await fireEvent.input(utils.getByTestId('license-modal-ai-tool-other'), {
      target: { value: 'Midjourney' }
    });
    await fillAndSave(utils);
    expect(publishLicenseAttestation.mock.calls[0][0].aiTool).toEqual({ label: 'Midjourney' });
  });

  it('leaves the tool undefined for "unknown" and for an empty "Other" text', async () => {
    publishLicenseAttestation.mockClear();
    const utils = render(LicenseModal, { props: { ...baseProps, onsave: vi.fn() } });
    await fireEvent.change(utils.getByLabelText('AI involvement'), {
      target: { value: 'generated' }
    });
    await fireEvent.change(utils.getByTestId('license-modal-ai-tool'), {
      target: { value: 'other' }
    });
    await fillAndSave(utils);
    expect(publishLicenseAttestation.mock.calls[0][0].aiTool).toBeUndefined();
  });

  it('shows tool, edited flag and training permission on the Accept-existing view', () => {
    const existing = {
      id: 'e',
      pubkey: 'p2',
      kind: 1063,
      content: '',
      tags: [
        ['license', 'https://creativecommons.org/licenses/by/4.0/'],
        ['credit', 'Someone'],
        ['ai', 'generated'],
        ['ai-edited', 'true'],
        ['ai-tool', 'OpenAI ChatGPT', CHATGPT_URI],
        ['ai-training', 'disallowed']
      ]
    };
    const { getByTestId } = render(LicenseModal, {
      props: { ...baseProps, existingLicense: existing }
    });
    const aiRow = getByTestId('license-modal-existing-ai').textContent;
    expect(aiRow).toContain('Fully AI-generated');
    expect(aiRow).toContain('Manually edited afterwards');
    expect(getByTestId('license-modal-existing-ai-tool').textContent).toContain('OpenAI ChatGPT');
    expect(getByTestId('license-modal-existing-ai-training').textContent).toContain('not allowed');
  });
});
