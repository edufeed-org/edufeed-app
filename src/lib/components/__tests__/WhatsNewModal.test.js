/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/svelte';
import WhatsNewModal from '../shared/WhatsNewModal.svelte';
import TermiTourScene from '../assistant/TermiTourScene.svelte';

const steps = (/** @type {any} */ extra = {}) => [
  { id: 'material', title: 'Suchen', text: 'a', action: 'Jetzt suchen', onAction: vi.fn() },
  { id: 'lesson', title: 'Planen', text: 'b', note: 'Adresse nötig', ...extra },
  { id: 'import', title: 'Termine', text: 'c' }
];

describe('WhatsNewModal', () => {
  it('walks through the steps, shows each scene and ends with the done action', async () => {
    const onDone = vi.fn();
    const onClose = vi.fn();
    const view = render(WhatsNewModal, {
      steps: steps(),
      Scene: TermiTourScene,
      doneLabel: 'Termi ausprobieren',
      onDone,
      onClose
    });
    expect(view.getByText('Suchen')).toBeTruthy();
    expect(view.getByTestId('tour-scene-material')).toBeTruthy();

    await fireEvent.click(view.getByTestId('whats-new-next'));
    expect(view.getByText('Planen')).toBeTruthy();
    expect(view.getByText('Adresse nötig')).toBeTruthy();
    expect(view.getByTestId('tour-scene-lesson')).toBeTruthy();
    // a step without an action offers no "try it now"
    expect(view.queryByTestId('whats-new-try')).toBeNull();

    await fireEvent.click(view.getByTestId('whats-new-back'));
    expect(view.getByText('Suchen')).toBeTruthy();

    await fireEvent.click(view.getByTestId('whats-new-next'));
    await fireEvent.click(view.getByTestId('whats-new-next'));
    expect(view.getByTestId('whats-new-next').textContent).toContain('Termi ausprobieren');
    await fireEvent.click(view.getByTestId('whats-new-next'));
    expect(onDone).toHaveBeenCalledOnce();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('the step action runs the caller’s start; "later" on the first step closes', async () => {
    const onClose = vi.fn();
    const list = steps();
    const view = render(WhatsNewModal, {
      steps: list,
      doneLabel: 'x',
      onDone: vi.fn(),
      onClose
    });
    await fireEvent.click(view.getByTestId('whats-new-try'));
    expect(list[0].onAction).toHaveBeenCalledOnce();
    await fireEvent.click(view.getByTestId('whats-new-back'));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('step 1 shows real search hits as links; an in-app hit closes the tour', async () => {
    const pubkey = 'a'.repeat(64);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          items: [
            { type: 'resource', id: '1', pubkey, title: 'Echter Treffer', href: '/naddr1abc' },
            { type: 'event', id: '2', pubkey, title: 'Ein Termin', href: '/naddr1def' }
          ]
        })
      )
    );
    const onClose = vi.fn();
    const view = render(WhatsNewModal, {
      steps: steps(),
      Scene: TermiTourScene,
      doneLabel: 'x',
      onDone: vi.fn(),
      onClose
    });
    const hit = await waitFor(() => view.getByTestId('tour-scene-hit'));
    expect(hit.getAttribute('href')).toBe('/naddr1abc');
    expect(view.queryByText('Ein Termin')).toBeNull();
    hit.addEventListener('click', (e) => e.preventDefault());
    await fireEvent.click(hit);
    expect(onClose).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });
});
