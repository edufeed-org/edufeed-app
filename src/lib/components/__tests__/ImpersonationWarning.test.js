// @ts-nocheck
/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/svelte';
import { of, throwError } from 'rxjs';

vi.mock('$lib/helpers/nip05-verify.js', async (importOriginal) => {
  const original = await importOriginal();
  return { ...original, verifyNip05: vi.fn() };
});

import { verifyNip05 } from '$lib/helpers/nip05-verify.js';
import ImpersonationWarning from '../profile/ImpersonationWarning.svelte';

const TARGET = 'f'.repeat(64);
const MATCH_PUBKEY = 'a'.repeat(64);
const NPUB = 'npub1' + 'x'.repeat(59);

function kind0(pubkey, content) {
  return { kind: 0, pubkey, created_at: 100, content: JSON.stringify(content), tags: [] };
}

function baseProps(overrides = {}) {
  return {
    pubkey: TARGET,
    npub: NPUB,
    profileName: 'Musterfrau',
    searchFn: () => of(),
    ...overrides
  };
}

describe('<ImpersonationWarning>', () => {
  beforeEach(() => {
    verifyNip05.mockReset();
  });

  it('renders the warning with the profile npub', () => {
    const { container, getByText } = render(ImpersonationWarning, baseProps());
    expect(container.querySelector('[data-testid="impersonation-warning"]')).toBeTruthy();
    expect(getByText(new RegExp(NPUB.slice(0, 12)))).toBeTruthy();
  });

  it('shows a match row when a similarly named verified profile exists', async () => {
    verifyNip05.mockResolvedValue('verified');
    const searchFn = vi.fn(() =>
      of(kind0(MATCH_PUBKEY, { name: 'Musterfrau', nip05: 'muster@relilab.org' }))
    );
    const { container } = render(ImpersonationWarning, baseProps({ searchFn }));

    await waitFor(() => {
      const match = container.querySelector('[data-testid="impersonation-match"]');
      expect(match).toBeTruthy();
      expect(match.getAttribute('href')).toContain('/p/');
      expect(match.textContent).toContain('Musterfrau');
    });
    expect(verifyNip05).toHaveBeenCalledWith('muster@relilab.org', MATCH_PUBKEY);
  });

  it('shows no match row when candidates fail verification', async () => {
    verifyNip05.mockResolvedValue('mismatch');
    const searchFn = () =>
      of(kind0(MATCH_PUBKEY, { name: 'Musterfrau', nip05: 'fake@example.org' }));
    const { container } = render(ImpersonationWarning, baseProps({ searchFn }));

    await waitFor(() => expect(verifyNip05).toHaveBeenCalled());
    expect(container.querySelector('[data-testid="impersonation-match"]')).toBeFalsy();
  });

  it('degrades to the plain warning when the search errors (no NIP-50 support)', async () => {
    const searchFn = () => throwError(() => new Error('no search'));
    const { container } = render(ImpersonationWarning, baseProps({ searchFn }));
    expect(container.querySelector('[data-testid="impersonation-warning"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="impersonation-match"]')).toBeFalsy();
  });
});
