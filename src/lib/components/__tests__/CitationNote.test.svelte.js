/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/svelte';

const { mockShowToast } = vi.hoisted(() => ({ mockShowToast: vi.fn() }));
vi.mock('$lib/helpers/toast.js', () => ({ showToast: mockShowToast }));
vi.mock('$lib/paraglide/messages.js', () => ({
  amb_resource_citation_heading: () => 'Cite this resource',
  amb_resource_citation_copy: () => 'Copy citation',
  amb_resource_citation_copied: () => 'Citation copied',
  amb_resource_citation_copy_failed: () => 'Copy failed',
  amb_resource_citation_hint: () => 'Attribution follows the TULLU rule'
}));

import CitationNote from '$lib/components/educational/CitationNote.svelte';

const citation = {
  text: '„Briefe“ von Jane Doe unter der Lizenz CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/) via Edufeed (https://edufeed.org/x)',
  html: '„Briefe“ von Jane Doe unter der Lizenz <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener noreferrer license">CC BY 4.0</a> via <a href="https://edufeed.org/x" target="_blank" rel="noopener noreferrer">Edufeed</a>'
};

describe('CitationNote', () => {
  beforeEach(() => {
    mockShowToast.mockClear();
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) }
    });
  });
  afterEach(() => {
    // @ts-expect-error test cleanup
    delete globalThis.ClipboardItem;
  });

  it('renders the linked citation and a TULLU hint link', () => {
    const { container } = render(CitationNote, { props: { citation } });
    const note = container.querySelector('[data-testid="citation-note"]');
    expect(note).toBeTruthy();
    expect(note?.textContent).toContain('„Briefe“ von Jane Doe unter der Lizenz CC BY 4.0');
    const licenseLink = container.querySelector(
      'a[href="https://creativecommons.org/licenses/by/4.0/"]'
    );
    expect(licenseLink?.textContent).toBe('CC BY 4.0');
    const hint = container.querySelector('a[href*="oer-tullu-regel"]');
    expect(hint?.getAttribute('target')).toBe('_blank');
  });

  it('copies the plain-text citation when rich clipboard is unavailable', async () => {
    render(CitationNote, { props: { citation } });
    await fireEvent.click(screen.getByRole('button', { name: 'Copy citation' }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(citation.text);
    expect(mockShowToast).toHaveBeenCalledWith('Citation copied', 'success');
  });

  it('writes text/html + text/plain when ClipboardItem is supported', async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { write, writeText: vi.fn() } });
    class FakeClipboardItem {
      /** @param {Record<string, Blob>} items */
      constructor(items) {
        this.items = items;
      }
    }
    // @ts-expect-error test stub
    globalThis.ClipboardItem = FakeClipboardItem;

    render(CitationNote, { props: { citation } });
    await fireEvent.click(screen.getByRole('button', { name: 'Copy citation' }));

    expect(write).toHaveBeenCalledTimes(1);
    const item = write.mock.calls[0][0][0];
    expect(item).toBeInstanceOf(FakeClipboardItem);
    expect(Object.keys(item.items).sort()).toEqual(['text/html', 'text/plain']);
    expect(await item.items['text/plain'].text()).toBe(citation.text);
    expect(await item.items['text/html'].text()).toBe(citation.html);
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
    expect(mockShowToast).toHaveBeenCalledWith('Citation copied', 'success');
  });

  it('falls back to writeText when the rich write is rejected', async () => {
    const write = vi.fn().mockRejectedValue(new Error('nope'));
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { write, writeText } });
    // @ts-expect-error test stub
    globalThis.ClipboardItem = class {};

    render(CitationNote, { props: { citation } });
    await fireEvent.click(screen.getByRole('button', { name: 'Copy citation' }));

    expect(writeText).toHaveBeenCalledWith(citation.text);
    expect(mockShowToast).toHaveBeenCalledWith('Citation copied', 'success');
  });

  it('shows an error toast when the clipboard is unavailable', async () => {
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) }
    });
    render(CitationNote, { props: { citation } });
    await fireEvent.click(screen.getByRole('button', { name: 'Copy citation' }));
    expect(mockShowToast).toHaveBeenCalledWith('Copy failed', 'error');
  });
});
