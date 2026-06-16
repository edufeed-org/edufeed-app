/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import ImageLicenseOverlay from '$lib/components/shared/ImageLicenseOverlay.svelte';

/** @param {string[][]} [extraTags] */
function licenseEvent(extraTags = []) {
  return {
    id: 'a'.repeat(64),
    pubkey: 'b'.repeat(64),
    kind: 1063,
    created_at: 1000,
    content: '',
    tags: [
      ['url', 'https://blossom.example/aaa.jpg'],
      ['x', 'a'.repeat(64)],
      ['m', 'image/jpeg'],
      ['license', 'https://creativecommons.org/licenses/by/4.0/'],
      ['credit', 'Jane Doe'],
      ...extraTags
    ],
    sig: 'c'.repeat(128)
  };
}

describe('ImageLicenseOverlay', () => {
  it('renders nothing while loading', () => {
    const { container } = render(ImageLicenseOverlay, { status: 'loading' });
    expect(container.textContent?.trim()).toBe('');
  });

  it('renders the known-license badge when found', () => {
    const { getByTestId, getByText } = render(ImageLicenseOverlay, {
      status: 'found',
      licenseEvent: licenseEvent()
    });
    expect(getByTestId('license-badge')).toBeTruthy();
    expect(getByText(/CC BY 4\.0/)).toBeTruthy();
    expect(getByText(/Jane Doe/)).toBeTruthy();
  });

  it('renders the caution pill with text when missing (variant=pill)', () => {
    const { getByTestId } = render(ImageLicenseOverlay, { status: 'missing', variant: 'pill' });
    const caution = getByTestId('license-caution');
    expect(caution).toBeTruthy();
    expect(caution.textContent).toContain('No license info');
  });

  it('renders icon-only dot (no pill text) when missing (variant=dot)', () => {
    const { getByTestId } = render(ImageLicenseOverlay, { status: 'missing', variant: 'dot' });
    const caution = getByTestId('license-caution');
    expect(caution.textContent).not.toContain('No license info');
  });

  it('opens the popover on focus and closes on Escape', async () => {
    const { getByTestId, queryByTestId } = render(ImageLicenseOverlay, {
      status: 'missing',
      variant: 'pill'
    });
    const caution = getByTestId('license-caution');
    expect(queryByTestId('license-caution-popover')).toBeNull();
    await fireEvent.focus(caution);
    expect(getByTestId('license-caution-popover')).toBeTruthy();
    await fireEvent.keyDown(caution, { key: 'Escape' });
    expect(queryByTestId('license-caution-popover')).toBeNull();
  });
});
