/**
 * ResourceVariantPickerModal Component Tests
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';

// Mock paraglide messages for both variant i18n keys.
vi.mock('$lib/paraglide/messages', () => ({
  resource_variant_picker_title: () => 'Welche Art?',
  resource_variant_picker_description: () => 'Wähle eine Form.',
  resource_variant_picker_cancel: () => 'Abbrechen',
  resource_form_variant_amb_label: () => 'AMB-Bildungsmaterial',
  resource_form_variant_amb_description: () => 'AMB-Metadatenprofil',
  resource_form_variant_ekw_label: () => 'EKW-Bildungsmaterial',
  resource_form_variant_ekw_description: () => 'EKW-Metadatenprofil'
}));

// Mock the registry so tests control which variants are "enabled".
vi.mock('$lib/config/resource-form-variants.js', () => {
  /** @type {Array<{id: string, labelKey: string, descriptionKey: string}>} */
  let variants = [
    {
      id: 'amb',
      labelKey: 'resource_form_variant_amb_label',
      descriptionKey: 'resource_form_variant_amb_description'
    },
    {
      id: 'ekw',
      labelKey: 'resource_form_variant_ekw_label',
      descriptionKey: 'resource_form_variant_ekw_description'
    }
  ];
  return {
    getEnabledVariants: () => variants,
    __setVariants(/** @type {typeof variants} */ list) {
      variants = list;
    }
  };
});

import ResourceVariantPickerModal from '../educational/ResourceVariantPickerModal.svelte';
// @ts-ignore — test-only helper exported from the mock
import { __setVariants } from '$lib/config/resource-form-variants.js';

describe('ResourceVariantPickerModal', () => {
  beforeEach(() => {
    __setVariants([
      {
        id: 'amb',
        labelKey: 'resource_form_variant_amb_label',
        descriptionKey: 'resource_form_variant_amb_description'
      },
      {
        id: 'ekw',
        labelKey: 'resource_form_variant_ekw_label',
        descriptionKey: 'resource_form_variant_ekw_description'
      }
    ]);
  });

  it('renders one card per enabled variant when open', () => {
    const { container } = render(ResourceVariantPickerModal, {
      props: { open: true, onSelect: vi.fn(), onClose: vi.fn() }
    });

    const cards = container.querySelectorAll('[data-variant-id]');
    expect(cards.length).toBe(2);
    expect(cards[0].getAttribute('data-variant-id')).toBe('amb');
    expect(cards[1].getAttribute('data-variant-id')).toBe('ekw');
  });

  it('renders resolved Paraglide label + description for each card', () => {
    const { container } = render(ResourceVariantPickerModal, {
      props: { open: true, onSelect: vi.fn(), onClose: vi.fn() }
    });

    const ambCard = /** @type {HTMLElement} */ (container.querySelector('[data-variant-id="amb"]'));
    expect(ambCard.textContent).toContain('AMB-Bildungsmaterial');
    expect(ambCard.textContent).toContain('AMB-Metadatenprofil');

    const ekwCard = /** @type {HTMLElement} */ (container.querySelector('[data-variant-id="ekw"]'));
    expect(ekwCard.textContent).toContain('EKW-Bildungsmaterial');
    expect(ekwCard.textContent).toContain('EKW-Metadatenprofil');
  });

  it('invokes onSelect with the clicked variantId', async () => {
    const onSelect = vi.fn();
    const { container } = render(ResourceVariantPickerModal, {
      props: { open: true, onSelect, onClose: vi.fn() }
    });

    const ekwCard = /** @type {HTMLElement} */ (container.querySelector('[data-variant-id="ekw"]'));
    await fireEvent.click(ekwCard);
    expect(onSelect).toHaveBeenCalledWith('ekw');
  });

  it('respects the enabled list (renders only enabled variants)', () => {
    __setVariants([
      {
        id: 'amb',
        labelKey: 'resource_form_variant_amb_label',
        descriptionKey: 'resource_form_variant_amb_description'
      }
    ]);
    const { container } = render(ResourceVariantPickerModal, {
      props: { open: true, onSelect: vi.fn(), onClose: vi.fn() }
    });

    const cards = container.querySelectorAll('[data-variant-id]');
    expect(cards.length).toBe(1);
    expect(cards[0].getAttribute('data-variant-id')).toBe('amb');
  });

  it('renders nothing interactive when closed', () => {
    const { container } = render(ResourceVariantPickerModal, {
      props: { open: false, onSelect: vi.fn(), onClose: vi.fn() }
    });

    // With DaisyUI modal, the root <dialog> is present but not open.
    // We assert by checking the `open` attribute is absent.
    const dialog = /** @type {HTMLDialogElement | null} */ (container.querySelector('dialog'));
    if (dialog) {
      expect(dialog.open).toBe(false);
    }
  });
});
