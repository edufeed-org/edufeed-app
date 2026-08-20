/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/svelte';
import LicenseModal from '$lib/components/shared/LicenseModal.svelte';

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

const mockPublish = vi.fn();
vi.mock('$lib/services/publish-service.js', () => ({
  /** @param {...any} args */
  publishEventOptimistic: (...args) => mockPublish(...args)
}));

vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: { add: vi.fn() }
}));

vi.mock('$lib/helpers/event-factory.js', () => ({
  createAppEventFactory: () => ({
    /** @param {any} template */
    build: async (template) => ({ ...template, created_at: 1000, pubkey: 'b'.repeat(64) })
  })
}));

vi.mock('$lib/helpers/educational/licenseOptions.js', () => ({
  getLicenseOptions: () => [
    { id: 'https://creativecommons.org/licenses/by/4.0/', label: 'CC BY 4.0' },
    { id: 'https://creativecommons.org/publicdomain/zero/1.0/', label: 'CC0' }
  ]
}));

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
  license_modal_description_label: () => 'Description',
  license_modal_save: () => 'Save',
  license_modal_cancel: () => 'Cancel',
  license_modal_publish_failed: () => 'Publish failed',
  license_modal_error_missing_hash: () => 'Missing hash',
  amb_form_validation_image_license_missing: () => 'License missing',
  license_modal_disclosure_label: () => 'I confirm responsibility',
  license_modal_disclosure_required_error: () => 'Please confirm'
}));

/**
 * @param {Record<string, string>} extras
 */
function mkExisting(extras = {}) {
  return {
    id: 'existing-id',
    kind: 1063,
    pubkey: 'attestor-pubkey',
    content: extras.description || '',
    tags: [
      ['license', 'https://creativecommons.org/licenses/by/4.0/'],
      ['credit', extras.credit || 'Jane Doe'],
      ['source', extras.source || ''],
      ['x', 'a'.repeat(64)],
      ['url', 'https://blossom.example/abc.jpg'],
      ['m', 'image/jpeg']
    ]
  };
}

describe('LicenseModal', () => {
  beforeEach(() => {
    mockSignEvent.mockClear();
    mockPublish.mockReset();
  });

  it('renders the existing-license view when existingLicense prop is set', async () => {
    const existingLicense = mkExisting();
    const { getByTestId, getByText } = render(LicenseModal, {
      props: {
        open: true,
        hash: 'a'.repeat(64),
        url: 'https://blossom.example/abc.jpg',
        mime: 'image/jpeg',
        size: 100,
        existingLicense
      }
    });

    await waitFor(() => getByTestId('license-modal'));
    // Accept-existing button must be visible
    getByTestId('license-modal-accept-existing');
    // The form's Save button must NOT be rendered yet
    expect(() => getByTestId('license-modal-save')).toThrow();
    // The summary should mention the credit
    getByText(/Jane Doe/);
  });

  it('clicking "Use this license" fires onsave with the existing event', async () => {
    const existingLicense = mkExisting({ credit: 'Original Attester' });
    let saved = /** @type {any} */ (null);
    const { getByTestId } = render(LicenseModal, {
      props: {
        open: true,
        hash: 'a'.repeat(64),
        url: 'https://blossom.example/abc.jpg',
        mime: 'image/jpeg',
        size: 100,
        existingLicense,
        onsave: (/** @type {any} */ ev) => {
          saved = ev;
        }
      }
    });

    await waitFor(() => getByTestId('license-modal-accept-existing'));
    await fireEvent.click(getByTestId('license-modal-accept-existing'));

    await waitFor(() => {
      expect(saved).toBe(existingLicense);
    });
    // No new event signed or published
    expect(mockSignEvent).not.toHaveBeenCalled();
    expect(mockPublish).not.toHaveBeenCalled();
  });

  it('clicking "Create my own" switches to the form view', async () => {
    const existingLicense = mkExisting();
    const { getByTestId, getByText } = render(LicenseModal, {
      props: {
        open: true,
        hash: 'a'.repeat(64),
        url: 'https://blossom.example/abc.jpg',
        mime: 'image/jpeg',
        size: 100,
        existingLicense
      }
    });

    await waitFor(() => getByTestId('license-modal-accept-existing'));
    // Click "Create my own"
    await fireEvent.click(getByText('Create my own'));

    // The form view should now be visible (Save button present)
    await waitFor(() => getByTestId('license-modal-save'));
    // The accept-existing button should be gone
    expect(() => getByTestId('license-modal-accept-existing')).toThrow();
  });

  it('renders the form view when existingLicense prop is null', async () => {
    const { getByTestId } = render(LicenseModal, {
      props: {
        open: true,
        hash: 'a'.repeat(64),
        url: 'https://blossom.example/abc.jpg',
        mime: 'image/jpeg',
        size: 100,
        existingLicense: null
      }
    });

    await waitFor(() => getByTestId('license-modal-save'));
    expect(() => getByTestId('license-modal-accept-existing')).toThrow();
  });

  it('seeds the form from initialLicense/initialCredit/initialTitle/initialSource on open (e.g. H5P metadata prefill)', async () => {
    const { getByTestId, getByLabelText } = render(LicenseModal, {
      props: {
        open: true,
        hash: 'a'.repeat(64),
        url: 'https://blossom.example/app.xdc',
        mime: 'image/jpeg',
        size: 100,
        existingLicense: null,
        initialLicense: 'https://creativecommons.org/publicdomain/zero/1.0/',
        initialCredit: 'Jane Doe',
        initialTitle: 'Peace Quiz',
        initialSource: 'https://example.org/original'
      }
    });

    await waitFor(() => getByTestId('license-modal-save'));
    expect(/** @type {HTMLSelectElement} */ (getByLabelText('License')).value).toBe(
      'https://creativecommons.org/publicdomain/zero/1.0/'
    );
    expect(/** @type {HTMLInputElement} */ (getByLabelText('Credit')).value).toBe('Jane Doe');
    expect(/** @type {HTMLInputElement} */ (getByLabelText('Title of the work')).value).toBe(
      'Peace Quiz'
    );
    expect(/** @type {HTMLInputElement} */ (getByLabelText('Source URL')).value).toBe(
      'https://example.org/original'
    );
  });

  it('falls back to the hardcoded defaults when initialLicense/initialCredit/initialTitle/initialSource are omitted (existing callers)', async () => {
    const { getByTestId, getByLabelText } = render(LicenseModal, {
      props: {
        open: true,
        hash: 'a'.repeat(64),
        url: 'https://blossom.example/abc.jpg',
        mime: 'image/jpeg',
        size: 100,
        existingLicense: null
      }
    });

    await waitFor(() => getByTestId('license-modal-save'));
    expect(/** @type {HTMLSelectElement} */ (getByLabelText('License')).value).toBe(
      'https://creativecommons.org/licenses/by/4.0/'
    );
    expect(/** @type {HTMLInputElement} */ (getByLabelText('Credit')).value).toBe('');
    expect(/** @type {HTMLInputElement} */ (getByLabelText('Title of the work')).value).toBe('');
    expect(/** @type {HTMLInputElement} */ (getByLabelText('Source URL')).value).toBe('');
  });
});
