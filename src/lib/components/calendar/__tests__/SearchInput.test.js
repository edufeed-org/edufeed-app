/**
 * SearchInput Component Tests
 *
 * SearchInput is a generic, controlled search input. It is decoupled from
 * any specific store: the parent passes `value`, `onChange`, and (optionally)
 * `onSubmit`/`debounceMs`. The previous calendar-specific wiring is now done
 * by the parent (CalendarFilterBar), not the component itself.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import SearchInput from '../SearchInput.svelte';

describe('SearchInput', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders the provided value', () => {
    const { container } = render(SearchInput, { props: { value: 'hello' } });
    const input = /** @type {HTMLInputElement} */ (container.querySelector('input'));
    expect(input.value).toBe('hello');
  });

  it('fires onChange immediately when debounceMs = 0', async () => {
    const onChange = vi.fn();
    const { container } = render(SearchInput, {
      props: { value: '', debounceMs: 0, onChange }
    });
    const input = /** @type {HTMLInputElement} */ (container.querySelector('input'));

    await fireEvent.input(input, { target: { value: 'foo' } });

    expect(onChange).toHaveBeenCalledWith('foo');
  });

  it('debounces onChange when debounceMs > 0', async () => {
    const onChange = vi.fn();
    const { container } = render(SearchInput, {
      props: { value: '', debounceMs: 300, onChange }
    });
    const input = /** @type {HTMLInputElement} */ (container.querySelector('input'));

    await fireEvent.input(input, { target: { value: 'a' } });
    await fireEvent.input(input, { target: { value: 'ab' } });
    expect(onChange).not.toHaveBeenCalled();

    vi.advanceTimersByTime(300);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith('ab');
  });

  it('calls onSubmit on Enter and flushes the debounce', async () => {
    const onChange = vi.fn();
    const onSubmit = vi.fn();
    const { container } = render(SearchInput, {
      props: { value: '', debounceMs: 300, onChange, onSubmit }
    });
    const input = /** @type {HTMLInputElement} */ (container.querySelector('input'));

    await fireEvent.input(input, { target: { value: 'foo' } });
    await fireEvent.keyDown(input, { key: 'Enter' });

    expect(onSubmit).toHaveBeenCalledWith('foo');
    // The pending debounce should have fired (or been flushed) so that
    // onChange has the latest value before onSubmit observes it.
    expect(onChange).toHaveBeenCalledWith('foo');
  });

  it('renders a clear button when value is non-empty and clears on click', async () => {
    const onChange = vi.fn();
    const { container, getByLabelText } = render(SearchInput, {
      props: { value: 'foo', debounceMs: 0, onChange, clearAriaLabel: 'Clear' }
    });

    const clearBtn = getByLabelText('Clear');
    await fireEvent.click(clearBtn);

    expect(onChange).toHaveBeenLastCalledWith('');
    const input = /** @type {HTMLInputElement} */ (container.querySelector('input'));
    expect(input.value).toBe('');
  });

  it('hides the clear button when value is empty', () => {
    const { queryByLabelText } = render(SearchInput, {
      props: { value: '', debounceMs: 0, onChange: () => {}, clearAriaLabel: 'Clear' }
    });
    expect(queryByLabelText('Clear')).toBeNull();
  });

  it('reflects external value changes', async () => {
    const onChange = vi.fn();
    const { container, rerender } = render(SearchInput, {
      props: { value: 'initial', debounceMs: 0, onChange }
    });
    const input = /** @type {HTMLInputElement} */ (container.querySelector('input'));
    expect(input.value).toBe('initial');

    await rerender({ value: 'updated', debounceMs: 0, onChange });
    expect(input.value).toBe('updated');
  });
});
