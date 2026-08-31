/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import MentionAutocomplete from '$lib/components/community/channels/MentionAutocomplete.svelte';

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
});
