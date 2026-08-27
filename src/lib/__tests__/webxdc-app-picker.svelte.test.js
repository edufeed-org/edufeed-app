// @ts-nocheck
/** @vitest-environment jsdom */
// WebxdcAppPicker: the composer's "+" button opens this modal to share a
// curated app (resolved from a kind-1063 event ref in runtimeConfig.webxdc.
// curatedApps) or a discovered kind-1063 webxdc app. Pool mock pattern
// follows src/lib/__tests__/my-groups-relays.svelte.test.js. The curated
// resolution call is distinguished from the discovery REQ by its filter
// shape (`{ids: [...]}` vs `{kinds:[1063], '#m':[...]}`).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/svelte';
import { of } from 'rxjs';
import { nip19 } from 'nostr-tools';

const holders = vi.hoisted(() => ({
  /** @type {any[]} */ events: [],
  /** @type {any[]} */ curatedEvents: []
}));

vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  pool: {
    request: (/** @type {any} */ _relays, /** @type {any} */ filters) => {
      if (filters?.[0]?.ids) return of(...holders.curatedEvents);
      return of(...holders.events);
    }
  }
}));

vi.mock('$lib/helpers/relay-helper.js', () => ({
  getEducationalRelays: () => ['wss://amb.example'],
  getAllLookupRelays: () => ['wss://lookup.example']
}));

vi.mock('$lib/paraglide/messages', () => ({
  webxdc_apps_pick_title: () => 'Share an app',
  webxdc_apps_featured: () => 'Recommended',
  webxdc_apps_discovered: () => 'More apps',
  webxdc_launch: () => 'Starten',
  webxdc_apps_none: () => 'No published apps found',
  webxdc_close: () => 'Close'
}));

const { default: WebxdcAppPicker } = await import('$lib/components/groups/WebxdcAppPicker.svelte');

/** @param {{id: string, x: string, url: string, alt?: string, image?: string, created_at?: number}} o */
function makeFileEvent({ id, x, url, alt, image, created_at = 1000 }) {
  const tags = [
    ['url', url],
    ['x', x],
    ['m', 'application/x-webxdc']
  ];
  if (alt) tags.push(['alt', alt]);
  if (image) tags.push(['image', image]);
  return { id, kind: 1063, created_at, tags };
}

function renderPicker(overrides = {}) {
  return render(WebxdcAppPicker, {
    props: {
      curatedApps: [],
      onSelect: vi.fn(),
      onClose: vi.fn(),
      ...overrides
    }
  });
}

