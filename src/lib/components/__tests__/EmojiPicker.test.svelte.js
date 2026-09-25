// @ts-nocheck
/** @vitest-environment jsdom */
/**
 * EmojiPicker — the full unicode set for the current locale (lazy dataset),
 * grouped while browsing and ranked while searching, localized keywords and
 * English shortcodes both searchable, skin tones applied to what is picked,
 * custom NIP-30 packs above it all.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/svelte';
import { overwriteGetLocale } from '$lib/paraglide/runtime.js';
import EmojiPicker from '$lib/components/shared/EmojiPicker.svelte';

const SETS = [{ packName: 'Doge', emojis: [{ shortcode: 'doge', url: 'https://x/doge.png' }] }];

beforeAll(() => {
  overwriteGetLocale(() => 'de');
});

async function setup(props = {}) {
  const onSelect = vi.fn();
  const utils = render(EmojiPicker, { props: { onSelect, customEmojiSets: SETS, ...props } });
  await waitFor(() => expect(utils.getAllByTestId('emoji-option').length).toBeGreaterThan(1800));
  return { ...utils, onSelect };
}

describe('EmojiPicker', () => {
  it('renders the whole unicode set in localized groups, with the localized name as tooltip', async () => {
    const { getAllByRole, getByTitle } = await setup();
    const headings = getAllByRole('heading', { level: 4 }).map((h) => h.textContent);
    expect(headings).toEqual([
      'Doge',
      'Smileys & Emotionen',
      'Menschen & Körper',
      'Tiere & Natur',
      'Essen & Trinken',
      'Reisen & Orte',
      'Aktivitäten',
      'Gegenstände',
      'Symbole',
      'Flaggen'
    ]);
    expect(getByTitle('Daumen hoch').dataset.emoji).toBe('👍');
    expect(getByTitle('schmelzendes Gesicht').dataset.emoji).toBe('🫠');
  });

  it('searches German keywords and English shortcodes, best match first', async () => {
    const { getByTestId, getAllByTestId, queryByText } = await setup();
    await fireEvent.input(getByTestId('emoji-search'), { target: { value: 'daumen hoch' } });
    await waitFor(() => expect(getAllByTestId('emoji-option')[0].dataset.emoji).toBe('👍'));
    expect(queryByText('Smileys & Emotionen')).toBeNull();
    await fireEvent.input(getByTestId('emoji-search'), { target: { value: 'fire' } });
    await waitFor(() => expect(getAllByTestId('emoji-option')[0].dataset.emoji).toBe('🔥'));
  });

  it('filters custom packs by shortcode and says when nothing matches', async () => {
    const { getByTestId, queryByTestId, getAllByTestId } = await setup();
    await fireEvent.input(getByTestId('emoji-search'), { target: { value: 'dog' } });
    await waitFor(() => expect(getAllByTestId('custom-emoji-option')).toHaveLength(1));
    await fireEvent.input(getByTestId('emoji-search'), { target: { value: 'zzzzqq' } });
    await waitFor(() => expect(queryByTestId('emoji-no-results')).not.toBeNull());
    expect(queryByTestId('emoji-option')).toBeNull();
  });

  it('applies the chosen skin tone to tone-capable emojis and reports it on select', async () => {
    const { getByTestId, getByTitle, onSelect } = await setup();
    await fireEvent.change(getByTestId('emoji-skin-tone'), { target: { value: '3' } });
    await waitFor(() => expect(getByTitle('Daumen hoch').dataset.emoji).toBe('👍🏽'));
    expect(getByTitle('Feuer').dataset.emoji).toBe('🔥');
    await fireEvent.click(getByTitle('Daumen hoch'));
    expect(onSelect).toHaveBeenCalledWith('👍🏽');
    expect(localStorage.getItem('emoji-skin-tone')).toBe('3');
    await fireEvent.change(getByTestId('emoji-skin-tone'), { target: { value: '0' } });
    await waitFor(() => expect(getByTitle('Daumen hoch').dataset.emoji).toBe('👍'));
  });
});
