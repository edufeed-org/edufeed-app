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

  it('renders no badge (and no fetch) when nip05 prop is empty', async () => {
    const { container } = render(Nip05VerifiedBadge, { pubkey: ALICE, nip05: '' });
    await tick();
    expect(container.querySelector('[data-testid="nip05-verified"]')).toBeFalsy();
    expect(container.querySelector('[data-testid="nip05-mismatch"]')).toBeFalsy();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('renders the nip05 text but no status icon when fetch fails (network/CORS)', async () => {
    fetchSpy.mockRejectedValue(new TypeError('Failed to fetch'));

    const { container, getByText } = render(Nip05VerifiedBadge, {
      pubkey: ALICE,
      nip05: 'alice@edufeed.org'
    });

    expect(getByText('alice@edufeed.org')).toBeTruthy();
    // Wait a tick for the effect to settle.
    await new Promise((r) => setTimeout(r, 10));
    expect(container.querySelector('[data-testid="nip05-verified"]')).toBeFalsy();
    expect(container.querySelector('[data-testid="nip05-mismatch"]')).toBeFalsy();
  });
});
