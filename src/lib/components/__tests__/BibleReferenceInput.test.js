/**
 * BibleReferenceInput component tests.
 *
 * The main thing we want to lock in is the absence of Svelte effect-loop
 * regressions (`effect_update_depth_exceeded`) — those happen when an
 * `$effect` reads and writes the same `$state`. We catch them here by
 * spying on `console.error`, which Svelte calls before throwing.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';
import BibleReferenceInput from '../educational/BibleReferenceInput.svelte';

describe('BibleReferenceInput', () => {
  /** @type {ReturnType<typeof vi.spyOn>} */
  let consoleErrorSpy;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  /**
   * Fail the test if any Svelte runtime error surfaced via console.error
   * during the interaction (effect loops, unsafe mutations, etc.).
   */
  function assertNoSvelteRuntimeErrors() {
    /** @type {string[]} */
    const errors = consoleErrorSpy.mock.calls.map((/** @type {unknown[]} */ args) =>
      args.map((a) => String(a)).join(' ')
    );
    const runtimeErrors = errors.filter((line) =>
      /effect_update_depth|state_unsafe_mutation|effect_orphan/.test(line)
    );
    expect(runtimeErrors).toEqual([]);
  }

  it('mounts without effect-loop errors', async () => {
    render(BibleReferenceInput, { props: { value: '' } });
    await tick();
    await tick();
    assertNoSvelteRuntimeErrors();
  });

  it('does not infinite-loop when focusing and typing a book name', async () => {
    const { container } = render(BibleReferenceInput, { props: { value: '' } });
    const input = /** @type {HTMLInputElement} */ (container.querySelector('input'));

    await fireEvent.focus(input);
    await fireEvent.input(input, { target: { value: 'Matt' } });
    await tick();
    await tick();
    await tick();

    assertNoSvelteRuntimeErrors();
  });

  it('shows the typeahead dropdown when focused with a partial book name', async () => {
    const { container } = render(BibleReferenceInput, { props: { value: 'ma' } });
    const input = /** @type {HTMLInputElement} */ (container.querySelector('input'));

    await fireEvent.focus(input);
    await tick();

    const listbox = container.querySelector('[role="listbox"]');
    expect(listbox).not.toBeNull();
    const text = listbox?.textContent ?? '';
    expect(text).toContain('Matthäus');
    expect(text).toContain('Markus');
    expect(text).toContain('Maleachi');

    assertNoSvelteRuntimeErrors();
  });

  it('shows the partial-book hint (not "nicht erkannt") for a complete book name', async () => {
    const { container } = render(BibleReferenceInput, { props: { value: 'Matthäus' } });
    await tick();
    await tick();

    expect(container.textContent).toContain('Kapitel und Vers ergänzen');
    expect(container.textContent).not.toContain('Nicht als Bibelstelle erkannt');

    assertNoSvelteRuntimeErrors();
  });

  it('hides the dropdown once an exact book is matched', async () => {
    const { container } = render(BibleReferenceInput, { props: { value: 'Matthäus' } });
    const input = /** @type {HTMLInputElement} */ (container.querySelector('input'));

    await fireEvent.focus(input);
    await tick();

    expect(container.querySelector('[role="listbox"]')).toBeNull();
    assertNoSvelteRuntimeErrors();
  });
});
