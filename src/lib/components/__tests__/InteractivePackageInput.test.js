// @ts-nocheck
/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import { zipSync, strToU8 } from 'fflate';
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
  Object.defineProperty(input, 'files', { value: [file] });
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
});
