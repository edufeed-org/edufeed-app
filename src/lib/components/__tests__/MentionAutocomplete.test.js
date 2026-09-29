/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import MentionAutocomplete from '$lib/components/shared/MentionAutocomplete.svelte';

vi.mock('$lib/paraglide/messages', async (importOriginal) => ({
  .../** @type {any} */ (await importOriginal()),
  mention_suggestions_label: () => 'People suggestions'
}));

const CANDIDATES = [
  { pubkey: 'a'.repeat(64), name: 'Alice', profile: null },
  { pubkey: 'b'.repeat(64), name: 'Bob', profile: null }
];

describe('MentionAutocomplete', () => {
  it('lists candidates and highlights the given index', () => {
    const { getAllByRole } = render(MentionAutocomplete, {
      candidates: CANDIDATES,
      highlightIndex: 1,
      onSelect: () => {}
    });
    const options = getAllByRole('option');
    expect(options).toHaveLength(2);
    expect(options[1].getAttribute('aria-selected')).toBe('true');
  });

  it('fires onSelect with the pubkey on click', async () => {
    const onSelect = vi.fn();
    const { getAllByRole } = render(MentionAutocomplete, {
      candidates: CANDIDATES,
      highlightIndex: 0,
      onSelect
    });
    await fireEvent.mouseDown(getAllByRole('option')[1]);
    expect(onSelect).toHaveBeenCalledWith('b'.repeat(64));
  });

  it('renders nothing for an empty candidate list', () => {
    const { container } = render(MentionAutocomplete, {
      candidates: [],
      highlightIndex: 0,
      onSelect: () => {}
    });
    expect(container.querySelector('[role="listbox"]')).toBeNull();
  });

  it('is addressable by testid, labelled for screen readers, and full width', () => {
    const { getByTestId } = render(MentionAutocomplete, {
      candidates: CANDIDATES,
      highlightIndex: 0,
      onSelect: () => {}
    });
    const list = getByTestId('mention-suggestions');
    expect(list.getAttribute('aria-label')).toBe('People suggestions');
    expect(list.className).toContain('left-0');
    expect(list.className).not.toContain('right-4');
  });
});
