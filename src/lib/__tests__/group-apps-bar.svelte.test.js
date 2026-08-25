// @ts-nocheck
/** @vitest-environment jsdom */
// GroupAppsBar: findability layer for a channel's live/past webxdc sessions
// (Task 9). Renders nothing when the timeline has no webxdc shares; one row
// per deriveSessions() entry otherwise. Purely presentational — the 9450
// title enrichment fetch moved to GroupChat.svelte (see followup-1 report),
// which hands the result down as the `sessionMeta` prop.
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import { buildAppShareTemplate } from '$lib/webxdc/session-events.js';

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

  it('renders the subtitle from a provided sessionMeta map', () => {
    const app = {
      url: 'https://blossom.example/a.xdc',
      sha256: 'a'.repeat(64),
      name: 'Pad',
      iconUrl: ''
    };
    const shareTemplate = buildAppShareTemplate(pointer.id, app, 'session-1');
    const shareMessage = makeMessage({ ...shareTemplate, created_at: 2000 });
    const sessionMeta = new Map([['session-1', 'Meeting notes']]);

    const { getByText } = render(GroupAppsBar, {
      pointer,
      messages: [shareMessage],
      sessionMeta,
      onOpen: vi.fn()
    });

    expect(getByText('Meeting notes')).toBeTruthy();
  });
});
