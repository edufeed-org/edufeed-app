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
  });
});
