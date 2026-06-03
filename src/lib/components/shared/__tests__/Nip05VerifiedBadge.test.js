// @ts-nocheck
/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import Nip05VerifiedBadge from '../Nip05VerifiedBadge.svelte';
import { _clearNip05Cache } from '$lib/helpers/nip05-verify.js';

const ALICE = 'a'.repeat(64);
const BOB = 'b'.repeat(64);

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

describe('<Nip05VerifiedBadge>', () => {
  /** @type {ReturnType<typeof vi.spyOn>} */
  let fetchSpy;

  beforeEach(() => {
    _clearNip05Cache();
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('shows the nip05 text plus a verified badge when names[name] matches pubkey', async () => {
    fetchSpy.mockResolvedValue(jsonResponse({ names: { alice: ALICE } }));

    const { container, getByText } = render(Nip05VerifiedBadge, {
      pubkey: ALICE,
      nip05: 'alice@edufeed.org'
    });

    expect(getByText('alice@edufeed.org')).toBeTruthy();
    await waitFor(() => {
      const verified = container.querySelector('[data-testid="nip05-verified"]');
      expect(verified).toBeTruthy();
    });
    expect(container.querySelector('[data-testid="nip05-mismatch"]')).toBeFalsy();
  });

  it('shows a mismatch badge when names[name] resolves to a different pubkey', async () => {
    fetchSpy.mockResolvedValue(jsonResponse({ names: { alice: BOB } }));

    const { container } = render(Nip05VerifiedBadge, {
      pubkey: ALICE,
      nip05: 'alice@edufeed.org'
    });

    await waitFor(() => {
      expect(container.querySelector('[data-testid="nip05-mismatch"]')).toBeTruthy();
    });
    expect(container.querySelector('[data-testid="nip05-verified"]')).toBeFalsy();
  });

  it('shows an unverified warning when the well-known fetch fails (typo domain, offline, CORS)', async () => {
    fetchSpy.mockRejectedValue(new TypeError('Failed to fetch'));

    const { container } = render(Nip05VerifiedBadge, {
      pubkey: ALICE,
      nip05: 'alice@edufeed.or'
    });

    await waitFor(() => {
      expect(container.querySelector('[data-testid="nip05-unverified"]')).toBeTruthy();
    });
    // Not flagged as definitively wrong — softer than mismatch.
    expect(container.querySelector('[data-testid="nip05-mismatch"]')).toBeFalsy();
    expect(container.querySelector('[data-testid="nip05-verified"]')).toBeFalsy();
  });

  it('strikes through and mutes the nip05 text on mismatch (anti-impersonation)', async () => {
    fetchSpy.mockResolvedValue(jsonResponse({ names: { alice: BOB } }));

    const { container } = render(Nip05VerifiedBadge, {
      pubkey: ALICE,
      nip05: 'alice@edufeed.org'
    });

    await waitFor(() => {
      expect(container.querySelector('[data-testid="nip05-mismatch"]')).toBeTruthy();
    });

    const textSpan = Array.from(container.querySelectorAll('span')).find(
      (el) => el.textContent?.trim() === 'alice@edufeed.org'
    );
    expect(textSpan).toBeTruthy();
    expect(textSpan?.className).toMatch(/line-through/);
    expect(textSpan?.className).toMatch(/text-base-content\/50/);
  });

  it('renders no badge (and no fetch) when nip05 prop is empty', async () => {
    const { container } = render(Nip05VerifiedBadge, { pubkey: ALICE, nip05: '' });
    await tick();
    expect(container.querySelector('[data-testid="nip05-verified"]')).toBeFalsy();
    expect(container.querySelector('[data-testid="nip05-mismatch"]')).toBeFalsy();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
