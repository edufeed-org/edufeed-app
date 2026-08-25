// @ts-nocheck
/** @vitest-environment jsdom */
// WebxdcAppPicker: the composer's "+" button opens this modal to share either
// the curated pad app (config) or a discovered kind-1063 webxdc app. Pool mock
// pattern follows src/lib/__tests__/my-groups-relays.svelte.test.js.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/svelte';
import { of } from 'rxjs';

const holders = vi.hoisted(() => ({ events: /** @type {any[]} */ ([]) }));

vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  pool: {
    request: () => of(...holders.events)
  }
}));

vi.mock('$lib/helpers/relay-helper.js', () => ({
  getEducationalRelays: () => ['wss://amb.example']
}));

vi.mock('$lib/paraglide/messages', () => ({
  webxdc_apps_pick_title: () => 'Share an app',
  webxdc_apps_start_pad: () => 'Start pad',
  webxdc_apps_none: () => 'No published apps found',
  webxdc_close: () => 'Close'
}));

const { default: WebxdcAppPicker } = await import('$lib/components/groups/WebxdcAppPicker.svelte');

/** @param {{x: string, url: string, alt: string, image?: string, created_at?: number}} o */
function makeEvent({ x, url, alt, image, created_at = 1000 }) {
  const tags = [
    ['url', url],
    ['x', x],
    ['m', 'application/x-webxdc'],
    ['alt', alt]
  ];
  if (image) tags.push(['image', image]);
  return { id: `ev-${x}-${created_at}`, kind: 1063, created_at, tags };
}

function renderPicker(overrides = {}) {
  return render(WebxdcAppPicker, {
    props: {
      padApp: null,
      onSelect: vi.fn(),
      onClose: vi.fn(),
      ...overrides
    }
  });
}

describe('WebxdcAppPicker', () => {
  beforeEach(() => {
    holders.events = [];
  });

  it('shows the pad row when padApp is set', async () => {
    const padApp = { url: 'https://b/pad.xdc', sha256: 'a'.repeat(64), iconUrl: '', name: 'Pad' };
    const { getByText } = renderPicker({ padApp });
    await waitFor(() => expect(getByText('Start pad')).toBeTruthy());
  });

  it('dedupes discovered apps sharing the same x hash and calls onSelect with the app shape', async () => {
    const sameHash = 'b'.repeat(64);
    holders.events = [
      makeEvent({
        x: sameHash,
        url: 'https://b/quiz.xdc',
        alt: 'Webxdc app: Quiz',
        created_at: 100
      }),
      makeEvent({
        x: sameHash,
        url: 'https://b/quiz.xdc',
        alt: 'Webxdc app: Quiz',
        image: 'https://b/quiz.png',
        created_at: 200
      })
    ];
    const onSelect = vi.fn();
    const { getAllByTestId, getByText } = renderPicker({ onSelect });

    await waitFor(() => expect(getAllByTestId('webxdc-app-picker-row')).toHaveLength(1));
    await fireEvent.click(getByText('Quiz'));

    expect(onSelect).toHaveBeenCalledWith({
      url: 'https://b/quiz.xdc',
      sha256: sameHash,
      name: 'Quiz',
      iconUrl: 'https://b/quiz.png'
    });
  });

  it('shows the empty state when there is no pad app and nothing discovered', async () => {
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
});
