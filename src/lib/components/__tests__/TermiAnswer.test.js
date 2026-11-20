/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import TermiAnswer from '../assistant/TermiAnswer.svelte';

describe('TermiAnswer', () => {
  it('renders the line and link actions as btn-sm anchors', () => {
    const { getByText, getByRole } = render(TermiAnswer, {
      props: {
        text: 'Hier entlang:',
        actions: [{ label: 'Zum Kalender', href: '/calendar' }]
      }
    });
    expect(getByText('Hier entlang:', { exact: false })).toBeTruthy();
    const link = getByRole('link', { name: 'Zum Kalender' });
    expect(link.getAttribute('href')).toBe('/calendar');
    expect(link.classList.contains('btn')).toBe(true);
    expect(link.classList.contains('btn-sm')).toBe(true);
  });

  it('renders run actions as buttons that call run', async () => {
    const run = vi.fn();
    const { getByRole } = render(TermiAnswer, {
      props: { text: 'x', actions: [{ label: 'Artikel schreiben', run }] }
    });
    const button = getByRole('button', { name: 'Artikel schreiben' });
    expect(button.classList.contains('btn-sm')).toBe(true);
    await fireEvent.click(button);
    expect(run).toHaveBeenCalledOnce();
  });

  it('renders no action row without actions', () => {
    const { queryByTestId } = render(TermiAnswer, { props: { text: 'Nur Text' } });
    expect(queryByTestId('termi-answer-actions')).toBeNull();
  });
});