describe('WebxdcAppPicker', () => {
  beforeEach(() => {
    holders.events = [];
    holders.curatedEvents = [];
  });

  it('resolves a curated nevent entry and renders it as the featured row', async () => {
    const hash = 'a'.repeat(64);
    const eventId = '0'.repeat(64);
    const nevent = nip19.neventEncode({ id: eventId, relays: ['wss://hint.example'] });
    holders.curatedEvents = [
      makeFileEvent({ id: eventId, x: hash, url: 'https://b/pad.xdc', alt: 'Webxdc app: Pad' })
    ];
    const { getByTestId, getByText } = renderPicker({ curatedApps: [nevent] });

    await waitFor(() => expect(getByTestId('webxdc-app-picker-featured')).toBeTruthy());
    expect(getByText('Recommended')).toBeTruthy();
    expect(getByText('Pad')).toBeTruthy();
    expect(getByText('Starten')).toBeTruthy();
  });

  it('resolves a curated 64-hex id entry', async () => {
    const hash = 'b'.repeat(64);
    const hexId = 'e'.repeat(64);
    holders.curatedEvents = [
      makeFileEvent({ id: hexId, x: hash, url: 'https://b/quiz.xdc', alt: 'Webxdc app: Quiz' })
    ];
    const { getByTestId, getByText } = renderPicker({ curatedApps: [hexId] });

    await waitFor(() => expect(getByTestId('webxdc-app-picker-featured')).toBeTruthy());
    expect(getByText('Quiz')).toBeTruthy();
  });

  it('renders only the first curated entry featured; the rest as normal rows', async () => {
    const hexId1 = 'c'.repeat(64);
    const hexId2 = 'd'.repeat(64);
    holders.curatedEvents = [
      makeFileEvent({
        id: hexId1,
        x: 'f'.repeat(64),
        url: 'https://b/pad.xdc',
        alt: 'Webxdc app: Pad'
      }),
      makeFileEvent({
        id: hexId2,
        x: '1'.repeat(64),
        url: 'https://b/quiz.xdc',
        alt: 'Webxdc app: Quiz'
      })
    ];
    const { getByTestId, getAllByTestId, getByText } = renderPicker({
      curatedApps: [hexId1, hexId2]
    });

    await waitFor(() => expect(getByTestId('webxdc-app-picker-featured')).toBeTruthy());
    expect(getByText('Pad')).toBeTruthy();
    const rows = getAllByTestId('webxdc-app-picker-row');
    expect(rows).toHaveLength(1);
    expect(getByText('Quiz')).toBeTruthy();
  });

  it('dedupes a discovered app that is already curated (same sha256)', async () => {
    const sharedHash = '2'.repeat(64);
    const otherHash = '3'.repeat(64);
    const hexId = '4'.repeat(64);
    holders.curatedEvents = [
      makeFileEvent({
        id: hexId,
        x: sharedHash,
        url: 'https://b/pad.xdc',
        alt: 'Webxdc app: Pad'
      })
    ];
    holders.events = [
      makeFileEvent({
        id: 'discovery-1',
        x: sharedHash,
        url: 'https://b/pad.xdc',
        alt: 'Webxdc app: Pad'
      }),
      makeFileEvent({
        id: 'discovery-2',
        x: otherHash,
        url: 'https://b/quiz.xdc',
        alt: 'Webxdc app: Quiz'
      })
    ];
    const { getByTestId, getAllByTestId, getByText } = renderPicker({ curatedApps: [hexId] });

    await waitFor(() => expect(getByTestId('webxdc-app-picker-featured')).toBeTruthy());
    await waitFor(() => expect(getByText('More apps')).toBeTruthy());
    expect(getAllByTestId('webxdc-app-picker-row')).toHaveLength(1);
    expect(getByText('Quiz')).toBeTruthy();
  });

  it('skips an unresolvable curated entry with a console.warn and still shows the resolvable one', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const hexId1 = '5'.repeat(64);
    const hexId2 = '6'.repeat(64); // never answered by the mocked fetch
    holders.curatedEvents = [
      makeFileEvent({
        id: hexId1,
        x: '7'.repeat(64),
        url: 'https://b/pad.xdc',
        alt: 'Webxdc app: Pad'
      })
    ];
    const { getByTestId, getByText } = renderPicker({ curatedApps: [hexId1, hexId2] });

    await waitFor(() => expect(getByTestId('webxdc-app-picker-featured')).toBeTruthy());
    expect(getByText('Pad')).toBeTruthy();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('shows the empty state when there is nothing curated and nothing discovered', async () => {
    const { getByText } = renderPicker();
    await waitFor(() => expect(getByText('No published apps found')).toBeTruthy());
  });

  it('calls onClose from the footer close button', async () => {
    const onClose = vi.fn();
    const { getByText } = renderPicker({ onClose });
    await waitFor(() => expect(getByText('No published apps found')).toBeTruthy());
    await fireEvent.click(getByText('Close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('clicking the featured row calls onSelect with the resolved app shape', async () => {
    const hash = '8'.repeat(64);
    const hexId = '9'.repeat(64);
    holders.curatedEvents = [
      makeFileEvent({
        id: hexId,
        x: hash,
        url: 'https://b/pad.xdc',
        alt: 'Webxdc app: Pad',
        image: 'https://b/pad.png'
      })
    ];
    const onSelect = vi.fn();
    const { getByTestId } = renderPicker({ curatedApps: [hexId], onSelect });

    await waitFor(() => expect(getByTestId('webxdc-app-picker-featured')).toBeTruthy());
    await fireEvent.click(getByTestId('webxdc-app-picker-featured'));

    expect(onSelect).toHaveBeenCalledWith({
      url: 'https://b/pad.xdc',
      sha256: hash,
      name: 'Pad',
      iconUrl: 'https://b/pad.png'
    });
  });
});
