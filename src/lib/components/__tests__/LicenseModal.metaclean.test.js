// @ts-nocheck
/**
 * LicenseModal — optional `extraOptions` snippet slot (create-own form branch only).
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';

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
  license_modal_disclosure_required_error: () => 'Please confirm',
  license_modal_publish_failed: () => 'publish failed',
  license_modal_upload_failed: () => 'upload failed',
  license_modal_title_file: () => 'License this file',
  license_modal_description_file: () => 'file desc',
  license_modal_self_creator_file: () => 'I am the creator of this file',
  license_modal_existing_description_file: () => 'existing file desc',
  license_modal_file_label: () => 'File',
  license_modal_title_label: () => 'Title'
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
  }),
  publishLicenseAttestation: async (input, signer) => {
    const template = {
      kind: 1063,
      content: input.description || '',
      tags: [
        ['url', input.url],
        ['x', input.hash],
        ['m', input.mime],
        ['license', input.license],
        ['credit', input.credit]
      ]
    };
    const eventTemplate = { ...template, created_at: 1, pubkey: signer.pubkey };
    return signer.signEvent(eventTemplate);
  }
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

/** Builds a raw snippet rendering a fixed marker span, for prop-injection tests. */
function extraOptionsSnippet() {
  return createRawSnippet(() => ({
    render: () => `<span data-testid="extra-opt-marker">EXTRA-OPT</span>`
  }));
}

describe('LicenseModal — extraOptions snippet', () => {
  it('renders the extraOptions snippet in the create-own form, above the disclosure checkbox', () => {
    const { getByTestId } = render(LicenseModal, {
      props: {
        open: true,
        hash: 'a'.repeat(64),
        url: 'https://blossom.example/x.jpg',
        mime: 'image/jpeg',
        size: 1234,
        existingLicense: null,
        extraOptions: extraOptionsSnippet()
      }
    });

    const marker = getByTestId('extra-opt-marker');
    expect(marker.textContent).toBe('EXTRA-OPT');

    const disclosure = getByTestId('license-modal-disclosure');

    // DOM order: the marker must appear before the disclosure checkbox.
    const position = marker.compareDocumentPosition(disclosure);

    expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('renders nothing extra when extraOptions is not passed', () => {
    const { queryByTestId } = render(LicenseModal, {
      props: {
        open: true,
        hash: 'a'.repeat(64),
        url: 'https://blossom.example/x.jpg',
        mime: 'image/jpeg',
        size: 1234,
        existingLicense: null
      }
    });

    expect(queryByTestId('extra-opt-marker')).toBeNull();
  });

  it('does not render extraOptions on the Accept-existing view', () => {
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
        existingLicense,
        extraOptions: extraOptionsSnippet()
      }
    });

    expect(queryByTestId('extra-opt-marker')).toBeNull();
  });
});
