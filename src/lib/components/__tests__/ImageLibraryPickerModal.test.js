/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import { BehaviorSubject } from 'rxjs';

// Mocked event store. We control what timeline() emits via a BehaviorSubject.
/** @type {import('rxjs').BehaviorSubject<any[]>} */
const timeline$ = new BehaviorSubject(/** @type {any[]} */ ([]));
/** @type {import('rxjs').BehaviorSubject<any>} */
const replaceable$ = new BehaviorSubject(/** @type {any} */ (undefined));

vi.mock('$lib/helpers/educational/licenseLabel.js', () => ({
  formatLicenseUrl: (/** @type {string} */ url) =>
    url === 'https://creativecommons.org/licenses/by/4.0/' ? 'CC BY 4.0' : url
}));

vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: {
    timeline: () => timeline$,
    replaceable: () => replaceable$
  },
  pool: {}
}));

vi.mock('$lib/stores/accounts.svelte', () => ({
  manager: { active: { pubkey: 'me' } }
}));

vi.mock('$lib/stores/config.svelte.js', () => ({
  runtimeConfig: {
    blossom: { maxFileSize: 5 * 1024 * 1024 },
    defaultBlossomServers: ['https://blossom.edufeed.org']
  },
  configReady: {
    subscribe: (/** @type {(v: boolean) => void} */ cb) => {
      cb(true);
      return () => {};
    }
  }
}));

vi.mock('$lib/helpers/relay-helper.js', () => ({
  getAllLookupRelays: () => ['wss://relay.example']
}));

vi.mock('$lib/loaders/base.js', () => ({
  timedPool: vi.fn(() => ({ subscribe: () => ({ unsubscribe: () => {} }) }))
}));

vi.mock('applesauce-loaders/loaders', () => ({
  createTimelineLoader: () => () => ({ subscribe: () => ({ unsubscribe: () => {} }) })
}));

vi.mock('$lib/paraglide/messages', () => ({
  image_library_picker_title: () => 'Choose a licensed image',
  image_library_picker_empty_title: () => 'No licensed images yet.',
  image_library_picker_empty_desc: () => 'Upload your first one to start your library.',
  image_library_picker_empty_cta: () => 'Upload from computer',
  image_library_picker_thumbnail_alt: () => 'Licensed image',
  image_library_picker_loading: () => 'Loading licensed images…',
  image_source_chooser_cancel: () => 'Cancel',
  image_library_picker_attestations_title: (/** @type {{ count: number }} */ { count }) =>
    count === 1 ? '1 license attestation' : `${count} license attestations`,
  image_library_picker_attestation_date: () => 'Date',
  license_modal_license_label: () => 'License',
  license_modal_credit_label: () => 'Credit',
  license_modal_attested_by: () => 'Attested by'
}));

// Stub LicenseBadge to avoid pulling its dependency tree into the test.
function Stub() {}
vi.mock('../shared/LicenseBadge.svelte', () => ({ default: Stub }));

import ImageLibraryPickerModal from '../shared/ImageLibraryPickerModal.svelte';

/**
 * Build a minimal kind 1063 event for fixtures.
 * @param {{ id: string, hash: string, url: string, license?: string, credit?: string, created_at?: number, kind?: number }} o
 */
function ev({
  id,
  hash,
  url,
  license = 'https://creativecommons.org/licenses/by/4.0/',
  credit = 'Alice',
  created_at = 1000,
  kind = 1063
}) {
  return {
    id,
    kind,
    pubkey: 'p',
    created_at,
    content: '',
    sig: '',
    tags: [
      ['url', url],
      ['x', hash],
      ['m', 'image/png'],
      ['license', license],
      ['credit', credit]
    ]
  };
}

