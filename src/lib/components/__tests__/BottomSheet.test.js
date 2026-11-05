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

  // The grab handle promises a pull-down; on phones that must actually close
  // the sheet (laoc, 2026-11-05: "I have to click the x").
  describe('pull down to dismiss', () => {
    /** @param {Element} target @param {number[]} ys */
    async function drag(target, ys, { stepMs = 20 } = {}) {
      const sheet = /** @type {HTMLElement} */ (target.closest('[role="dialog"]'));
      const [first, ...rest] = ys;
      await fireEvent.pointerDown(target, { pointerId: 1, clientY: first, isPrimary: true });
      for (const y of rest) {
        vi.advanceTimersByTime(stepMs);
        await fireEvent.pointerMove(sheet, { pointerId: 1, clientY: y, isPrimary: true });
      }
      await fireEvent.pointerUp(sheet, {
        pointerId: 1,
        clientY: ys[ys.length - 1],
        isPrimary: true
      });
      return sheet;
    }

    it('a long pull on the handle closes the sheet', async () => {
      vi.useFakeTimers();
      try {
        const onClose = vi.fn();
        const { getByTestId } = render(BottomSheet, props({ onClose }));
        await drag(getByTestId('bottom-sheet-handle'), [100, 160, 220, 280, 340]);
        expect(onClose).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it('a short slow pull snaps back and keeps the sheet open', async () => {
      vi.useFakeTimers();
      try {
        const onClose = vi.fn();
        const { getByTestId } = render(BottomSheet, props({ onClose }));
        const sheet = await drag(getByTestId('bottom-sheet-handle'), [100, 110, 120, 130], {
          stepMs: 300
        });
        expect(onClose).not.toHaveBeenCalled();
        expect(sheet.style.transform).toBe('');
      } finally {
        vi.useRealTimers();
      }
    });

    it('follows the finger while pulling and never moves the sheet upward', async () => {
      vi.useFakeTimers();
      try {
        const { getByTestId } = render(BottomSheet, props());
        const handle = getByTestId('bottom-sheet-handle');
        const sheet = /** @type {HTMLElement} */ (handle.closest('[role="dialog"]'));
        await fireEvent.pointerDown(handle, { pointerId: 1, clientY: 100, isPrimary: true });
        await fireEvent.pointerMove(sheet, { pointerId: 1, clientY: 150, isPrimary: true });
        expect(sheet.style.transform).toBe('translateY(50px)');
        await fireEvent.pointerMove(sheet, { pointerId: 1, clientY: 60, isPrimary: true });
        expect(sheet.style.transform).toBe('translateY(0px)');
        await fireEvent.pointerCancel(sheet, { pointerId: 1 });
        expect(sheet.style.transform).toBe('');
      } finally {
        vi.useRealTimers();
      }
    });

    it('a pull on the body is ignored while the sheet is scrolled down', async () => {
      vi.useFakeTimers();
      try {
        const onClose = vi.fn();
        const { getByTestId } = render(BottomSheet, props({ onClose }));
        const body = getByTestId('sheet-body');
        const sheet = /** @type {HTMLElement} */ (body.closest('[role="dialog"]'));
        Object.defineProperty(sheet, 'scrollTop', { value: 40, configurable: true });
        await drag(body, [100, 200, 300, 400]);
        expect(onClose).not.toHaveBeenCalled();
        // Scrolled back to the top the same pull closes it.
        Object.defineProperty(sheet, 'scrollTop', { value: 0, configurable: true });
        await drag(body, [100, 200, 300, 400]);
        expect(onClose).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  it('restores body scroll on unmount', () => {
    const { unmount } = render(BottomSheet, props());
    unmount();
    expect(document.body.style.overflow).toBe('');
  });
});
