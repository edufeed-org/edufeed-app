/** @vitest-environment jsdom */
/**
 * FeedComposer Tests (issue #36)
 *
 * The composer placeholder must open the kind-1 note composer modal
 * (createNote) instead of the generic create hub; the type-shortcut icon
 * buttons keep delegating to CREATE_ACTIONS.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/svelte';

vi.hoisted(() => {
  if (typeof window !== 'undefined' && !window.matchMedia) {
    // @ts-ignore
    window.matchMedia = () => ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {}
    });
  }
});

import FeedComposer from '$lib/components/dashboard/FeedComposer.svelte';

/** @type {{ openModalSpy: any, openCreateHubSpy: any }} */
const spies = vi.hoisted(() => ({ openModalSpy: null, openCreateHubSpy: null }));

vi.mock('$lib/stores/modal.svelte.js', () => ({
  modalStore: { openModal: (/** @type {any[]} */ ...args) => spies.openModalSpy(...args) }
}));

vi.mock('$lib/stores/create-hub.svelte.js', () => ({
  openCreateHub: (/** @type {any[]} */ ...args) => spies.openCreateHubSpy(...args)
}));

vi.mock('$lib/stores/accounts.svelte', () => ({
  useActiveUser: () => () => ({ pubkey: 'a'.repeat(64) })
}));

vi.mock('$lib/stores/user-profile.svelte.js', () => ({
  useUserProfile: () => () => null
}));

vi.mock('$lib/helpers/contentCreation.js', () => ({
  startResourceCreation: vi.fn()
}));

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$app/paths', () => ({ resolve: (/** @type {string} */ p) => p }));

function StubComponent() {}
vi.mock('$lib/components/shared/ProfileAvatar.svelte', () => ({ default: StubComponent }));

describe('FeedComposer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    spies.openModalSpy = vi.fn();
    spies.openCreateHubSpy = vi.fn();
  });

  it('opens the note composer modal when clicking the placeholder', async () => {
    render(FeedComposer, { props: {} });

    const placeholder = screen.getByTestId('feed-composer-placeholder');
    await fireEvent.click(placeholder);

    expect(spies.openModalSpy).toHaveBeenCalledWith('createNote', {});
    expect(spies.openCreateHubSpy).not.toHaveBeenCalled();
  });

  it('forwards the community pubkey into the note modal props', async () => {
    render(FeedComposer, { props: { communityPubkey: 'abc' } });

    await fireEvent.click(screen.getByTestId('feed-composer-placeholder'));

    expect(spies.openModalSpy).toHaveBeenCalledWith('createNote', { communityPubkey: 'abc' });
  });

  it('still renders the type shortcut buttons', () => {
    const { container } = render(FeedComposer, { props: {} });
    // event / resource / article shortcuts
    const shortcuts = container.querySelectorAll('.tooltip');
    expect(shortcuts.length).toBe(3);
  });
});