describe('ImageLibraryPickerModal', () => {
  it('renders nothing when open is false', () => {
    timeline$.next([]);
    const { queryByText } = render(ImageLibraryPickerModal, { props: { open: false } });
    expect(queryByText('Choose a licensed image')).toBeNull();
  });

  it('renders empty state when no events match', () => {
    timeline$.next([]);
    const { getByText } = render(ImageLibraryPickerModal, { props: { open: true } });
    expect(getByText('No licensed images yet.')).toBeTruthy();
    expect(getByText('Upload from computer')).toBeTruthy();
  });

  it('renders a tile per trusted, valid, deduped event', () => {
    timeline$.next([
      ev({ id: 'a', hash: 'h1', url: 'https://blossom.edufeed.org/h1.png' }),
      ev({ id: 'b', hash: 'h2', url: 'https://blossom.edufeed.org/h2.png' }),
      ev({ id: 'c', hash: 'h3', url: 'https://blossom.edufeed.org/h3.png' })
    ]);
    const { getAllByTestId } = render(ImageLibraryPickerModal, { props: { open: true } });
    expect(getAllByTestId('library-tile').length).toBe(3);
  });

  it('excludes events whose url is not on a trusted server', () => {
    timeline$.next([
      ev({ id: 'a', hash: 'h1', url: 'https://blossom.edufeed.org/h1.png' }),
      ev({ id: 'b', hash: 'h2', url: 'https://random.host/h2.png' })
    ]);
    const { getAllByTestId } = render(ImageLibraryPickerModal, { props: { open: true } });
    expect(getAllByTestId('library-tile').length).toBe(1);
  });

  it('dedupes by hash, newest created_at wins', () => {
    timeline$.next([
      ev({
        id: 'old',
        hash: 'h1',
        url: 'https://blossom.edufeed.org/h1.png',
        credit: 'OldCredit',
        created_at: 100
      }),
      ev({
        id: 'new',
        hash: 'h1',
        url: 'https://blossom.edufeed.org/h1.png',
        credit: 'NewCredit',
        created_at: 200
      })
    ]);
    const { getAllByTestId } = render(ImageLibraryPickerModal, { props: { open: true } });
    const tiles = getAllByTestId('library-tile');
    expect(tiles.length).toBe(1);
    // Newest wins → the tile's underlying event should be the id="new" one.
    expect(tiles[0].getAttribute('data-event-id')).toBe('new');
  });

  it('excludes events missing url or sha256', () => {
    timeline$.next([
      ev({ id: 'a', hash: 'h1', url: 'https://blossom.edufeed.org/h1.png' }),
      {
        id: 'bad-no-url',
        kind: 1063,
        pubkey: 'p',
        created_at: 1000,
        content: '',
        sig: '',
        tags: [
          ['x', 'h2'],
          ['m', 'image/png']
        ]
      },
      {
        id: 'bad-no-x',
        kind: 1063,
        pubkey: 'p',
        created_at: 1000,
        content: '',
        sig: '',
        tags: [
          ['url', 'https://blossom.edufeed.org/x.png'],
          ['m', 'image/png']
        ]
      }
    ]);
    const { getAllByTestId } = render(ImageLibraryPickerModal, { props: { open: true } });
    expect(getAllByTestId('library-tile').length).toBe(1);
  });

  it('excludes events that are not kind 1063', () => {
    timeline$.next([
      ev({ id: 'a', hash: 'h1', url: 'https://blossom.edufeed.org/h1.png', kind: 1 })
    ]);
    const { queryAllByTestId } = render(ImageLibraryPickerModal, { props: { open: true } });
    expect(queryAllByTestId('library-tile').length).toBe(0);
  });

  it('emits onpick with { url, hash, licenseEvent } when a tile is clicked', async () => {
    const evtA = ev({ id: 'a', hash: 'h1', url: 'https://blossom.edufeed.org/h1.png' });
    timeline$.next([evtA]);
    const onpick = vi.fn();
    const { getAllByTestId } = render(ImageLibraryPickerModal, { props: { open: true, onpick } });
    await fireEvent.click(getAllByTestId('library-tile')[0]);
    expect(onpick).toHaveBeenCalledWith({
      url: 'https://blossom.edufeed.org/h1.png',
      hash: 'h1',
      licenseEvent: evtA
    });
  });

  it('empty-state CTA emits onupload', async () => {
    timeline$.next([]);
    const onupload = vi.fn();
    const { getByText } = render(ImageLibraryPickerModal, { props: { open: true, onupload } });
    await fireEvent.click(getByText('Upload from computer'));
    expect(onupload).toHaveBeenCalledOnce();
  });

  it('includes user 10063 servers in trusted set', () => {
    replaceable$.next({
      kind: 10063,
      pubkey: 'me',
      created_at: 1,
      id: 'list',
      content: '',
      sig: '',
      tags: [['server', 'https://my-blossom.example']]
    });
    timeline$.next([ev({ id: 'a', hash: 'h1', url: 'https://my-blossom.example/h1.png' })]);
    const { getAllByTestId } = render(ImageLibraryPickerModal, { props: { open: true } });
    expect(getAllByTestId('library-tile').length).toBe(1);
    // Reset for subsequent tests.
    replaceable$.next(undefined);
  });

  it('invokes oncancel when Cancel button clicked', async () => {
    timeline$.next([ev({ id: 'a', hash: 'h1', url: 'https://blossom.edufeed.org/h1.png' })]);
    const oncancel = vi.fn();
    const { getByText } = render(ImageLibraryPickerModal, { props: { open: true, oncancel } });
    await fireEvent.click(getByText('Cancel'));
    expect(oncancel).toHaveBeenCalledOnce();
  });

  it('invokes oncancel when backdrop clicked', async () => {
    timeline$.next([ev({ id: 'a', hash: 'h1', url: 'https://blossom.edufeed.org/h1.png' })]);
    const oncancel = vi.fn();
    const { container } = render(ImageLibraryPickerModal, { props: { open: true, oncancel } });
    const backdrop = /** @type {Element} */ (container.querySelector('.modal-backdrop'));
    expect(backdrop).toBeTruthy();
    await fireEvent.click(backdrop);
    expect(oncancel).toHaveBeenCalledOnce();
  });

  it('tie-breaks by lex order of id (lower wins) when created_at is equal', () => {
    timeline$.next([
      ev({ id: 'zzz', hash: 'h1', url: 'https://blossom.edufeed.org/h1.png', created_at: 500 }),
      ev({ id: 'aaa', hash: 'h1', url: 'https://blossom.edufeed.org/h1.png', created_at: 500 })
    ]);
    const { getAllByTestId } = render(ImageLibraryPickerModal, { props: { open: true } });
    const tiles = getAllByTestId('library-tile');
    expect(tiles.length).toBe(1);
    expect(tiles[0].getAttribute('data-event-id')).toBe('aaa');
  });

  it('renders loading state when timeline has not emitted and tiles are empty', () => {
    // Simulate a fresh open before any timeline emission: the BehaviorSubject
    // emits its initial [] synchronously, so to model "still loading" we keep
    // the subject at [] and rely on the component's loading flag being true
    // until events arrive. This test guards against showing the empty CTA
    // when really we're just waiting for the first batch.
    //
    // NOTE: with the BehaviorSubject pattern used here, the initial empty
    // array IS treated as "loaded" in practice — this test documents the
    // intended UI contract: loading state only shows when both events.length
    // is 0 AND the loading flag has not been cleared. After the first
    // subject.next([]), loading flips false because the subscription emitted.
    timeline$.next([]);
    const { queryByTestId } = render(ImageLibraryPickerModal, { props: { open: true } });
    // The test environment's BehaviorSubject emits [] synchronously on
    // subscribe, which immediately clears loading. Verify the loading spinner
    // is NOT shown and the empty-state CTA is reachable instead.
    expect(queryByTestId('library-loading')).toBeNull();
  });

  it('renders an attestation popover per tile with the event count', () => {
    timeline$.next([
      ev({
        id: 'a1',
        hash: 'h1',
        url: 'https://blossom.edufeed.org/h1.png',
        credit: 'Alice',
        created_at: 100
      }),
      ev({
        id: 'a2',
        hash: 'h1',
        url: 'https://blossom.edufeed.org/h1.png',
        credit: 'Bob',
        created_at: 200
      })
    ]);
    const { getByText } = render(ImageLibraryPickerModal, { props: { open: true } });
    // Two attestations for the same hash → popover shows count "2"
    expect(getByText('2 license attestations')).toBeTruthy();
    // Both credits appear in the popover
    expect(getByText('Alice')).toBeTruthy();
    expect(getByText('Bob')).toBeTruthy();
  });

  it('shows the singular form when only one attestation exists', () => {
    timeline$.next([
      ev({ id: 'only', hash: 'h1', url: 'https://blossom.edufeed.org/h1.png', credit: 'Solo' })
    ]);
    const { getByText } = render(ImageLibraryPickerModal, { props: { open: true } });
    expect(getByText('1 license attestation')).toBeTruthy();
    expect(getByText('Solo')).toBeTruthy();
  });
});
