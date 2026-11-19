/** @vitest-environment jsdom */
// The thumbs-down dialog: reason, comment, and the two consents — nothing preselected.
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/svelte';
import FeedbackModal from '../assistant/FeedbackModal.svelte';
import { overwriteGetLocale } from '$lib/paraglide/runtime.js';

overwriteGetLocale(() => 'de');

const setup = (props = {}) => {
  const onsend = vi.fn(async () => {});
  const onclose = vi.fn();
  const view = render(FeedbackModal, {
    props: { signedIn: true, hasPrivacy: true, onsend, onclose, ...props }
  });
  const box = (/** @type {string} */ name) =>
    /** @type {HTMLInputElement} */ (view.getByRole('checkbox', { name }));
  const comment = () => /** @type {HTMLTextAreaElement} */ (view.getByRole('textbox'));
  const send = () => view.getByRole('button', { name: 'Senden' });
  return { ...view, onsend, onclose, box, comment, send };
};

describe('FeedbackModal', () => {
  it('starts with both boxes unticked and no reason chosen', () => {
    const { box, getAllByRole } = setup();
    expect(box('Unterhaltung mitsenden').checked).toBe(false);
    expect(box('Mit meinem Namen senden').checked).toBe(false);
    const reasons = /** @type {HTMLInputElement[]} */ (getAllByRole('radio'));
    expect(reasons).toHaveLength(5);
    expect(reasons.some((r) => r.checked)).toBe(false);
  });

  it('offers no name box to an anonymous user', () => {
    const { queryByRole } = setup({ signedIn: false });
    expect(queryByRole('checkbox', { name: 'Mit meinem Namen senden' })).toBeNull();
  });

  it('links the privacy page only when the deployment has one', () => {
    const withPage = setup();
    expect(withPage.getByRole('link', { name: 'Datenschutz' }).getAttribute('href')).toBe(
      '/privacy'
    );
    withPage.unmount();
    expect(setup({ hasPrivacy: false }).queryByRole('link', { name: 'Datenschutz' })).toBeNull();
  });

  it('Senden hands the choices to onsend and closes', async () => {
    const { box, comment, send, getByRole, onsend, onclose } = setup();
    await fireEvent.click(getByRole('radio', { name: 'Inhaltlich falsch' }));
    await fireEvent.input(comment(), { target: { value: 'Das stimmt so nicht.' } });
    await fireEvent.click(box('Unterhaltung mitsenden'));
    await fireEvent.click(send());
    expect(onsend).toHaveBeenCalledWith({
      vote: 'down',
      reason: 'wrong',
      comment: 'Das stimmt so nicht.',
      attach: true,
      named: false
    });
    await waitFor(() => expect(onclose).toHaveBeenCalledOnce());
  });

  it('sends without a reason or comment too', async () => {
    const { send, onsend } = setup();
    await fireEvent.click(send());
    expect(onsend).toHaveBeenCalledWith({
      vote: 'down',
      reason: null,
      comment: '',
      attach: false,
      named: false
    });
  });

  it('Abbrechen closes and sends nothing', async () => {
    const { getByRole, onsend, onclose } = setup();
    await fireEvent.click(getByRole('button', { name: 'Abbrechen' }));
    expect(onclose).toHaveBeenCalledOnce();
    expect(onsend).not.toHaveBeenCalled();
  });

  it('limits the comment to 1000 characters', () => {
    expect(setup().comment().maxLength).toBe(1000);
  });

  it('two clicks on Senden send once', async () => {
    /** @type {() => void} */
    let release = () => {};
    const onsend = vi.fn(() => new Promise((r) => (release = () => r(undefined))));
    const { send, onclose } = setup({ onsend });
    await fireEvent.click(send());
    expect(/** @type {HTMLButtonElement} */ (send()).disabled).toBe(true);
    await fireEvent.click(send());
    release();
    await waitFor(() => expect(onclose).toHaveBeenCalledOnce());
    expect(onsend).toHaveBeenCalledTimes(1);
  });

  it('a failed send shows the error, keeps everything typed, and stays open', async () => {
    const onsend = vi.fn().mockRejectedValue(new Error('relay down'));
    const { box, comment, send, getByRole, findByRole, queryByText, onclose } = setup({ onsend });
    await fireEvent.click(getByRole('radio', { name: 'Sonstiges' }));
    await fireEvent.input(comment(), { target: { value: 'Mein Text' } });
    await fireEvent.click(box('Unterhaltung mitsenden'));
    await fireEvent.click(send());
    const alert = await findByRole('alert');
    expect(alert.textContent).toContain('Senden fehlgeschlagen. Bitte versuche es noch einmal.');
    expect(queryByText(/Haken bei „Mit meinem Namen senden“ entfernen/)).toBeNull();
    expect(onclose).not.toHaveBeenCalled();
    expect(comment().value).toBe('Mein Text');
    expect(box('Unterhaltung mitsenden').checked).toBe(true);
    expect(
      /** @type {HTMLInputElement} */ (getByRole('radio', { name: 'Sonstiges' })).checked
    ).toBe(true);
    expect(/** @type {HTMLButtonElement} */ (send()).disabled).toBe(false);
  });

  it('a failed named send says the tick can be removed', async () => {
    const onsend = vi.fn().mockRejectedValue(new Error('signer said no'));
    const { box, send, findByRole } = setup({ onsend });
    await fireEvent.click(box('Mit meinem Namen senden'));
    await fireEvent.click(send());
    expect((await findByRole('alert')).textContent).toMatch(
      /Haken bei „Mit meinem Namen senden“ entfernen/
    );
  });
});
