/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import { flushSync } from 'svelte';

vi.mock('$lib/paraglide/messages', () => ({ termi_launcher_aria: () => 'Termi öffnen' }));

const { termiLauncher } = await import('$lib/stores/termi-launcher.svelte.js');
const { default: TermiLauncherButton } = await import('../shared/TermiLauncherButton.svelte');

describe('TermiLauncherButton', () => {
  beforeEach(() => {
    termiLauncher.open = false;
    termiLauncher.expanded = false;
    termiLauncher.openCount = 0;
    termiLauncher.available = true;
  });

  it('renders nothing while the assistant is unavailable', () => {
    termiLauncher.available = false;
    const { queryByTestId } = render(TermiLauncherButton);
    expect(queryByTestId('termi-header-launcher')).toBeNull();
  });

  it('opens Termi on click', async () => {
    const { getByTestId } = render(TermiLauncherButton);
    await fireEvent.click(getByTestId('termi-header-launcher'));
    expect(termiLauncher.open).toBe(true);
  });

  it('shows the open-hint count as a badge and hides it at zero', () => {
    termiLauncher.openCount = 2;
    const { getByTestId, queryByTestId } = render(TermiLauncherButton);
    expect(getByTestId('termi-header-badge').textContent?.trim()).toBe('2');
    termiLauncher.openCount = 0;
    flushSync();
    expect(queryByTestId('termi-header-badge')).toBeNull();
  });
});
