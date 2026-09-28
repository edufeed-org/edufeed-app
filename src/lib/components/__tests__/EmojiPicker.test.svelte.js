// @ts-nocheck
/** @vitest-environment jsdom */
/**
 * EmojiPicker — the full unicode set for the current locale (lazy dataset),
 * grouped while browsing and ranked while searching, localized keywords and
 * English shortcodes both searchable, skin tones applied to what is picked,
 * custom NIP-30 packs above it all.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/svelte';
import { overwriteGetLocale } from '$lib/paraglide/runtime.js';
import EmojiPicker from '$lib/components/shared/EmojiPicker.svelte';

const account = vi.hoisted(() => ({ manager: { active: { pubkey: 'alice' } } }));
vi.mock('$lib/stores/accounts.svelte', () => account);

const SETS = [{ packName: 'Doge', emojis: [{ shortcode: 'doge', url: 'https://x/doge.png' }] }];

beforeAll(() => {
  overwriteGetLocale(() => 'de');
});
beforeEach(() => {
  localStorage.clear();
  account.manager.active = { pubkey: 'alice' };
});

/** the grid button for an emoji, outside the recently-used row */
const inGrid = (utils, title) =>
  utils.getAllByTitle(title).find((el) => el.dataset.testid === 'emoji-option');

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
    const utils = await setup();
    const { getByTestId, getByTitle, onSelect } = utils;
    await fireEvent.change(getByTestId('emoji-skin-tone'), { target: { value: '3' } });
    await waitFor(() => expect(getByTitle('Daumen hoch').dataset.emoji).toBe('👍🏽'));
    expect(getByTitle('Feuer').dataset.emoji).toBe('🔥');
    await fireEvent.click(getByTitle('Daumen hoch'));
    expect(onSelect).toHaveBeenCalledWith('👍🏽');
    expect(localStorage.getItem('emoji-skin-tone')).toBe('3');
    await fireEvent.change(getByTestId('emoji-skin-tone'), { target: { value: '0' } });
    await waitFor(() => expect(inGrid(utils, 'Daumen hoch').dataset.emoji).toBe('👍'));
  });

  it('shows recently used emojis on top, newest first, custom ones included, in the current tone', async () => {
    const utils = await setup();
    expect(utils.queryByTestId('emoji-recents')).toBeNull();
    await fireEvent.click(utils.getByTitle('Feuer'));
    await fireEvent.click(utils.getByTitle('Daumen hoch'));
    await fireEvent.click(utils.getByTitle(':doge:'));
    const row = await utils.findByTestId('emoji-recents');
    expect(utils.getAllByRole('heading', { level: 4 })[0].textContent).toBe('Zuletzt verwendet');
    const items = () => [...row.querySelectorAll('[data-testid="recent-emoji-option"]')];
    expect(items().map((el) => el.dataset.shortcode ?? el.dataset.emoji)).toEqual([
      'doge',
      '👍',
      '🔥'
    ]);
    await fireEvent.change(utils.getByTestId('emoji-skin-tone'), { target: { value: '5' } });
    await waitFor(() => expect(items()[1].dataset.emoji).toBe('👍🏿'));
    await fireEvent.click(items()[1]);
    expect(utils.onSelect).toHaveBeenLastCalledWith('👍🏿');
    await waitFor(() => expect(items()[0].dataset.emoji).toBe('👍🏿'));
  });

  it('hides the row while searching', async () => {
    const utils = await setup();
    await fireEvent.click(utils.getByTitle('Feuer'));
    await utils.findByTestId('emoji-recents');
    await fireEvent.input(utils.getByTestId('emoji-search'), { target: { value: 'daumen' } });
    await waitFor(() => expect(utils.queryByTestId('emoji-recents')).toBeNull());
  });

  it('keeps a separate history per account', async () => {
    const first = await setup();
    await fireEvent.click(first.getByTitle('Feuer'));
    await first.findByTestId('emoji-recents');
    first.unmount();
    account.manager.active = { pubkey: 'bob' };
    const second = await setup();
    expect(second.queryByTestId('emoji-recents')).toBeNull();
    expect(JSON.parse(localStorage.getItem('emoji-recents:alice'))).toEqual([
      { type: 'unicode', u: '🔥' }
    ]);
  });
});
