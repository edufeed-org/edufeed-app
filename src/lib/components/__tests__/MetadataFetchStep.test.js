// @ts-nocheck
/**
 * MetadataFetchStep Component Tests
 *
 * Verifies the fully-automatic inspect behavior: typing fires
 * `resolveMetadataInput` after a short debounce, pasting fires it
 * immediately, and multiple keystrokes within the debounce window
 * collapse into a single call.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import MetadataFetchStep from '../educational/MetadataFetchStep.svelte';

const resolveMock = vi.fn(async () => ({ kind: 'empty' }));

vi.mock('$lib/helpers/educational/resolveMetadataInput.js', () => ({
  resolveMetadataInput: (...args) => resolveMock(...args)
}));

vi.mock('$lib/paraglide/messages', () => ({
  amb_form_step_url_label: () => 'Resource URL or naddr'
}));

beforeEach(() => {
  resolveMock.mockClear();
  resolveMock.mockImplementation(async () => ({ kind: 'empty' }));
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('MetadataFetchStep auto-inspect', () => {
  it('renders the URL input only — no inspect, no smart/manual toggle', () => {
    const { container } = render(MetadataFetchStep, { props: { value: '' } });
    expect(container.querySelector('#metadata-input')).toBeTruthy();
    // No inspect trigger — auto-inspect is debounce-driven.
    const buttons = Array.from(container.querySelectorAll('button'));
    expect(buttons.some((b) => /check|inspect|fetch/i.test(b.textContent ?? ''))).toBe(false);
    // The "Mit KI ausfüllen" / "Manuell ausfüllen" toggle was removed in
    // favor of an explicit, wizard-owned enrichment button. Verify it's gone.
    expect(buttons.some((b) => /mit ki|manuell/i.test(b.textContent ?? ''))).toBe(false);
  });

  it('auto-inspects after debounce when user types', async () => {
    const { container } = render(MetadataFetchStep, { props: { value: '' } });
    const input = container.querySelector('#metadata-input');

    await fireEvent.input(input, { target: { value: 'https://example.com/a' } });

    // Not fired yet — debounce not elapsed
    expect(resolveMock).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(500);

    expect(resolveMock).toHaveBeenCalledTimes(1);
    expect(resolveMock.mock.calls[0][0]).toBe('https://example.com/a');
  });

  it('debounces rapid keystrokes into a single call', async () => {
    const { container } = render(MetadataFetchStep, { props: { value: '' } });
    const input = container.querySelector('#metadata-input');

    await fireEvent.input(input, { target: { value: 'https://e' } });
    await vi.advanceTimersByTimeAsync(100);
    await fireEvent.input(input, { target: { value: 'https://ex' } });
    await vi.advanceTimersByTimeAsync(100);
    await fireEvent.input(input, { target: { value: 'https://example.com' } });

    expect(resolveMock).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(500);

    expect(resolveMock).toHaveBeenCalledTimes(1);
    expect(resolveMock.mock.calls[0][0]).toBe('https://example.com');
  });

  it('does not auto-inspect when the input is empty or whitespace', async () => {
    const { container } = render(MetadataFetchStep, { props: { value: '' } });
    const input = container.querySelector('#metadata-input');

    await fireEvent.input(input, { target: { value: '   ' } });
    await vi.advanceTimersByTimeAsync(600);

    expect(resolveMock).not.toHaveBeenCalled();
  });

  it('fires immediately on paste, bypassing the debounce', async () => {
    const { container } = render(MetadataFetchStep, { props: { value: '' } });
    const input = container.querySelector('#metadata-input');

    // Simulate a paste: set the value then dispatch a paste event.
    await fireEvent.input(input, { target: { value: 'naddr1examplevalue' } });
    await fireEvent.paste(input);

    // Paste handler fires on the next tick (setTimeout 0).
    await vi.advanceTimersByTimeAsync(0);

    expect(resolveMock).toHaveBeenCalledTimes(1);
    expect(resolveMock.mock.calls[0][0]).toBe('naddr1examplevalue');
  });

  it('emits onbusychange(true) while inspecting and onbusychange(false) when done', async () => {
    /** @type {(value: any) => void} */
    let resolveInspect;
    resolveMock.mockImplementation(
      () =>
        new Promise((res) => {
          resolveInspect = res;
        })
    );

    const onbusychange = vi.fn();
    const { container } = render(MetadataFetchStep, {
      props: { value: '', onbusychange }
    });
    const input = container.querySelector('#metadata-input');

    await fireEvent.input(input, { target: { value: 'https://example.com/a' } });
    await vi.advanceTimersByTimeAsync(500);

    // Inspect is in flight — busy must have been signalled true.
    expect(onbusychange).toHaveBeenCalledWith(true);

    // Resolve the inspection.
    resolveInspect({ kind: 'empty' });
    // Flush microtasks + any pending timers.
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    await Promise.resolve();

    // Last call must be `false`.
    const lastCall = onbusychange.mock.calls[onbusychange.mock.calls.length - 1];
    expect(lastCall[0]).toBe(false);
  });
});
