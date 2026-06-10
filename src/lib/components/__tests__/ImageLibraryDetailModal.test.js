/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';

vi.mock('$lib/helpers/educational/licenseLabel.js', () => ({
  formatLicenseUrl: (/** @type {string} */ url) =>
    url === 'https://creativecommons.org/licenses/by/4.0/' ? 'CC BY 4.0' : url
}));

vi.mock('$lib/paraglide/messages', () => ({
  image_library_detail_title: () => 'Image details',
  image_library_detail_use: () => 'Use this image',
  image_library_detail_type: () => 'Type',
  image_library_detail_size: () => 'Size',
  image_library_detail_dimensions: () => 'Dimensions',
  image_library_detail_hash: () => 'SHA-256',
  image_library_picker_thumbnail_alt: () => 'Licensed image',
  image_library_picker_attestations_title: (/** @type {{ count: number }} */ { count }) =>
    count === 1 ? '1 license attestation' : `${count} license attestations`,
  image_library_picker_attestation_date: () => 'Date',
  license_modal_license_label: () => 'License',
  license_modal_credit_label: () => 'Credit',
  license_modal_source_label: () => 'Source',
  license_modal_attested_by: () => 'Attested by',
  image_source_chooser_cancel: () => 'Cancel'
}));

import ImageLibraryDetailModal from '../shared/ImageLibraryDetailModal.svelte';

/**
 * Build a minimal kind 1063 event.
 * @param {{ id: string, hash: string, url: string, license?: string, credit?: string, source?: string, pubkey?: string, created_at?: number }} o
 */
function ev({
  id,
  hash,
  url,
  license = 'https://creativecommons.org/licenses/by/4.0/',
  credit = 'Alice',
  source,
  pubkey = 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
  created_at = 1000
}) {
  /** @type {string[][]} */
  const tags = [
    ['url', url],
    ['x', hash],
    ['m', 'image/png'],
    ['license', license],
    ['credit', credit]
  ];
  if (source) tags.push(['source', source]);
  return { id, kind: 1063, pubkey, created_at, content: '', sig: '', tags };
}

/** @param {{ url: string, sha256: string, type?: string, size?: number, dimensions?: string }} o */
function meta({ url, sha256, type = 'image/png', size, dimensions }) {
  return { url, sha256, type, size, dimensions };
}

