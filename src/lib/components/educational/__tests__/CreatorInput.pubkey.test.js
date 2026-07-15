/**
 * CreatorInput Nostr-identity field — the pubkey must be validated on save.
 *
 * Regression: a user pasted an nsec (private key!) into this field and it was
 * published verbatim inside a p-tag on a public event. Saving must be blocked
 * for anything that doesn't normalize to a hex pubkey, and npub input must be
 * stored as hex.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import { nip19 } from 'nostr-tools';
import CreatorInput from '../CreatorInput.svelte';

const HEX = 'a'.repeat(64);

/**
 * Open the add form and fill name + pubkey
 * @param {HTMLElement} container
 * @param {{name: string, pubkey: string}} values
 */
async function openAndFill(container, { name, pubkey }) {
  const addButton = [...container.querySelectorAll('button')].find((b) =>
    b.textContent?.match(/add creator|autor/i)
  );
  await fireEvent.click(/** @type {Element} */ (addButton));
  const nameInput = /** @type {Element} */ (container.querySelector('#creator-name'));
  await fireEvent.input(nameInput, { target: { value: name } });
  const pubkeyInput = /** @type {Element} */ (container.querySelector('#creator-pubkey'));
  await fireEvent.input(pubkeyInput, { target: { value: pubkey } });
}

/**
 * Submit the inline add-creator form
 * @param {HTMLElement} container
 */
async function submit(container) {
  const form = /** @type {Element} */ (container.querySelector('form'));
  await fireEvent.submit(form);
}

describe('CreatorInput pubkey validation', () => {
  it('blocks save and shows an error when an nsec is pasted', async () => {
    const onchange = vi.fn();
    const { container } = render(CreatorInput, { props: { creators: [], onchange } });

    const nsec = nip19.nsecEncode(new Uint8Array(32).fill(7));
    await openAndFill(container, { name: 'Ada', pubkey: nsec });
    await submit(container);

    expect(onchange).not.toHaveBeenCalled();
    expect(container.querySelector('.creator-pubkey-error')).toBeTruthy();
  });

  it('blocks save for arbitrary garbage in the pubkey field', async () => {
    const onchange = vi.fn();
    const { container } = render(CreatorInput, { props: { creators: [], onchange } });

    await openAndFill(container, { name: 'Ada', pubkey: 'not-a-key' });
    await submit(container);

    expect(onchange).not.toHaveBeenCalled();
    expect(container.querySelector('.creator-pubkey-error')).toBeTruthy();
  });

  it('normalizes an npub to hex on save', async () => {
    const onchange = vi.fn();
    const { container } = render(CreatorInput, { props: { creators: [], onchange } });

    await openAndFill(container, { name: 'Ada', pubkey: nip19.npubEncode(HEX) });
    await submit(container);

    expect(onchange).toHaveBeenCalledTimes(1);
    const creators = onchange.mock.calls[0][0];
    expect(creators[0].pubkey).toBe(HEX);
  });

  it('saves a hex pubkey unchanged and saves without pubkey when empty', async () => {
    const onchange = vi.fn();
    const { container } = render(CreatorInput, { props: { creators: [], onchange } });

    await openAndFill(container, { name: 'Ada', pubkey: HEX });
    await submit(container);
    expect(onchange.mock.calls[0][0][0].pubkey).toBe(HEX);

    await openAndFill(container, { name: 'Grace', pubkey: '' });
    await submit(container);
    expect(onchange.mock.calls[1][0][1]).not.toHaveProperty('pubkey');
  });
});
