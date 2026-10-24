/**
 * HiddenSourcesToggle — inline fragment for a count line ("… · 918 importierte
 * ausgeblendet · anzeigen"). Design round 2026-10-24, option 1e: the control
 * lives in the "Oktober 2026 · 22 Events" line (and discover's results line)
 * instead of a ghost button in the filter chrome, so the chrome row never
 * changes width when the count drops to zero.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import HiddenSourcesToggle from '../HiddenSourcesToggle.svelte';
import { appSettings } from '$lib/stores/app-settings.svelte.js';

describe('HiddenSourcesToggle', () => {
  beforeEach(() => {
    appSettings.showHiddenCalendarSources = false;
  });

  it('renders nothing while no event is affected', () => {
    const { container } = render(HiddenSourcesToggle, { props: { hidden: 0 } });
    expect(container.querySelector('[data-testid="hidden-sources-toggle"]')).toBeNull();
  });

  it('states the hidden count and offers "show" as an inline link', () => {
    const { getByTestId } = render(HiddenSourcesToggle, { props: { hidden: 918 } });
    const el = getByTestId('hidden-sources-toggle');
    expect(el.tagName).toBe('SPAN'); // inline: belongs to the surrounding count line
    expect(el.textContent).toMatch(/918/);
    const action = el.querySelector('button');
    expect(action?.classList.contains('link')).toBe(true);
    expect(action?.classList.contains('btn')).toBe(false);
    expect(action?.textContent?.trim()).toMatch(/^(anzeigen|show)$/); // test locale may be de or en
  });

  it('flips the per-device setting and swaps to "hide" wording', async () => {
    const { getByTestId } = render(HiddenSourcesToggle, { props: { hidden: 918 } });
    await fireEvent.click(
      /** @type {HTMLElement} */ (getByTestId('hidden-sources-toggle').querySelector('button'))
    );
    expect(appSettings.showHiddenCalendarSources).toBe(true);
    const el = getByTestId('hidden-sources-toggle');
    expect(el.textContent).toMatch(/(inkl|incl)\. 918/);
    expect(el.querySelector('button')?.textContent?.trim()).toMatch(/^(ausblenden|hide)$/);
  });
});
