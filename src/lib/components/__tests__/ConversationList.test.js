/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import * as m from '$lib/paraglide/messages';
import { overwriteGetLocale } from '$lib/paraglide/runtime.js';
import ConversationList from '../assistant/history/ConversationList.svelte';

overwriteGetLocale(() => 'de');

const CONVS = [
  { id: 'a', title: 'Brüche', createdAt: 0, updatedAt: Date.UTC(2026, 10, 9, 12) },
  { id: 'b', title: 'Photosynthese', createdAt: 0, updatedAt: Date.UTC(2026, 0, 3, 12) }
];

function renderList(conversations = CONVS) {
  const props = {
    conversations,
    currentId: 'a',
    onOpen: vi.fn(),
    onNew: vi.fn(),
    onRemove: vi.fn(),
    onBack: vi.fn()
  };
  return { view: render(ConversationList, { props }), props };
}

describe('ConversationList', () => {
  it('renders one row per conversation with title and DD.MM.YYYY; a click opens it', async () => {
    const { view, props } = renderList();
    const rows = view.getAllByTestId('termi-history-row');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('Brüche');
    expect(rows[0].textContent).toContain('09.11.2026');
    expect(rows[1].textContent).toContain('03.01.2026');
    expect(rows[0].getAttribute('aria-current')).toBe('true');
    await fireEvent.click(rows[1]);
    expect(props.onOpen).toHaveBeenCalledWith('b');
  });

  it('drafts come first under the "Entwürfe" heading with the summary and badge', async () => {
    const draft = {
      id: 'd',
      title: 'Alt',
      createdAt: 0,
      updatedAt: Date.UTC(2026, 10, 1, 12),
      draft: {
        title: 'Bruchrechnen',
        kind: /** @type {const} */ ('series'),
        done: 2,
        total: 3,
        published: true
      }
    };
    const { view, props } = renderList([CONVS[0], draft]);
    expect(view.getByRole('heading', { name: m.termi_werkbank_drafts() })).toBeTruthy();
    const rows = view.getAllByTestId('termi-history-row');
    expect(rows[0].textContent).toContain('Bruchrechnen');
    expect(rows[0].textContent).toContain('Reihe · 2 von 3');
    expect(rows[0].textContent).toContain(m.termi_werkbank_draft_published());
    expect(rows[1].textContent).toContain('Brüche');
    await fireEvent.click(rows[0]);
    expect(props.onOpen).toHaveBeenCalledWith('d');
  });

  it('delete asks first; only the confirm removes', async () => {
    const { view, props } = renderList();
    await fireEvent.click(view.getAllByTestId('termi-history-delete')[1]);
    expect(view.getByRole('dialog').textContent).toContain(m.termi_history_delete());
    await fireEvent.click(view.getByText(m.common_cancel()));
    expect(view.queryByRole('dialog')).toBeNull();
    expect(props.onRemove).not.toHaveBeenCalled();

    await fireEvent.click(view.getAllByTestId('termi-history-delete')[1]);
    await fireEvent.click(view.getByTestId('termi-history-delete-confirm'));
    expect(props.onRemove).toHaveBeenCalledWith('b');
    expect(props.onOpen).not.toHaveBeenCalled();
  });

  it('Escape in the delete dialog closes only the dialog', async () => {
    const { view } = renderList();
    await fireEvent.click(view.getAllByTestId('termi-history-delete')[1]);
    // Svelte delegates keydown: the window's own Escape handler is skipped once propagation stops.
    const ev = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
    const stop = vi.spyOn(ev, 'stopPropagation');
    await fireEvent(view.getByTestId('termi-history-delete-confirm'), ev);
    expect(view.queryByRole('dialog')).toBeNull();
    expect(stop).toHaveBeenCalled();
  });

  it('empty state', () => {
    const { view } = renderList([]);
    expect(view.getByText(m.termi_history_empty())).toBeTruthy();
    expect(view.queryAllByTestId('termi-history-row')).toHaveLength(0);
  });

  it('back and "Neue Unterhaltung" call their handlers', async () => {
    const { view, props } = renderList();
    await fireEvent.click(view.getByText(m.termi_history_back()));
    expect(props.onBack).toHaveBeenCalledTimes(1);
    await fireEvent.click(view.getByText(m.termi_history_new()));
    expect(props.onNew).toHaveBeenCalledTimes(1);
  });
});
