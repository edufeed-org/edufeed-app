/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';
import CoverColorPicker from '$lib/components/educational/CoverColorPicker.svelte';
import { COVER_HUE_PRESETS } from '$lib/helpers/educational/coverColor.js';

describe('CoverColorPicker', () => {
  it('renders an Auto control and one swatch per preset', () => {
    const { getByTestId, getAllByTestId } = render(CoverColorPicker, { props: { hue: null } });
    expect(getByTestId('cover-color-auto')).toBeTruthy();
    expect(getAllByTestId('cover-color-swatch').length).toBe(COVER_HUE_PRESETS.length);
  });

  it('selecting a swatch moves the slider to that preset hue', async () => {
    const { getAllByTestId, getByTestId } = render(CoverColorPicker, { props: { hue: null } });
    await fireEvent.click(getAllByTestId('cover-color-swatch')[0]);
    await tick();
    const slider = /** @type {HTMLInputElement} */ (getByTestId('cover-color-slider'));
    expect(Number(slider.value)).toBe(COVER_HUE_PRESETS[0]);
  });

  it('Auto marks itself pressed (hue reset to auto)', async () => {
    const { getByTestId } = render(CoverColorPicker, { props: { hue: 120 } });
    await fireEvent.click(getByTestId('cover-color-auto'));
    await tick();
    expect(getByTestId('cover-color-auto').getAttribute('aria-pressed')).toBe('true');
  });

  // The wizard greys this picker out the moment a thumbnail URL is set by
  // driving `disabled` from an $effect-backed $state. That only works if the
  // picker reflects a *reactive* `disabled` prop — lock that contract here so a
  // regression to a stale/inline prop is caught.
  it('reactively greys out when disabled flips to true', async () => {
    const { getByTestId, container, rerender } = render(CoverColorPicker, {
      props: { hue: null, disabled: false }
    });
    const wrapper = /** @type {HTMLElement} */ (container.querySelector('.form-control'));
    expect(wrapper.classList.contains('opacity-40')).toBe(false);
    expect(/** @type {HTMLInputElement} */ (getByTestId('cover-color-auto')).disabled).toBe(false);

    await rerender({ hue: null, disabled: true });
    await tick();

    expect(wrapper.classList.contains('pointer-events-none')).toBe(true);
    expect(wrapper.classList.contains('opacity-40')).toBe(true);
    expect(/** @type {HTMLInputElement} */ (getByTestId('cover-color-auto')).disabled).toBe(true);
    expect(/** @type {HTMLInputElement} */ (getByTestId('cover-color-slider')).disabled).toBe(true);
  });
});
