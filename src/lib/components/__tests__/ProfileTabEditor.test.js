// @ts-nocheck
/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import ProfileTabEditor from '../profile/ProfileTabEditor.svelte';

const TABS = [
  { id: 'posts', label: 'Beiträge', count: 12 },
  { id: 'content', label: 'Inhalte', count: 3 },
  { id: 'badges', label: 'Abzeichen', count: 0 }
];

function baseProps(overrides = {}) {
  return {
    tabs: TABS,
    order: ['posts', 'content', 'badges'],
    hidden: [],
    onChange: vi.fn(),
    ...overrides
  };
}

describe('<ProfileTabEditor>', () => {
  it('renders a chip per visible tab in order', () => {
    const { container } = render(ProfileTabEditor, baseProps());
    const chips = [...container.querySelectorAll('[data-testid^="tab-chip-"]')];
    expect(chips.map((c) => c.dataset.testid)).toEqual([
      'tab-chip-posts',
      'tab-chip-content',
      'tab-chip-badges'
    ]);
  });

  it('moves hidden tabs into the tray', () => {
    const { container } = render(ProfileTabEditor, baseProps({ hidden: ['content'] }));
    expect(container.querySelector('[data-testid="hidden-tray"]')).toBeTruthy();
    expect(
      container.querySelector('[data-testid="hidden-tray"] [data-testid="tab-chip-content"]')
    ).toBeTruthy();
  });

  it('reports hiding a tab via onChange', async () => {
    const onChange = vi.fn();
    const { container } = render(ProfileTabEditor, baseProps({ onChange }));
    await fireEvent.click(
      container.querySelector('[data-testid="tab-chip-content"] [data-testid="toggle-hidden"]')
    );
    expect(onChange).toHaveBeenCalledWith(['posts', 'content', 'badges'], ['content']);
  });

  it('reports unhiding a tab via onChange', async () => {
    const onChange = vi.fn();
    const { container } = render(ProfileTabEditor, baseProps({ hidden: ['content'], onChange }));
    await fireEvent.click(
      container.querySelector('[data-testid="hidden-tray"] [data-testid="toggle-hidden"]')
    );
    expect(onChange).toHaveBeenCalledWith(['posts', 'content', 'badges'], []);
  });

  it('reorders on drag and drop (dragged chip inserted before drop target)', async () => {
    const onChange = vi.fn();
    const { container } = render(ProfileTabEditor, baseProps({ onChange }));
    const badges = container.querySelector('[data-testid="tab-chip-badges"]');
    const posts = container.querySelector('[data-testid="tab-chip-posts"]');

    await fireEvent.dragStart(badges);
    await fireEvent.dragOver(posts);
    await fireEvent.drop(posts);

    expect(onChange).toHaveBeenCalledWith(['badges', 'posts', 'content'], []);
  });
});
