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
  license_modal_disclosure_required_error: () => 'Please confirm',
  license_modal_publish_failed: () => 'publish failed',
  license_modal_upload_failed: () => 'upload failed',
  license_modal_title_file: () => 'License this file',
  license_modal_description_file: () => 'file desc',
  license_modal_self_creator_file: () => 'I am the creator of this file',
  license_modal_existing_description_file: () => 'existing file desc',
  license_modal_file_label: () => 'File'
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

describe('LicenseModal — file-aware wording + file name', () => {
  it('uses image wording for image MIME types', () => {
    const { getByText } = render(LicenseModal, {
      props: {
        open: true,
        hash: 'a'.repeat(64),
        url: 'https://blossom.example/x.jpg',
        mime: 'image/jpeg',
        size: 1234,
        existingLicense: null
      }
    });
    expect(getByText('License this image')).toBeTruthy();
    expect(getByText('I am the creator')).toBeTruthy();
  });

  it('uses generic file wording for non-image MIME types (e.g. PDF)', () => {
    const { getByText, queryByText } = render(LicenseModal, {
      props: {
        open: true,
        hash: 'a'.repeat(64),
        url: 'https://blossom.example/x.pdf',
        mime: 'application/pdf',
        size: 1234,
        existingLicense: null
      }
    });
    expect(getByText('License this file')).toBeTruthy();
    expect(getByText('I am the creator of this file')).toBeTruthy();
    expect(queryByText('License this image')).toBeNull();
  });

  it('shows the file name on the Create view so the user knows which file is being licensed', () => {
    const { getByTestId } = render(LicenseModal, {
      props: {
        open: true,
        hash: 'a'.repeat(64),
        url: '',
        mime: 'application/pdf',
        size: 1234,
        existingLicense: null,
        fileName: 'arbeitsblatt-photosynthese.pdf'
      }
    });
    expect(getByTestId('license-modal-filename').textContent).toContain(
      'arbeitsblatt-photosynthese.pdf'
    );
  });

  it('shows the file name on the Accept-existing view', () => {
    const existingLicense = {
      pubkey: 'p2',
      tags: [
        ['url', 'https://blossom.example/x.pdf'],
        ['x', 'a'.repeat(64)],
        ['license', 'https://creativecommons.org/licenses/by/4.0/'],
        ['credit', 'Jane']
      ],
      content: ''
    };
    const { getByTestId } = render(LicenseModal, {
      props: {
        open: true,
        hash: 'a'.repeat(64),
        url: '',
        mime: 'application/pdf',
        size: 1234,
        existingLicense,
        fileName: 'arbeitsblatt-photosynthese.pdf'
      }
    });
    expect(getByTestId('license-modal-filename').textContent).toContain(
      'arbeitsblatt-photosynthese.pdf'
    );
  });

  it('renders no file name chip when fileName is empty', () => {
    const { queryByTestId } = render(LicenseModal, {
      props: {
        open: true,
        hash: 'a'.repeat(64),
        url: '',
        mime: 'image/jpeg',
        size: 1234,
        existingLicense: null
      }
    });
    expect(queryByTestId('license-modal-filename')).toBeNull();
  });
});

describe('LicenseModal — beforeAttest hook', () => {
  it('awaits beforeAttest before building the kind 1063 template', async () => {
    const order = [];
    const beforeAttest = vi.fn(async () => {
      order.push('beforeAttest');
      return {
        url: 'https://blossom.example/new.jpg',
        hash: 'b'.repeat(64),
        mime: 'image/jpeg',
        size: 2222
      };
    });

    const onsave = vi.fn(() => {
      order.push('onsave');
    });

    const { getByTestId, getByLabelText } = render(LicenseModal, {
      props: {
        open: true,
        hash: '',
        url: '',
        mime: '',
        size: 0,
        existingLicense: null,
        beforeAttest,
        onsave
      }
    });

    await fireEvent.input(getByLabelText('Credit'), { target: { value: 'Jane' } });
    await fireEvent.click(getByTestId('license-modal-disclosure'));
    await fireEvent.click(getByTestId('license-modal-save'));

    // Wait a tick for the async chain.
    await new Promise((r) => setTimeout(r, 0));

    expect(beforeAttest).toHaveBeenCalledTimes(1);
    expect(order[0]).toBe('beforeAttest');
    expect(order[1]).toBe('onsave');
    expect(onsave).toHaveBeenCalledTimes(1);
  });

  it('awaits beforeAttest when accepting an existing license', async () => {
    const order = [];
    const beforeAttest = vi.fn(async () => {
      order.push('beforeAttest');
      return {
        url: 'https://blossom.example/new.jpg',
        hash: 'b'.repeat(64),
        mime: 'image/jpeg',
        size: 2222
      };
    });
    const onsave = vi.fn((license) => {
      order.push('onsave');
      return license;
    });

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

    const { getByTestId } = render(LicenseModal, {
      props: {
        open: true,
        hash: '',
        url: '',
        mime: '',
        size: 0,
        existingLicense,
        beforeAttest,
        onsave
      }
    });

    await fireEvent.click(getByTestId('license-modal-accept-existing'));
    // Wait a tick for the async chain.
    await new Promise((r) => setTimeout(r, 0));

    expect(beforeAttest).toHaveBeenCalledTimes(1);
    expect(onsave).toHaveBeenCalledTimes(1);
    expect(onsave).toHaveBeenCalledWith(existingLicense);
    expect(order[0]).toBe('beforeAttest');
    expect(order[1]).toBe('onsave');
  });

  it('blocks the publish when beforeAttest rejects', async () => {
    const beforeAttest = vi.fn(async () => {
      throw new Error('upload-failed');
    });
    const onsave = vi.fn();

    const { getByTestId, getByLabelText, findByText } = render(LicenseModal, {
      props: {
        open: true,
        hash: '',
        url: '',
        mime: '',
        size: 0,
        existingLicense: null,
        beforeAttest,
        onsave
      }
    });

    await fireEvent.input(getByLabelText('Credit'), { target: { value: 'Jane' } });
    await fireEvent.click(getByTestId('license-modal-disclosure'));
    await fireEvent.click(getByTestId('license-modal-save'));

    await new Promise((r) => setTimeout(r, 0));

    expect(beforeAttest).toHaveBeenCalledTimes(1);
    expect(onsave).not.toHaveBeenCalled();
    await findByText('upload failed');
  });
});
