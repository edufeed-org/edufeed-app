/**
 * CreatorInput "Add myself" quick action + duplicate guard.
 *
 * Background: a user who wanted to credit herself re-added her own entry by
 * hand (ending up twice in the list) and pasted her nsec as the identity.
 * One click self-add removes the reason to hand-enter keys, and the duplicate
 * guard blocks the same person landing in the list twice.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/svelte';
import CreatorInput from '../CreatorInput.svelte';

const ME = 'c'.repeat(64);

vi.mock('$lib/helpers/profile.js', () => ({
  fetchProfileData: vi.fn(async (/** @type {string} */ pubkey) =>
    pubkey === 'c'.repeat(64) ? { name: 'Corinna' } : {}
  )
}));

/** @param {HTMLElement} container */
const selfAddButton = (container) =>
  /** @type {HTMLElement | null} */ (container.querySelector('.creator-add-self'));

describe('CreatorInput self-add', () => {
  it('adds the active user with their profile name in one click', async () => {
    const onchange = vi.fn();
    const { container } = render(CreatorInput, {
      props: { creators: [], activeUserPubkey: ME, onchange }
    });

    const button = selfAddButton(container);
    expect(button).toBeTruthy();
    await fireEvent.click(/** @type {Element} */ (button));

    await waitFor(() => expect(onchange).toHaveBeenCalled());
    const creators = onchange.mock.calls.at(-1)?.[0];
    expect(creators).toHaveLength(1);
    expect(creators[0].pubkey).toBe(ME);
    expect(creators[0].name).toBe('Corinna');
    expect(creators[0].type).toBe('Person');
  });

  it('hides the button when the active user is already a creator', () => {
    const { container } = render(CreatorInput, {
      props: {
        creators: [{ name: 'Corinna', type: 'Person', pubkey: ME }],
        activeUserPubkey: ME
      }
    });
    expect(selfAddButton(container)).toBeNull();
  });

  it('hides the button when there is no active user', () => {
    const { container } = render(CreatorInput, { props: { creators: [] } });
    expect(selfAddButton(container)).toBeNull();
  });
});

describe('CreatorInput duplicate guard', () => {
  /**
   * Open the add form and fill name (+ optional pubkey)
   * @param {HTMLElement} container
   * @param {{name: string, pubkey?: string}} values
   */
  async function openAndFill(container, { name, pubkey }) {
    const addButton = [...container.querySelectorAll('button')].find((b) =>
      b.textContent?.match(/add creator|autor/i)
    );
    await fireEvent.click(/** @type {Element} */ (addButton));
    const nameInput = /** @type {Element} */ (container.querySelector('#creator-name'));
    await fireEvent.input(nameInput, { target: { value: name } });
    if (pubkey !== undefined) {
      const pubkeyInput = /** @type {Element} */ (container.querySelector('#creator-pubkey'));
      await fireEvent.input(pubkeyInput, { target: { value: pubkey } });
    }
  }

  /** @param {HTMLElement} container */
  async function submit(container) {
    const form = /** @type {Element} */ (container.querySelector('form'));
    await fireEvent.submit(form);
  }

  it('blocks adding the same pubkey twice', async () => {
    const onchange = vi.fn();
    const { container } = render(CreatorInput, {
      props: { creators: [{ name: 'Corinna', type: 'Person', pubkey: ME }], onchange }
    });

    await openAndFill(container, { name: 'Corinna L.', pubkey: ME });
    await submit(container);

    expect(onchange).not.toHaveBeenCalled();
    expect(container.querySelector('.creator-duplicate-error')).toBeTruthy();
  });

  it('blocks adding the exact same name twice when neither has a pubkey', async () => {
    const onchange = vi.fn();
    const { container } = render(CreatorInput, {
      props: { creators: [{ name: 'Corinna Link', type: 'Person' }], onchange }
    });

    await openAndFill(container, { name: ' Corinna Link ' });
    await submit(container);

    expect(onchange).not.toHaveBeenCalled();
    expect(container.querySelector('.creator-duplicate-error')).toBeTruthy();
  });

  it('still allows editing an existing creator in place', async () => {
    const onchange = vi.fn();
    const { container } = render(CreatorInput, {
      props: { creators: [{ name: 'Corinna', type: 'Person', pubkey: ME }], onchange }
    });

    const editButton = [...container.querySelectorAll('button')].find((b) =>
      b.textContent?.match(/edit|bearbeiten/i)
    );
    await fireEvent.click(/** @type {Element} */ (editButton));
    const nameInput = /** @type {Element} */ (container.querySelector('#creator-name'));
    await fireEvent.input(nameInput, { target: { value: 'Corinna Link' } });
    await submit(container);

    expect(onchange).toHaveBeenCalledTimes(1);
    const creators = onchange.mock.calls[0][0];
    expect(creators).toHaveLength(1);
    expect(creators[0].name).toBe('Corinna Link');
    expect(creators[0].pubkey).toBe(ME);
  });
});
