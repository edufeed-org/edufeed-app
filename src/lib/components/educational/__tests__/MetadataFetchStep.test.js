/**
 * MetadataFetchStep — mode toggle tests.
 *
 * The component has more behavior than this (debounced auto-inspect,
 * resolveMetadataInput dispatch). Those are covered by the existing E2E
 * + integration paths. These tests pin down the *new* surface only:
 *
 *   - the smart/manual mode toggle renders
 *   - the prop-driven default value is honored
 *   - clicking a button fires onmodechange with the new value
 *   - the toggle is hidden when readOnly (edit mode)
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import MetadataFetchStep from '../MetadataFetchStep.svelte';

/**
 * Find a toggle button by its accessible name (German UI). Returns null when missing.
 * @param {HTMLElement} container
 * @param {RegExp} pattern
 */
function getButton(container, pattern) {
  const found = Array.from(container.querySelectorAll('button')).find((b) =>
    pattern.test(b.textContent ?? '')
  );
  return /** @type {HTMLButtonElement | null} */ (found ?? null);
}

describe('MetadataFetchStep — mode toggle', () => {
  it('renders both mode buttons (Mit KI / Manuell)', () => {
    const { container } = render(MetadataFetchStep, { props: { value: '', mode: 'smart' } });
    expect(getButton(container, /KI/)).not.toBeNull();
    expect(getButton(container, /Manuell/)).not.toBeNull();
  });

  it('marks the current mode as active via aria-pressed', () => {
    const { container } = render(MetadataFetchStep, { props: { value: '', mode: 'smart' } });
    const smart = getButton(container, /KI/);
    const manual = getButton(container, /Manuell/);
    expect(smart?.getAttribute('aria-pressed')).toBe('true');
    expect(manual?.getAttribute('aria-pressed')).toBe('false');
  });

  it('calls onmodechange with "manual" when the manual button is clicked', async () => {
    const onmodechange = vi.fn();
    const { container } = render(MetadataFetchStep, {
      props: { value: '', mode: 'smart', onmodechange }
    });
    const manual = /** @type {HTMLButtonElement} */ (getButton(container, /Manuell/));
    await fireEvent.click(manual);
    expect(onmodechange).toHaveBeenCalledWith('manual');
  });

  it('calls onmodechange with "smart" when the smart button is clicked', async () => {
    const onmodechange = vi.fn();
    const { container } = render(MetadataFetchStep, {
      props: { value: '', mode: 'manual', onmodechange }
    });
    const smart = /** @type {HTMLButtonElement} */ (getButton(container, /KI/));
    await fireEvent.click(smart);
    expect(onmodechange).toHaveBeenCalledWith('smart');
  });

  it('hides the toggle in readOnly (edit) mode', () => {
    const { container } = render(MetadataFetchStep, {
      props: { value: 'naddr1xxx', mode: 'smart', readOnly: true }
    });
    expect(getButton(container, /KI/)).toBeNull();
    expect(getButton(container, /Manuell/)).toBeNull();
  });
});
