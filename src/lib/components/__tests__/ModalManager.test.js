// @ts-nocheck
/**
 * ModalManager — lazy modal loading.
 *
 * Every modal used to be a static import of ModalManager, which sits in the root
 * layout: the landing page preloaded ~200 modules (login, calendar, polls, meet,
 * membership, …) that no visitor needs before opening a modal. The manager now
 * `import()`s the active modal at open time.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/svelte';
import modalManagerSource from '../ModalManager.svelte?raw';
import ModalManager from '../ModalManager.svelte';
import { modalStore } from '$lib/stores/modal.svelte.js';

vi.mock('../LoginModal.svelte', async () => {
  const mock = await import('./__mocks__/DialogModalStub.svelte');
  return { default: mock.default };
});
vi.mock('../SignupModal.svelte', async () => {
  const mock = await import('./__mocks__/DialogModalStub.svelte');
  return { default: mock.default };
});

const showModal = vi.fn(function () {
  this.setAttribute('open', '');
});

beforeEach(() => {
  // jsdom has no <dialog>.showModal(); emulate the open flag it toggles.
  HTMLDialogElement.prototype.showModal = showModal;
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
  showModal.mockClear();
  modalStore.closeModal();
});

afterEach(() => {
  modalStore.closeModal();
});

describe('ModalManager lazy loading', () => {
  it('keeps every modal out of its static import graph', () => {
    const staticModalImports = modalManagerSource
      .split('\n')
      .filter((line) => /^\s*import\s.*\.svelte['"]/.test(line));
    expect(staticModalImports).toEqual([]);
  });

  it('renders nothing while no modal is active', () => {
    const { container } = render(ModalManager);
    expect(container.querySelector('dialog')).toBeNull();
  });

  it('mounts the active modal after its chunk loads and opens its dialog', async () => {
    render(ModalManager);
    modalStore.openModal('login');
    const dialog = await screen.findByTestId('dialog-stub');
    expect(dialog.id).toBe('global-login-modal');
    await waitFor(() => expect(dialog.hasAttribute('open')).toBe(true));
    expect(showModal).toHaveBeenCalledTimes(1);
  });

  it('passes the modal-specific props through to the loaded component', async () => {
    render(ModalManager);
    modalStore.openModal('login');
    const dialog = await screen.findByTestId('dialog-stub');
    expect(dialog.dataset.props.split(',')).toEqual(
      expect.arrayContaining([
        'onBunkerTransition',
        'onGoogleTransition',
        'onNSECTransition',
        'onNpubTransition'
      ])
    );
  });

  it('unmounts the modal when the store closes it', async () => {
    render(ModalManager);
    modalStore.openModal('login');
    await screen.findByTestId('dialog-stub');
    modalStore.closeModal();
    await waitFor(() => expect(screen.queryByTestId('dialog-stub')).toBeNull());
  });

  it('swaps to the target modal on a transition', async () => {
    render(ModalManager);
    modalStore.openModal('login');
    await screen.findByTestId('dialog-stub');
    modalStore.transitionModal('login', 'signup');
    await waitFor(() => expect(screen.getByTestId('dialog-stub').id).toBe('global-signup-modal'));
    await waitFor(() => expect(showModal).toHaveBeenCalledTimes(2));
  });

  it('renders nothing for a modal type without a registered component', () => {
    render(ModalManager);
    modalStore.openModal('settings');
    expect(screen.queryByTestId('dialog-stub')).toBeNull();
  });
});
