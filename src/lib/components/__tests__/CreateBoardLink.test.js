/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';

vi.mock('$lib/paraglide/messages', () => ({
  kanban_create_board: () => 'Create board',
  kanban_create_board_title: () => 'Opens the Kanban editor in a new tab'
}));

import CreateBoardLink from '$lib/components/kanban/CreateBoardLink.svelte';

describe('CreateBoardLink', () => {
  it('links to the kanban editor root in a new tab', () => {
    render(CreateBoardLink);
    const link = screen.getByRole('link', { name: /Create board/ });
    expect(link.getAttribute('href')).toBe('https://kanban.edufeed.org/');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
    expect(link.getAttribute('title')).toBe('Opens the Kanban editor in a new tab');
  });

  it('is a small DaisyUI button with an icon', () => {
    render(CreateBoardLink);
    const link = screen.getByRole('link', { name: /Create board/ });
    expect(link.classList.contains('btn')).toBe(true);
    expect(link.classList.contains('btn-sm')).toBe(true);
    expect(link.querySelector('svg')).toBeTruthy();
  });
});
