// @ts-nocheck
/** @vitest-environment jsdom */
// GroupAppsBar: findability layer for a channel's live/past webxdc sessions
// (Task 9). Renders nothing when the timeline has no webxdc shares; one row
// per deriveSessions() entry otherwise. Pool mock pattern follows
// src/lib/__tests__/my-groups-relays.svelte.test.js — the enrichment query
// (kind 9450 subtitle) uses pool.relay(url).request(filter, {timeout}), the
// same call shape as confirmGroupMetadata in group-management.js.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import { of } from 'rxjs';
import { buildAppShareTemplate } from '$lib/webxdc/session-events.js';

const requestSpy = vi.fn(() => of());

vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  pool: {
    relay: () => ({ request: requestSpy })
  }
}));

vi.mock('$lib/paraglide/messages', () => ({
  webxdc_apps_bar_title: () => 'Apps in this channel'
}));

const { default: GroupAppsBar } = await import('$lib/components/groups/GroupAppsBar.svelte');

const pointer = { id: 'group-1', relay: 'wss://relay.example' };

/** @param {Partial<{kind: number, content: string, tags: string[][], created_at: number}>} o */
function makeMessage(o) {
  return { id: `ev-${Math.random()}`, pubkey: 'a'.repeat(64), created_at: 1000, ...o };
}

describe('GroupAppsBar', () => {
  beforeEach(() => {
    requestSpy.mockClear();
  });

  it('renders nothing when there are no webxdc shares', () => {
    const messages = [makeMessage({ kind: 9, content: 'hello', tags: [['h', pointer.id]] })];
    const { container } = render(GroupAppsBar, { pointer, messages, onOpen: vi.fn() });
    expect(container.querySelector('details')).toBeNull();
  });

  it('shows one row per shared app and opens it on click', async () => {
    const app = {
      url: 'https://blossom.example/a.xdc',
      sha256: 'a'.repeat(64),
      name: 'Pad',
      iconUrl: 'https://blossom.example/icon.png'
    };
    const shareTemplate = buildAppShareTemplate(pointer.id, app, 'session-1');
    const shareMessage = makeMessage({ ...shareTemplate, created_at: 2000 });
    const plainMessage = makeMessage({ kind: 9, content: 'hi', tags: [['h', pointer.id]] });

    const onOpen = vi.fn();
    const { getByText } = render(GroupAppsBar, {
      pointer,
      messages: [plainMessage, shareMessage],
      onOpen
    });

    expect(getByText('Pad')).toBeTruthy();
    await fireEvent.click(getByText('Pad'));
    expect(onOpen).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session-1',
        app: expect.objectContaining({ name: 'Pad' })
      })
    );
  });

  it('does not fetch enrichment while the bar is collapsed', () => {
    const app = {
      url: 'https://blossom.example/a.xdc',
      sha256: 'a'.repeat(64),
      name: 'Pad',
      iconUrl: ''
    };
    const shareTemplate = buildAppShareTemplate(pointer.id, app, 'session-1');
    const shareMessage = makeMessage({ ...shareTemplate, created_at: 2000 });

    render(GroupAppsBar, { pointer, messages: [shareMessage], onOpen: vi.fn() });
    expect(requestSpy).not.toHaveBeenCalled();
  });

  it('fetches one per-session enrichment request once the bar is opened', async () => {
    const app = {
      url: 'https://blossom.example/a.xdc',
      sha256: 'a'.repeat(64),
      name: 'Pad',
      iconUrl: ''
    };
    const shareTemplate = buildAppShareTemplate(pointer.id, app, 'session-1');
    const shareMessage = makeMessage({ ...shareTemplate, created_at: 2000 });

    const { container } = render(GroupAppsBar, {
      pointer,
      messages: [shareMessage],
      onOpen: vi.fn()
    });
    const details = /** @type {HTMLDetailsElement} */ (container.querySelector('details'));
    details.open = true;
    await fireEvent(details, new Event('toggle'));

    expect(requestSpy).toHaveBeenCalledTimes(1);
    expect(requestSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        kinds: [9450],
        '#h': [pointer.id],
        '#i': ['session-1'],
        limit: 1
      }),
      { timeout: 2500 }
    );
  });

  it('does not re-issue the enrichment request when the session set is unchanged, even while open', async () => {
    const app = {
      url: 'https://blossom.example/a.xdc',
      sha256: 'a'.repeat(64),
      name: 'Pad',
      iconUrl: ''
    };
    const shareTemplate = buildAppShareTemplate(pointer.id, app, 'session-1');
    const shareMessage = makeMessage({ ...shareTemplate, created_at: 2000 });
    const plainMessage = makeMessage({ kind: 9, content: 'hi', tags: [['h', pointer.id]] });

    const { container, rerender } = render(GroupAppsBar, {
      pointer,
      messages: [shareMessage],
      onOpen: vi.fn()
    });
    const details = /** @type {HTMLDetailsElement} */ (container.querySelector('details'));
    details.open = true;
    await fireEvent(details, new Event('toggle'));
    expect(requestSpy).toHaveBeenCalledTimes(1);

    // A new, unrelated chat message arrives — `sessions` is a fresh array
    // (deriveSessions runs again) but the set of session ids is identical, so
    // the sessionKey-gated effect must not refetch.
    const anotherPlainMessage = makeMessage({ kind: 9, content: 'bye', tags: [['h', pointer.id]] });
    await rerender({
      pointer,
      messages: [shareMessage, plainMessage, anotherPlainMessage],
      onOpen: vi.fn()
    });
    expect(requestSpy).toHaveBeenCalledTimes(1);
  });

  it('does not refetch when the bar is closed and reopened for the same sessions', async () => {
    const app = {
      url: 'https://blossom.example/a.xdc',
      sha256: 'a'.repeat(64),
      name: 'Pad',
      iconUrl: ''
    };
    const shareTemplate = buildAppShareTemplate(pointer.id, app, 'session-1');
    const shareMessage = makeMessage({ ...shareTemplate, created_at: 2000 });

    const { container } = render(GroupAppsBar, {
      pointer,
      messages: [shareMessage],
      onOpen: vi.fn()
    });
    const details = /** @type {HTMLDetailsElement} */ (container.querySelector('details'));
    details.open = true;
    await fireEvent(details, new Event('toggle'));
    expect(requestSpy).toHaveBeenCalledTimes(1);

    details.open = false;
    await fireEvent(details, new Event('toggle'));
    details.open = true;
    await fireEvent(details, new Event('toggle'));
    expect(requestSpy).toHaveBeenCalledTimes(1);
  });
});
