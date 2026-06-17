// @ts-nocheck
/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';

const mocks = vi.hoisted(() => ({
  searchOer: vi.fn(),
  fetchOerAsset: vi.fn(),
  findExistingLicense: vi.fn(),
  publishLicenseAttestation: vi.fn()
}));

// OER enabled in config.
vi.mock('$lib/stores/config.svelte.js', () => ({
  runtimeConfig: { oer: { enabled: true }, defaultBlossomServers: [] }
}));
vi.mock('$lib/helpers/oer/searchOer.js', () => ({
  searchOer: (...a) => mocks.searchOer(...a),
  fetchOerAsset: (...a) => mocks.fetchOerAsset(...a)
}));
vi.mock('$lib/helpers/image-license.js', () => ({
  findExistingLicense: (...a) => mocks.findExistingLicense(...a),
  publishLicenseAttestation: (...a) => mocks.publishLicenseAttestation(...a)
}));
vi.mock('$lib/helpers/oer/oerToLicenseInput.js', async () => {
  const actual = await vi.importActual('$lib/helpers/oer/oerToLicenseInput.js');
  return actual;
});
// Active user signer.
vi.mock('$lib/stores/accounts.svelte', () => ({
  manager: { active: { pubkey: 'signerpub', signEvent: vi.fn(async (e) => ({ ...e, id: 'sig' })) } }
}));
// Neutralise the local-1063 timeline machinery — this test exercises only OER.
vi.mock('applesauce-loaders/loaders', () => ({
  createTimelineLoader: () => () => ({ subscribe: () => ({ unsubscribe() {} }) }),
  createAddressLoader: () => () => ({ subscribe: () => ({ unsubscribe() {} }) }),
  createEventLoader: () => () => ({ subscribe: () => ({ unsubscribe() {} }) }),
  createUnifiedEventLoader: () => () => ({ subscribe: () => ({ unsubscribe() {} }) }),
  createOutboxTimelineLoader: () => () => ({ subscribe: () => ({ unsubscribe() {} }) }),
  createReactionsLoader: () => () => ({ subscribe: () => ({ unsubscribe() {} }) })
}));
vi.mock('applesauce-common/helpers', () => ({
  getFileMetadata: () => null,
  BLOSSOM_SERVER_LIST_KIND: 10063,
  getBlossomServersFromList: () => []
}));
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: {
    timeline: () => ({ subscribe: () => ({ unsubscribe() {} }) }),
    replaceable: () => ({ subscribe: () => ({ unsubscribe() {} }) }),
    add: vi.fn()
  },
  pool: {}
}));
vi.mock('$lib/loaders/base.js', () => ({ timedPool: {} }));
vi.mock('$lib/helpers/relay-helper.js', () => ({
  getAllLookupRelays: () => [],
  getEventLoaderLookupRelays: () => [],
  getCommunikeyRelays: () => [],
  getEducationalRelays: () => [],
  getArticleRelays: () => [],
  getKanbanRelays: () => [],
  getProfileLookupRelays: () => [],
  getDefaultDmRelays: () => [],
  getCalendarRelays: () => [],
  getFallbackRelays: () => [],
  isGatedModeActive: () => false
}));
vi.mock('$lib/helpers/blossom-trust.js', () => ({
  normalizeServerUrl: (u) => u,
  urlIsOnTrustedServer: () => false
}));
vi.mock('$lib/paraglide/messages', () => ({
  image_library_picker_title: () => 'image_library_picker_title',
  image_library_picker_loading: () => 'image_library_picker_loading',
  image_library_picker_empty_title: () => 'image_library_picker_empty_title',
  image_library_picker_empty_desc: () => 'image_library_picker_empty_desc',
  image_library_picker_empty_cta: () => 'image_library_picker_empty_cta',
  image_library_picker_thumbnail_alt: () => 'image_library_picker_thumbnail_alt',
  image_source_chooser_cancel: () => 'image_source_chooser_cancel',
  image_library_picker_oer_section_title: () => 'image_library_picker_oer_section_title',
  image_library_picker_oer_search_placeholder: () => 'image_library_picker_oer_search_placeholder',
  image_library_picker_oer_search_button: () => 'image_library_picker_oer_search_button',
  image_library_picker_oer_error: () => 'image_library_picker_oer_error',
  image_library_picker_oer_loading: () => 'image_library_picker_oer_loading',
  image_library_picker_oer_load_more: () => 'image_library_picker_oer_load_more',
  image_library_picker_oer_pick_failed: () => 'image_library_picker_oer_pick_failed'
}));

