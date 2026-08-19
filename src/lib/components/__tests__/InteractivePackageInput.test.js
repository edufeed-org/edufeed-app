// @ts-nocheck
/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import { zipSync, strToU8 } from 'fflate';
import * as m from '$lib/paraglide/messages';
import InteractivePackageInput from '../educational/InteractivePackageInput.svelte';

vi.mock('$lib/helpers/image-license.js', async (importOriginal) => ({
  ...(await importOriginal()),
  findExistingLicense: vi.fn(async () => null)
}));
vi.mock('$lib/services/blossom-settings-service.js', () => ({
  getActiveBlossomServer: () => 'https://blossom.test'
}));
vi.mock('$lib/stores/accounts.svelte', () => ({
  manager: { active: { pubkey: 'pk', signEvent: vi.fn() } }
}));

function pick(container, file) {
  const input = container.querySelector('input[type="file"]');
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  return fireEvent.change(input);
}

describe('InteractivePackageInput', () => {
  it('wraps an html file and reaches the pending/license state', async () => {
    const { container, findByText } = render(InteractivePackageInput, { props: { value: null } });
    await pick(container, new File(['<p>hi</p>'], 'quiz.html', { type: 'text/html' }));
    // License modal opens for the wrapped package (its file name shows the .xdc)
    expect(await findByText(/quiz\.xdc/)).toBeTruthy();
  });

  it('rejects an .xdc without index.html', async () => {
    const bad = zipSync({ 'manifest.toml': strToU8('name = "x"') });
    const { container, findByText } = render(InteractivePackageInput, { props: { value: null } });
    await pick(container, new File([bad], 'broken.xdc'));
    expect(await findByText(/index\.html/)).toBeTruthy();
  });

  it('resets the pending selection when the license modal is cancelled', async () => {
    const { container, findByText, queryByText, queryByTestId } = render(InteractivePackageInput, {
      props: { value: null }
    });
    await pick(container, new File(['<p>hi</p>'], 'quiz.html', { type: 'text/html' }));
    // Modal is open (real LicenseModal, showing the pending file's name).
    await findByText(/quiz\.xdc/);

    const cancelButton = await findByText(/^(Abbrechen|Cancel)$/);
    await fireEvent.click(cancelButton);

    // Modal closed and nothing from the cancelled selection survives: no
    // package card, no size warning, and the plain file input is back so a
    // fresh pick works.
    expect(queryByTestId('license-modal')).toBeNull();
    expect(queryByText(/quiz\.xdc/)).toBeNull();
    expect(queryByText(/50 MB/)).toBeNull();
    expect(container.querySelector('input[type="file"]')).toBeTruthy();

    // A fresh pick still works after cancelling.
    await pick(container, new File(['<p>hi again</p>'], 'redo.html', { type: 'text/html' }));
    expect(await findByText(/redo\.xdc/)).toBeTruthy();
  });

  it('renders a restored value (no local bytes) without a dead Preview button', () => {
    // Mirrors a draft-restored/edit-mode `interactivePackage`: name/size are
    // known but pendingBytes was never populated (no file was picked in this
    // session), so there is nothing for WebxdcPlayer to preview.
    const { getByText, queryByText } = render(InteractivePackageInput, {
      props: {
        value: {
          url: 'https://blossom/quiz.xdc',
          name: 'Quiz',
          type: 'application/x-webxdc',
          size: 2 * 1024 * 1024,
          sha256: 'aa',
          licenseEvent: { id: 'e' },
          iconUrl: ''
        }
      }
    });
    expect(getByText('Quiz')).toBeTruthy();
    expect(getByText(/2\.0 MB/)).toBeTruthy();
    expect(queryByText(m.interactive_input_preview())).toBeNull();
    expect(getByText(m.interactive_input_replace())).toBeTruthy();
  });
});
