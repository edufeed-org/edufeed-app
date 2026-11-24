/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/svelte';
import { flushSync } from 'svelte';

const ME = 'a'.repeat(64);
const BOB = 'b'.repeat(64);
const HIDDEN = Symbol.for('hidden-tags');

const doubles = vi.hoisted(() => ({
  /** @type {any[]} */ lists: [],
  actionRun: vi.fn(),
  unlock: vi.fn()
}));

/**
 * @param {string} d
 * @param {string[][]} tags
 * @param {string} [content]
 * @returns {any}
 */
const list = (d, tags = [], content = '') => ({
  id: d.padEnd(64, '0'),
  kind: 30000,
  pubkey: ME,
  created_at: 1,
  content,
  tags: [['d', d], ['title', d.toUpperCase()], ...tags]
});

vi.mock('$lib/stores/personal-lists.svelte.js', () => ({
  useAllLists: () => () => doubles.lists,
  isListsLoading: () => false
}));
vi.mock('$lib/stores/action-runner.svelte.js', () => ({
  actionRunner: { run: doubles.actionRun }
}));
vi.mock('$lib/stores/accounts.svelte', () => ({ manager: { active: { signer: {} } } }));
vi.mock('$lib/stores/user-profile.svelte.js', () => ({ useUserProfile: () => () => null }));
vi.mock('applesauce-core/helpers/hidden-tags', () => ({ unlockHiddenTags: doubles.unlock }));
vi.mock('$lib/helpers/toast.js', () => ({ showToast: vi.fn() }));

import {
  AddUserToFollowSet,
  RemoveUserFromFollowSet,
  CreateFollowSet
} from 'applesauce-actions/actions';
import AddToListModal from '../lists/AddToListModal.svelte';

/** @param {string} d */
const box = (d) => /** @type {HTMLInputElement} */ (screen.getByTestId(`add-to-list-row-${d}`));

describe('AddToListModal (issue af4b3ae8)', () => {
  beforeEach(() => {
    doubles.actionRun.mockReset().mockResolvedValue(undefined);
    doubles.unlock.mockReset().mockReturnValue(new Promise(() => {}));
    const privateBob = list('secret', [], 'cipher');
    privateBob[HIDDEN] = [['p', BOB]];
    doubles.lists = [
      list('communities', [['p', 'c'.repeat(64)]]),
      list('plain'),
      list('public', [['p', BOB]]),
      privateBob,
      list('locked', [], 'cipher')
    ];
  });
  afterEach(cleanup);

  it('ticks lists that contain the person and hides community membership', () => {
    render(AddToListModal, { pubkey: BOB, onClose: () => {} });
    flushSync();
    expect(screen.queryByTestId('add-to-list-row-communities')).toBeNull();
    expect(box('plain').checked).toBe(false);
    expect(box('public').checked).toBe(true);
    expect(box('secret').checked).toBe(true);
    expect(box('locked').disabled).toBe(true);
  });

  it('adds publicly, removes from the part the person is in', async () => {
    render(AddToListModal, { pubkey: BOB, onClose: () => {} });
    flushSync();
    await fireEvent.click(box('plain'));
    expect(doubles.actionRun).toHaveBeenLastCalledWith(AddUserToFollowSet, BOB, 'plain');
    await fireEvent.click(box('public'));
    expect(doubles.actionRun).toHaveBeenLastCalledWith(
      RemoveUserFromFollowSet,
      BOB,
      'public',
      false
    );
    await fireEvent.click(box('secret'));
    expect(doubles.actionRun).toHaveBeenLastCalledWith(
      RemoveUserFromFollowSet,
      BOB,
      'secret',
      true
    );
  });

  it('tries to decrypt a locked private part', () => {
    render(AddToListModal, { pubkey: BOB, onClose: () => {} });
    flushSync();
    expect(doubles.unlock).toHaveBeenCalledWith(doubles.lists[4], {}, 'nip44');
  });

  it('creates a new list with the person in it', async () => {
    render(AddToListModal, { pubkey: BOB, onClose: () => {} });
    flushSync();
    await fireEvent.input(screen.getByTestId('add-to-list-new-title'), {
      target: { value: ' Kolleg:innen ' }
    });
    await fireEvent.click(screen.getByTestId('add-to-list-create'));
    expect(doubles.actionRun).toHaveBeenCalledWith(CreateFollowSet, 'Kolleg:innen', {
      public: [BOB]
    });
  });
});
