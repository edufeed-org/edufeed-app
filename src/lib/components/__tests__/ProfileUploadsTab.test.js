// @ts-nocheck
/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';

/** @type {Function[]} */
let _modelSubscribers;
/** @type {any[]} */
let _modelFilters;

vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: {
    model: vi.fn((Model, filter) => ({
      subscribe: (handlers) => {
        const next = typeof handlers === 'function' ? handlers : handlers.next;
        _modelSubscribers.push(next);
        _modelFilters.push(filter);
        next([]);
        return { unsubscribe: vi.fn() };
      }
    })),
    getReplaceable: vi.fn(() => null)
  },
  pool: {}
}));

const loaderSubscribe = vi.fn(() => ({ unsubscribe: vi.fn() }));
vi.mock('$lib/loaders/base.js', () => ({
  createCachedTimelineLoader: vi.fn(() => () => ({ subscribe: loaderSubscribe }))
}));
vi.mock('$lib/helpers/relay-helper.js', () => ({
  getAllLookupRelays: () => ['wss://lookup.test']
}));
vi.mock('$lib/services/relay-service.svelte.js', () => ({
  getWriteRelays: vi.fn(async () => ['wss://write.test'])
}));
vi.mock('$lib/services/blossom-settings-service.js', () => ({
  getBlossomUploadServers: vi.fn(() => ['https://user-server.test'])
}));

const removeUpload = vi.fn(async () => ({ success: true, blossom: [] }));
vi.mock('$lib/services/uploads-service.js', () => ({
  removeUpload: (...args) => removeUpload(...args)
}));

const showToast = vi.fn();
vi.mock('$lib/helpers/toast', () => ({ showToast: (...a) => showToast(...a) }));

vi.mock('$lib/components/shared/ImageLicenseOverlay.svelte', async () => ({
  default: (await import('./fixtures/StubComponent.svelte')).default
}));

import ProfileUploadsTab from '../profile/ProfileUploadsTab.svelte';

const PUBKEY = 'a'.repeat(64);
const USER = { pubkey: PUBKEY, signer: { signEvent: vi.fn() } };
const H1 = '1'.repeat(64);
const H2 = '2'.repeat(64);

function lic(id, hash, created_at, extra = {}) {
  return {
    id,
    kind: 1063,
    pubkey: PUBKEY,
    created_at,
    content: '',
    tags: [
      ['url', `https://blossom.edufeed.org/${hash}.png`],
      ['x', hash],
      ['m', 'image/png'],
      ['title', `Bild ${id.slice(0, 2)}`],
      ['license', 'https://creativecommons.org/licenses/by/4.0/'],
      ['credit', 'Jane']
    ],
    ...extra
  };
}

async function emit(events) {
  for (const cb of _modelSubscribers) cb(events);
  await tick();
}

describe('<ProfileUploadsTab>', () => {
  beforeEach(() => {
    _modelSubscribers = [];
    _modelFilters = [];
    removeUpload.mockClear();
    showToast.mockClear();
    loaderSubscribe.mockClear();
  });

  it('subscribes to the user’s kind-1063 attestations and starts the loader', () => {
    render(ProfileUploadsTab, { pubkey: PUBKEY, activeUser: USER });
    expect(_modelFilters[0]).toEqual({ kinds: [1063], authors: [PUBKEY] });
    expect(loaderSubscribe).toHaveBeenCalled();
  });

  it('shows the empty state when nothing is loaded', () => {
    const { container } = render(ProfileUploadsTab, { pubkey: PUBKEY, activeUser: USER });
    expect(container.querySelector('[data-testid="uploads-empty"]')).toBeTruthy();
  });

  it('renders one row per hash, newest attestation first', async () => {
    const { container } = render(ProfileUploadsTab, { pubkey: PUBKEY, activeUser: USER });
    await emit([
      lic('aa'.padEnd(64, '0'), H1, 100),
      lic('bb'.padEnd(64, '0'), H1, 200),
      lic('cc'.padEnd(64, '0'), H2, 150)
    ]);
    const rows = container.querySelectorAll('[data-testid="upload-row"]');
    expect(rows).toHaveLength(2);
    expect(rows[0].getAttribute('data-hash')).toBe(H1);
    expect(rows[0].textContent).toContain('Bild bb');
    expect(rows[1].getAttribute('data-hash')).toBe(H2);
    expect(container.querySelector('[data-testid="uploads-empty"]')).toBeFalsy();
  });

  it('removes an upload after confirmation via the service and hides the row', async () => {
    const { container } = render(ProfileUploadsTab, { pubkey: PUBKEY, activeUser: USER });
    const event = lic('aa'.padEnd(64, '0'), H1, 100);
    await emit([event]);

    await fireEvent.click(container.querySelector('[data-testid="upload-remove"]'));
    const confirm = container.querySelector('[data-testid="upload-remove-confirm"]');
    expect(confirm).toBeTruthy();
    await fireEvent.click(confirm);
    await tick();
    await tick();

    expect(removeUpload).toHaveBeenCalledTimes(1);
    expect(removeUpload.mock.calls[0][0]).toBe(event);
    expect(removeUpload.mock.calls[0][1]).toBe(USER);
    expect(removeUpload.mock.calls[0][2].servers).toEqual(['https://blossom.edufeed.org']);
    expect(container.querySelectorAll('[data-testid="upload-row"]')).toHaveLength(0);
    expect(showToast.mock.calls[0][1]).toBe('success');
  });

  it('cancelling the dialog keeps the row and calls nothing', async () => {
    const { container } = render(ProfileUploadsTab, { pubkey: PUBKEY, activeUser: USER });
    await emit([lic('aa'.padEnd(64, '0'), H1, 100)]);
    await fireEvent.click(container.querySelector('[data-testid="upload-remove"]'));
    await fireEvent.click(container.querySelector('[data-testid="upload-remove-cancel"]'));
    expect(removeUpload).not.toHaveBeenCalled();
    expect(container.querySelectorAll('[data-testid="upload-row"]')).toHaveLength(1);
  });

  it('keeps the row and shows an error toast when the removal fails', async () => {
    removeUpload.mockImplementationOnce(async () => ({ success: false, blossom: [], error: 'x' }));
    const { container } = render(ProfileUploadsTab, { pubkey: PUBKEY, activeUser: USER });
    await emit([lic('aa'.padEnd(64, '0'), H1, 100)]);
    await fireEvent.click(container.querySelector('[data-testid="upload-remove"]'));
    await fireEvent.click(container.querySelector('[data-testid="upload-remove-confirm"]'));
    await tick();
    await tick();
    expect(container.querySelectorAll('[data-testid="upload-row"]')).toHaveLength(1);
    expect(showToast.mock.calls[0][1]).toBe('error');
  });
});