import ImageLibraryPickerModal from '../shared/ImageLibraryPickerModal.svelte';

const oerItem = {
  id: 'openverse:1',
  amb: {
    id: 'https://img.example/tree.jpg',
    name: 'A Tree',
    license: { id: 'https://creativecommons.org/licenses/by/4.0/' },
    creator: [{ name: 'Jane' }]
  },
  extensions: {
    system: { attribution: 'Jane, CC BY 4.0' },
    images: { small: 'https://proxy/thumb.jpg' }
  }
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ImageLibraryPickerModal — OER search', () => {
  it('renders the OER search section when oer.enabled', () => {
    const { getByTestId } = render(ImageLibraryPickerModal, { props: { open: true } });
    expect(getByTestId('oer-search-input')).toBeTruthy();
  });

  it('searches and renders OER tiles with the proxied thumbnail', async () => {
    mocks.searchOer.mockResolvedValueOnce({ data: [oerItem], meta: { hasMore: false } });
    const { getByTestId, getAllByTestId } = render(ImageLibraryPickerModal, {
      props: { open: true }
    });
    await fireEvent.input(getByTestId('oer-search-input'), { target: { value: 'tree' } });
    await fireEvent.submit(getByTestId('oer-search-form'));
    await new Promise((r) => setTimeout(r, 10));
    const tiles = getAllByTestId('oer-tile');
    expect(tiles).toHaveLength(1);
    expect(tiles[0].querySelector('img')?.getAttribute('src')).toBe('https://proxy/thumb.jpg');
  });

  it('on pick: hashes bytes, mints a 1063 (no existing), and calls onpick with url+hash+event', async () => {
    mocks.searchOer.mockResolvedValueOnce({ data: [oerItem], meta: { hasMore: false } });
    mocks.fetchOerAsset.mockResolvedValueOnce({
      sha256: 'deadbeef',
      mime: 'image/jpeg',
      size: 100
    });
    mocks.findExistingLicense.mockResolvedValueOnce(null);
    const minted = { id: 'mintedid', kind: 1063, tags: [] };
    mocks.publishLicenseAttestation.mockResolvedValueOnce(minted);

    const onpick = vi.fn();
    const { getByTestId } = render(ImageLibraryPickerModal, { props: { open: true, onpick } });
    await fireEvent.input(getByTestId('oer-search-input'), { target: { value: 'tree' } });
    await fireEvent.submit(getByTestId('oer-search-form'));
    await new Promise((r) => setTimeout(r, 10));

    await fireEvent.click(getByTestId('oer-tile'));
    await new Promise((r) => setTimeout(r, 10));

    expect(mocks.fetchOerAsset).toHaveBeenCalledWith('https://img.example/tree.jpg');
    expect(mocks.findExistingLicense).toHaveBeenCalledWith('deadbeef');
    expect(mocks.publishLicenseAttestation).toHaveBeenCalledTimes(1);
    expect(onpick).toHaveBeenCalledWith({
      url: 'https://img.example/tree.jpg',
      hash: 'deadbeef',
      licenseEvent: minted
    });
  });

  it('on pick: reuses an existing 1063 without minting', async () => {
    mocks.searchOer.mockResolvedValueOnce({ data: [oerItem], meta: { hasMore: false } });
    mocks.fetchOerAsset.mockResolvedValueOnce({
      sha256: 'deadbeef',
      mime: 'image/jpeg',
      size: 100
    });
    const existing = { id: 'existingid', kind: 1063, tags: [] };
    mocks.findExistingLicense.mockResolvedValueOnce(existing);

    const onpick = vi.fn();
    const { getByTestId } = render(ImageLibraryPickerModal, { props: { open: true, onpick } });
    await fireEvent.input(getByTestId('oer-search-input'), { target: { value: 'tree' } });
    await fireEvent.submit(getByTestId('oer-search-form'));
    await new Promise((r) => setTimeout(r, 10));
    await fireEvent.click(getByTestId('oer-tile'));
    await new Promise((r) => setTimeout(r, 10));

    expect(mocks.publishLicenseAttestation).not.toHaveBeenCalled();
    expect(onpick).toHaveBeenCalledWith({
      url: 'https://img.example/tree.jpg',
      hash: 'deadbeef',
      licenseEvent: existing
    });
  });
});
