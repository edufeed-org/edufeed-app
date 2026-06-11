// @ts-nocheck
/**
 * LicenseModal — disclosure checkbox + beforeAttest hook.
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
  license_modal_save: () => 'Save',
  license_modal_cancel: () => 'Cancel',
  license_modal_existing_title: () => 'Existing license found',
  license_modal_existing_description: () => 'existing desc',
  license_modal_accept_existing: () => 'Accept existing',
  license_modal_create_own: () => 'Create my own',
  license_modal_attested_by: () => 'Attested by',
  license_modal_disclosure_label: () => 'I confirm responsibility',
  license_modal_disclosure_required_error: () => 'Please confirm'
}));

vi.mock('$lib/stores/accounts.svelte', () => ({
  manager: {
    active: { pubkey: 'p1', signEvent: async (e) => ({ ...e, sig: 'x', id: 'i', pubkey: 'p1' }) }
  }
}));

vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: { add: vi.fn() }
}));

vi.mock('$lib/services/publish-service.js', () => ({
  publishEventOptimistic: vi.fn()
}));

vi.mock('$lib/helpers/event-factory.js', () => ({
  createAppEventFactory: () => ({
    build: async (template) => ({ ...template, created_at: 1, pubkey: 'p1' })
  })
}));

vi.mock('$lib/helpers/image-license.js', () => ({
  buildLicenseTemplate: (input) => ({
    kind: 1063,
    content: input.description || '',
    tags: [
      ['url', input.url],
      ['x', input.hash],
      ['m', input.mime],
      ['license', input.license],
      ['credit', input.credit]
    ]
  })
}));

vi.mock('$lib/helpers/educational/licenseOptions.js', () => ({
  getLicenseOptions: () => [
    { id: 'https://creativecommons.org/licenses/by/4.0/', label: 'CC BY 4.0' }
  ]
}));

vi.mock('$lib/helpers/educational/licenseLabel.js', () => ({
  formatLicenseUrl: (u) => u
}));

import LicenseModal from '../shared/LicenseModal.svelte';

describe('LicenseModal — disclosure gate', () => {
  it('disables Save on Create view until the disclosure checkbox is ticked', async () => {
    const { getByTestId, getByLabelText } = render(LicenseModal, {
      props: {
        open: true,
        hash: 'a'.repeat(64),
        url: 'https://blossom.example/x.jpg',
        mime: 'image/jpeg',
        size: 1234,
        existingLicense: null
      }
    });

    // Credit must be filled to isolate the disclosure-gate behaviour.
    const credit = getByLabelText('Credit');
    await fireEvent.input(credit, { target: { value: 'Jane Doe' } });

    const save = getByTestId('license-modal-save');
    expect(save.disabled).toBe(true);

    const disclosure = getByTestId('license-modal-disclosure');
    await fireEvent.click(disclosure);

    expect(save.disabled).toBe(false);
  });

  it('does not render the disclosure checkbox on the Accept-existing view', () => {
    const existingLicense = {
      pubkey: 'p2',
      tags: [
        ['url', 'https://blossom.example/x.jpg'],
        ['x', 'a'.repeat(64)],
        ['license', 'https://creativecommons.org/licenses/by/4.0/'],
        ['credit', 'Jane']
      ],
      content: ''
    };
    const { queryByTestId } = render(LicenseModal, {
      props: {
        open: true,
        hash: 'a'.repeat(64),
        url: 'https://blossom.example/x.jpg',
        mime: 'image/jpeg',
        size: 1234,
        existingLicense
      }
    });
    expect(queryByTestId('license-modal-disclosure')).toBeNull();
  });
});
