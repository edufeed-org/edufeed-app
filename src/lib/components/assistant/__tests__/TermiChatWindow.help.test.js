/** @vitest-environment jsdom */
// The "Wie fange ich an?" chip: a fourth canned suggestion whose answer links
// to the configured user guide (runtimeConfig.help.url). Without a guide the
// chip is not offered at all.
import { termiEnv, windowProps } from './termi-window-setup.js';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import * as m from '$lib/paraglide/messages';

const mockConfig = termiEnv.config;
delete mockConfig.termi;
delete mockConfig.discover;
termiEnv.user = { pubkey: 'user-pub', type: 'nsec' };

import TermiChatWindow from '../TermiChatWindow.svelte';

function renderWindow() {
  return render(TermiChatWindow, { props: windowProps() });
}

describe('TermiChatWindow getting-started chip', () => {
  beforeEach(() => {
    mockConfig.help = { url: '/wiki/edufeed-erste-schritte' };
    delete mockConfig.discover;
    vi.useRealTimers();
  });

  it('offers the chip and answers with a link to the guide', async () => {
    vi.useFakeTimers();
    const { getByTestId, getByText } = renderWindow();
    const chip = getByText(/Wie fange ich an\?|How do I get started\?/);
    await fireEvent.click(chip);
    await vi.advanceTimersByTimeAsync(1000);
    const link = getByTestId('termi-help-link');
    expect(link.getAttribute('href')).toBe('/wiki/edufeed-erste-schritte');
    expect(link.getAttribute('target')).toBeNull();
  });

  it('opens an external guide in a new tab', async () => {
    mockConfig.help = { url: 'https://example.org/hilfe' };
    vi.useFakeTimers();
    const { getByTestId, getByText } = renderWindow();
    await fireEvent.click(getByText(/Wie fange ich an\?|How do I get started\?/));
    await vi.advanceTimersByTimeAsync(1000);
    const link = getByTestId('termi-help-link');
    expect(link.getAttribute('href')).toBe('https://example.org/hilfe');
    expect(link.getAttribute('target')).toBe('_blank');
  });

  it('no Entdecken button when the learning type is disabled', async () => {
    mockConfig.discover = { contentTypes: ['events'] };
    vi.useFakeTimers();
    const { queryByTestId, getByText } = render(TermiChatWindow, { props: windowProps() });
    await fireEvent.click(getByText(m.termi_sugg_2_q()));
    await vi.advanceTimersByTimeAsync(1000);
    expect(queryByTestId('termi-help-link')).toBeNull();
  });

  it('the Entdecken answer carries a button to /discover with the query filled in, through the host', async () => {
    mockConfig.discover = { contentTypes: ['learning'] };
    vi.useFakeTimers();
    const navigate = vi.fn();
    const { getByTestId, getByText } = render(TermiChatWindow, {
      props: { ...windowProps(), host: { navigate, actions: () => [] } }
    });
    await fireEvent.click(getByText(m.termi_sugg_2_q()));
    await vi.advanceTimersByTimeAsync(1000);
    const link = getByTestId('termi-help-link');
    expect(link.textContent?.trim()).toBe(m.termi_sugg_2_link());
    expect(link.getAttribute('href')).toBe(
      `/discover?type=learning&search=${encodeURIComponent(m.termi_sugg_2_query())}`
    );
    await fireEvent.click(link);
    expect(navigate).toHaveBeenCalledWith(link.getAttribute('href'));
  });

  it('hides the chip when no guide is configured', () => {
    mockConfig.help = { url: null };
    const { queryByText } = renderWindow();
    expect(queryByText(/Wie fange ich an\?|How do I get started\?/)).toBeNull();
  });
});
