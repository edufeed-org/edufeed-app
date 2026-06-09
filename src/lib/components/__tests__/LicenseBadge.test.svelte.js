/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import LicenseBadge from '$lib/components/shared/LicenseBadge.svelte';

/** @param {string[][]} [extraTags] */
function makeEvent(extraTags = []) {
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

describe('LicenseBadge', () => {
  it('renders the formatted license label and credit', () => {
    const { getByText } = render(LicenseBadge, { licenseEvent: makeEvent() });
    expect(getByText(/CC BY 4\.0/)).toBeTruthy();
    expect(getByText(/Jane Doe/)).toBeTruthy();
  });

  it('renders nothing when licenseEvent is null', () => {
    const { container } = render(LicenseBadge, { licenseEvent: null });
    expect(container.textContent?.trim()).toBe('');
  });

  it('exposes source url in the title tooltip when present', () => {
    const { container } = render(LicenseBadge, {
      licenseEvent: makeEvent([['source', 'https://example.com/origin']])
    });
    const titled = container.querySelector('[title*="example.com/origin"]');
    expect(titled).toBeTruthy();
  });
});
