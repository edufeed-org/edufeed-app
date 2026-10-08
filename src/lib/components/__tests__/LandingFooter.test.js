/** @vitest-environment jsdom */
// Landing page footer: the pre-login entry point to the user guide, next to
// the imprint. The help link follows runtimeConfig.help.url and disappears
// when a deployment sets HELP_URL=none.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/svelte';

const mockConfig = vi.hoisted(() => ({
  help: /** @type {{url: string | null}} */ ({ url: '/wiki/edufeed-erste-schritte' }),
  imprint: { enabled: true }
}));

vi.mock('$lib/stores/config.svelte.js', () => ({
  runtimeConfig: {
    get help() {
      return mockConfig.help;
    },
    get imprint() {
      return mockConfig.imprint;
    }
  }
}));

vi.mock('$app/paths', () => ({ resolve: (/** @type {string} */ p) => p }));

import LandingFooter from '../landing/LandingFooter.svelte';

describe('LandingFooter', () => {
  beforeEach(() => {
    mockConfig.help = { url: '/wiki/edufeed-erste-schritte' };
  });

  it('links to the guide and the imprint', () => {
    const { getByTestId } = render(LandingFooter);
    expect(getByTestId('landing-help-link').getAttribute('href')).toBe(
      '/wiki/edufeed-erste-schritte'
    );
    expect(getByTestId('landing-imprint-link').getAttribute('href')).toBe('/imprint');
  });

  it('omits the help link when no guide is configured', () => {
    mockConfig.help = { url: null };
    const { queryByTestId, getByTestId } = render(LandingFooter);
    expect(queryByTestId('landing-help-link')).toBeNull();
    expect(getByTestId('landing-imprint-link')).toBeTruthy();
  });
});
