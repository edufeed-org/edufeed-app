/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';

vi.mock('$lib/paraglide/messages', () => ({ aria_close_modal: () => 'Schließen' }));

const { default: BottomSheet } = await import('../shared/BottomSheet.svelte');
const body = createRawSnippet(() => ({ render: () => '<p data-testid="sheet-body">Inhalt</p>' }));
const props = (/** @type {object} */ extra = {}) => ({
  open: true,
  title: 'Bereiche',
  onClose: vi.fn(),
  children: body,
  ...extra
});

afterEach(() => {
  document.body.style.overflow = '';
});

describe('BottomSheet', () => {
  it('renders nothing while closed', () => {
    const { queryByTestId } = render(BottomSheet, props({ open: false }));
    expect(queryByTestId('bottom-sheet')).toBeNull();
    expect(document.body.style.overflow).toBe('');
  });

  it('renders title, children and locks body scroll while open', () => {
    const { getByTestId, getByText } = render(BottomSheet, props());
    expect(getByTestId('bottom-sheet')).toBeTruthy();
    expect(getByText('Bereiche')).toBeTruthy();
    expect(getByTestId('sheet-body')).toBeTruthy();
    expect(document.body.style.overflow).toBe('hidden');
  });

  it('Esc closes without selecting', async () => {
    const onClose = vi.fn();
    render(BottomSheet, props({ onClose }));
    await fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('scrim tap and the close button call onClose', async () => {
    const onClose = vi.fn();
    const { getByTestId } = render(BottomSheet, props({ onClose }));
    await fireEvent.click(getByTestId('bottom-sheet-scrim'));
    await fireEvent.click(getByTestId('bottom-sheet-close'));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  // The phone menu sheet puts the account identity where the title would be;
  // the title then only labels the dialog for assistive tech.
  it('a header snippet replaces the visible title but keeps the aria-label and close button', () => {
    const header = createRawSnippet(() => ({
      render: () => '<a data-testid="sheet-header">Alice</a>'
    }));
    const { getByTestId, queryByText } = render(BottomSheet, props({ header }));
    expect(getByTestId('sheet-header')).toBeTruthy();
    expect(queryByText('Bereiche')).toBeNull();
    expect(getByTestId('bottom-sheet').getAttribute('aria-label')).toBe('Bereiche');
    expect(getByTestId('bottom-sheet-close')).toBeTruthy();
  });

  it('restores body scroll on unmount', () => {
    const { unmount } = render(BottomSheet, props());
    unmount();
    expect(document.body.style.overflow).toBe('');
  });
});
