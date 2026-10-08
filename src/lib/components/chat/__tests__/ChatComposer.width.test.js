/**
 * The editable field must fill the pill. DaisyUI's `input` class caps a
 * field at `clamp(3rem, 20rem, 100%)`, so without an explicit `w-full` the
 * channel composer rendered a ~20rem box floating in a full-width bar.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';

import ChatComposer from '../ChatComposer.svelte';

describe('ChatComposer input width', () => {
  it('stretches the editable field to the full width of the pill', () => {
    const { container } = render(ChatComposer, {
      props: { value: '', placeholder: 'write…', onSubmit: () => {}, testid: 'chat-input' }
    });
    const field = /** @type {HTMLElement} */ (
      container.querySelector('[data-testid="chat-input"]')
    );
    expect(field).toBeTruthy();
    expect(field.classList.contains('input')).toBe(true);
    expect(field.classList.contains('w-full')).toBe(true);
  });
});
