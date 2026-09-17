/** @vitest-environment jsdom */
/**
 * ComposerEmojiPreview — a composer is a plain text field, so a picked NIP-30
 * custom emoji can only sit there as `:shortcode:`; the bubble later renders
 * the image, the writer never sees it (laoc, 2026-09-17). The strip shows the
 * images for the shortcodes still present in the text.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import ComposerEmojiPreview from '$lib/components/shared/ComposerEmojiPreview.svelte';

const DOGE = { shortcode: 'dogedance_sm', url: 'https://example.org/doge.gif' };
const CAT = { shortcode: 'cat', url: 'https://example.org/cat.png' };

describe('ComposerEmojiPreview', () => {
  it('renders nothing when no picked shortcode is in the text', () => {
    const { queryByTestId } = render(ComposerEmojiPreview, {
      props: { text: 'hello', picks: { dogedance_sm: DOGE } }
    });
    expect(queryByTestId('composer-emoji-preview')).toBeNull();
  });

  it('shows an image chip per picked shortcode that is still in the text', () => {
    const { getAllByTestId, getByAltText } = render(ComposerEmojiPreview, {
      props: { text: 'nun tanzt der hund :dogedance_sm:', picks: { dogedance_sm: DOGE, cat: CAT } }
    });
    expect(getAllByTestId('composer-emoji-chip')).toHaveLength(1);
    const img = /** @type {HTMLImageElement} */ (getByAltText(':dogedance_sm:'));
    expect(img.getAttribute('src')).toBe(DOGE.url);
  });

  it('shows a shortcode once even when it appears several times', () => {
    const { getAllByTestId } = render(ComposerEmojiPreview, {
      props: { text: ':cat: :cat:', picks: { cat: CAT } }
    });
    expect(getAllByTestId('composer-emoji-chip')).toHaveLength(1);
  });

  it('reports a removal through onRemove', async () => {
    const onRemove = vi.fn();
    const { getByRole } = render(ComposerEmojiPreview, {
      props: { text: ':cat:', picks: { cat: CAT }, onRemove }
    });
    await fireEvent.click(getByRole('button'));
    expect(onRemove).toHaveBeenCalledWith('cat');
  });

  it('has no remove button without an onRemove handler', () => {
    const { queryByRole } = render(ComposerEmojiPreview, {
      props: { text: ':cat:', picks: { cat: CAT } }
    });
    expect(queryByRole('button')).toBeNull();
  });
});
