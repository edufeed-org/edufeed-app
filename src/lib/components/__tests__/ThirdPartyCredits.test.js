// @ts-nocheck
/** @vitest-environment jsdom */
/**
 * Third-party credits on /imprint — license-required attribution (Unicode
 * License V3 for the CLDR emoji data, MIT for emojibase), so it must render
 * on every deployment, including ones with IMPRINT_ENABLED=false.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/svelte';

const config = vi.hoisted(() => ({ runtimeConfig: {} }));
vi.mock('$lib/stores/config.svelte.js', () => config);

import ImprintPage from '../../../routes/imprint/+page.svelte';
import { THIRD_PARTY_CREDITS } from '$lib/helpers/third-party-credits.js';

function setConfig(enabled) {
  config.runtimeConfig.appName = 'Edufeed';
  config.runtimeConfig.gitRepo = 'https://example.org/repo';
  config.runtimeConfig.footer = { fundingText: '' };
  config.runtimeConfig.imprint = {
    enabled,
    organization: 'Org',
    address: {},
    contact: { email: 'a@b.c' },
    funding: []
  };
}

describe('third-party credits on /imprint', () => {
  beforeEach(() => setConfig(true));

  it.each([true, false])('renders the credits when IMPRINT_ENABLED=%s', (enabled) => {
    setConfig(enabled);
    const { getByTestId } = render(ImprintPage);
    const credits = getByTestId('third-party-credits');
    for (const credit of THIRD_PARTY_CREDITS) {
      expect(credits.querySelector(`[data-testid="credit-${credit.id}"]`)).not.toBeNull();
    }
    expect(getByTestId('third-party-notices-link').getAttribute('href')).toMatch(
      /third-party-notices\.txt$/
    );
  });

  it('credits the CLDR emoji data with copyright holders and licenses', () => {
    const { getByTestId } = render(ImprintPage);
    const item = getByTestId('credit-emoji-data');
    expect(item.textContent).toMatch(/Unicode, Inc\./);
    expect(item.textContent).toMatch(/Unicode License V3/);
    expect(item.textContent).toMatch(/Miles Johnson/);
    const hrefs = [...item.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('https://www.unicode.org/license.txt');
  });
});