describe('ImageLibraryDetailModal', () => {
  it('renders nothing when open is false', () => {
    const tile = {
      event: ev({ id: 'a', hash: 'h1', url: 'u' }),
      events: [],
      meta: meta({ url: 'u', sha256: 'h1' })
    };
    const { queryByText } = render(ImageLibraryDetailModal, { props: { open: false, tile } });
    expect(queryByText('Image details')).toBeNull();
  });

  it('renders nothing when tile is null', () => {
    const { queryByText } = render(ImageLibraryDetailModal, { props: { open: true, tile: null } });
    expect(queryByText('Image details')).toBeNull();
  });

  it('shows the title and image when open with a tile', () => {
    const evA = ev({ id: 'a', hash: 'h1', url: 'https://blossom.edufeed.org/h1.png' });
    const tile = {
      event: evA,
      events: [evA],
      meta: meta({ url: 'https://blossom.edufeed.org/h1.png', sha256: 'h1' })
    };
    const { getByText } = render(ImageLibraryDetailModal, { props: { open: true, tile } });
    expect(getByText('Image details')).toBeTruthy();
  });

  it('calls onuse and closes when Use button is clicked', async () => {
    const evA = ev({ id: 'a', hash: 'h1', url: 'https://blossom.edufeed.org/h1.png' });
    const tile = {
      event: evA,
      events: [evA],
      meta: meta({ url: 'https://blossom.edufeed.org/h1.png', sha256: 'h1' })
    };
    const onuse = vi.fn();
    const { getByTestId } = render(ImageLibraryDetailModal, { props: { open: true, tile, onuse } });
    await fireEvent.click(getByTestId('detail-use-button'));
    expect(onuse).toHaveBeenCalledOnce();
  });

  it('calls oncancel when Cancel button is clicked', async () => {
    const evA = ev({ id: 'a', hash: 'h1', url: 'https://blossom.edufeed.org/h1.png' });
    const tile = {
      event: evA,
      events: [evA],
      meta: meta({ url: 'https://blossom.edufeed.org/h1.png', sha256: 'h1' })
    };
    const oncancel = vi.fn();
    const { getByText } = render(ImageLibraryDetailModal, {
      props: { open: true, tile, oncancel }
    });
    await fireEvent.click(getByText('Cancel'));
    expect(oncancel).toHaveBeenCalledOnce();
  });

  it('lists every attestation for the tile (one per unique author)', () => {
    const evA = ev({
      id: 'a1',
      hash: 'h1',
      url: 'https://blossom.edufeed.org/h1.png',
      credit: 'Alice',
      pubkey: 'aaaa000000000000000000000000000000000000000000000000000000000000',
      created_at: 100
    });
    const evB = ev({
      id: 'a2',
      hash: 'h1',
      url: 'https://blossom.edufeed.org/h1.png',
      credit: 'Bob',
      pubkey: 'bbbb000000000000000000000000000000000000000000000000000000000000',
      created_at: 200
    });
    const tile = {
      event: evB,
      events: [evA, evB],
      meta: meta({ url: 'https://blossom.edufeed.org/h1.png', sha256: 'h1' })
    };
    const { getByText, getAllByTestId } = render(ImageLibraryDetailModal, {
      props: { open: true, tile }
    });
    expect(getByText('2 license attestations')).toBeTruthy();
    expect(getAllByTestId('detail-attestation').length).toBe(2);
    expect(getByText(/Alice/)).toBeTruthy();
    expect(getByText(/Bob/)).toBeTruthy();
  });

  it('dedupes attestations by author, newest per author wins', () => {
    /**
     * @param {{ id: string, pubkey: string, created_at: number, credit: string }} o
     */
    function makeEvent({ id, pubkey, created_at, credit }) {
      return {
        id,
        kind: 1063,
        pubkey,
        created_at,
        content: '',
        sig: '',
        tags: [
          ['url', 'https://blossom.edufeed.org/h1.png'],
          ['x', 'h1'],
          ['m', 'image/png'],
          ['license', 'https://creativecommons.org/licenses/by/4.0/'],
          ['credit', credit]
        ]
      };
    }
    const tile = {
      event: makeEvent({ id: 'newest', pubkey: 'alice', created_at: 300, credit: 'Alice latest' }),
      meta: { url: 'https://blossom.edufeed.org/h1.png', sha256: 'h1', type: 'image/png' },
      events: [
        makeEvent({ id: 'alice-old', pubkey: 'alice', created_at: 100, credit: 'Alice early' }),
        makeEvent({ id: 'alice-mid', pubkey: 'alice', created_at: 200, credit: 'Alice middle' }),
        makeEvent({ id: 'alice-new', pubkey: 'alice', created_at: 300, credit: 'Alice latest' }),
        makeEvent({ id: 'bob-only', pubkey: 'bob', created_at: 150, credit: 'Bob' })
      ]
    };
    const { getByText, queryByText, getAllByTestId } = render(ImageLibraryDetailModal, {
      props: { open: true, tile }
    });
    // Count reflects unique authors (alice + bob = 2), not raw event count (4).
    expect(getByText('2 license attestations')).toBeTruthy();
    // List shows exactly 2 rows.
    expect(getAllByTestId('detail-attestation').length).toBe(2);
    // Alice's newest credit appears; older Alice credits do not.
    expect(getByText(/Alice latest/)).toBeTruthy();
    expect(queryByText(/Alice early/)).toBeNull();
    expect(queryByText(/Alice middle/)).toBeNull();
    // Bob appears.
    expect(getByText(/Bob/)).toBeTruthy();
  });

  it('shows singular form for one attestation', () => {
    const evA = ev({
      id: 'only',
      hash: 'h1',
      url: 'https://blossom.edufeed.org/h1.png',
      credit: 'Solo'
    });
    const tile = {
      event: evA,
      events: [evA],
      meta: meta({ url: 'https://blossom.edufeed.org/h1.png', sha256: 'h1' })
    };
    const { getByText } = render(ImageLibraryDetailModal, { props: { open: true, tile } });
    expect(getByText('1 license attestation')).toBeTruthy();
    expect(getByText(/Solo/)).toBeTruthy();
  });

  it('shows source link when attestation has a source tag', () => {
    const evA = ev({
      id: 'a',
      hash: 'h1',
      url: 'https://blossom.edufeed.org/h1.png',
      source: 'https://example.com/img'
    });
    const tile = {
      event: evA,
      events: [evA],
      meta: meta({ url: 'https://blossom.edufeed.org/h1.png', sha256: 'h1' })
    };
    const { getByText } = render(ImageLibraryDetailModal, { props: { open: true, tile } });
    expect(getByText('https://example.com/img')).toBeTruthy();
  });

  it('shows file metadata when present', () => {
    const evA = ev({ id: 'a', hash: 'h1', url: 'https://blossom.edufeed.org/h1.png' });
    const tile = {
      event: evA,
      events: [evA],
      meta: meta({
        url: 'https://blossom.edufeed.org/h1.png',
        sha256: 'h1',
        size: 2048,
        dimensions: '800x600'
      })
    };
    const { getByText } = render(ImageLibraryDetailModal, { props: { open: true, tile } });
    expect(getByText('2 KB')).toBeTruthy();
    expect(getByText('800x600')).toBeTruthy();
  });

  it('closes when backdrop is clicked', async () => {
    const evA = ev({ id: 'a', hash: 'h1', url: 'https://blossom.edufeed.org/h1.png' });
    const tile = {
      event: evA,
      events: [evA],
      meta: meta({ url: 'https://blossom.edufeed.org/h1.png', sha256: 'h1' })
    };
    const oncancel = vi.fn();
    const { container } = render(ImageLibraryDetailModal, {
      props: { open: true, tile, oncancel }
    });
    const backdrop = /** @type {Element} */ (container.querySelector('.modal-backdrop'));
    expect(backdrop).toBeTruthy();
    await fireEvent.click(backdrop);
    expect(oncancel).toHaveBeenCalledOnce();
  });
});
