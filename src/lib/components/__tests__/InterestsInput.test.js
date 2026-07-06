/**
 * InterestsInput Component Tests — free-form tag chips for profile interests.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import InterestsInput from '../shared/InterestsInput.svelte';

/** @param {ReturnType<typeof render>} utils */
function getInput(utils) {
  const input = utils.container.querySelector('input[type="text"]');
  expect(input).toBeTruthy();
  return /** @type {HTMLInputElement} */ (input);
}

describe('InterestsInput', () => {
  it('renders existing values as chips', () => {
    const { getByText } = render(InterestsInput, {
      props: { value: ['Klettern', 'Podcasts'], onchange: vi.fn() }
    });

    expect(getByText('Klettern')).toBeTruthy();
    expect(getByText('Podcasts')).toBeTruthy();
  });

  it('adds a trimmed interest on Enter and clears the input', async () => {
    const onchange = vi.fn();
    const utils = render(InterestsInput, { props: { value: ['Klettern'], onchange } });
    const input = getInput(utils);

    await fireEvent.input(input, { target: { value: '  Podcasts  ' } });
    await fireEvent.keyDown(input, { key: 'Enter' });

    expect(onchange).toHaveBeenCalledWith(['Klettern', 'Podcasts']);
    expect(input.value).toBe('');
  });

  it('adds an interest on comma', async () => {
    const onchange = vi.fn();
    const utils = render(InterestsInput, { props: { value: [], onchange } });
    const input = getInput(utils);

    await fireEvent.input(input, { target: { value: 'Musik' } });
    await fireEvent.keyDown(input, { key: ',' });

    expect(onchange).toHaveBeenCalledWith(['Musik']);
  });

  it('ignores empty or whitespace-only input', async () => {
    const onchange = vi.fn();
    const utils = render(InterestsInput, { props: { value: [], onchange } });
    const input = getInput(utils);

    await fireEvent.input(input, { target: { value: '   ' } });
    await fireEvent.keyDown(input, { key: 'Enter' });

    expect(onchange).not.toHaveBeenCalled();
  });

  it('dedupes case-insensitively without emitting onchange', async () => {
    const onchange = vi.fn();
    const utils = render(InterestsInput, { props: { value: ['Klettern'], onchange } });
    const input = getInput(utils);

    await fireEvent.input(input, { target: { value: 'klettern' } });
    await fireEvent.keyDown(input, { key: 'Enter' });

    expect(onchange).not.toHaveBeenCalled();
    expect(input.value).toBe('');
  });

  it('removes a chip via its remove button', async () => {
    const onchange = vi.fn();
    const { getByLabelText } = render(InterestsInput, {
      props: { value: ['Klettern', 'Podcasts'], onchange }
    });

    await fireEvent.click(getByLabelText(/Klettern/));

    expect(onchange).toHaveBeenCalledWith(['Podcasts']);
  });

  it('does not add beyond maxCount', async () => {
    const onchange = vi.fn();
    const utils = render(InterestsInput, {
      props: { value: ['a', 'b'], onchange, maxCount: 2 }
    });
    const input = getInput(utils);

    await fireEvent.input(input, { target: { value: 'c' } });
    await fireEvent.keyDown(input, { key: 'Enter' });

    expect(onchange).not.toHaveBeenCalled();
  });
});
