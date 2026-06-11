/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import FieldsRenderer from '../FieldsRenderer.svelte';

vi.mock('../FormConceptPicker.svelte', () => ({
  default: vi.fn()
}));

const vocabField = {
  id: 'konfiZeitstruktur',
  type: 'vocab',
  label: 'Zeitstruktur',
  vocab: { address: '30142:abc:zs', relay: 'wss://x' },
  options: {
    multiple: true,
    allowCustom: true,
    customLabel: 'Eigene Zeitangabe',
    customButtonLabel: '+ eigene Angabe',
    customPlaceholder: 'z. B. monatlich'
  }
};

describe('FieldsRenderer — allowCustom', () => {
  it('renders the "+ eigene Angabe" button under a vocab field with allowCustom', () => {
    render(FieldsRenderer, {
      fields: [vocabField],
      values: { konfiZeitstruktur: [] },
      errors: {},
      customValues: { konfiZeitstruktur: '' },
      onchange: () => {},
      oncustomchange: () => {}
    });
    expect(screen.getByRole('button', { name: '+ eigene Angabe' })).toBeInTheDocument();
  });

  it('calls oncustomchange(fieldId, value) when the input value changes', async () => {
    const oncustomchange = vi.fn();
    render(FieldsRenderer, {
      fields: [vocabField],
      values: { konfiZeitstruktur: [] },
      errors: {},
      customValues: { konfiZeitstruktur: 'monatlich' },
      onchange: () => {},
      oncustomchange
    });
    const input = screen.getByRole('textbox');
    await fireEvent.input(input, { target: { value: 'wöchentlich' } });
    expect(oncustomchange).toHaveBeenCalledWith('konfiZeitstruktur', 'wöchentlich');
  });

  it('does not render any custom UI for vocab fields without allowCustom', () => {
    const plainVocabField = {
      ...vocabField,
      id: 'konfiLernformat',
      label: 'Lernformat',
      options: { multiple: true }
    };
    render(FieldsRenderer, {
      fields: [plainVocabField],
      values: { konfiLernformat: [] },
      errors: {},
      customValues: {},
      onchange: () => {},
      oncustomchange: () => {}
    });
    expect(screen.queryByRole('button', { name: /eigene angabe/i })).not.toBeInTheDocument();
  });

  it('works without customValues / oncustomchange props (back-compat)', () => {
    const plainVocabField = {
      ...vocabField,
      id: 'konfiLernformat',
      label: 'Lernformat',
      options: { multiple: true }
    };
    render(FieldsRenderer, {
      fields: [plainVocabField],
      values: { konfiLernformat: [] },
      errors: {},
      onchange: () => {}
    });
    expect(screen.getByText('Lernformat')).toBeInTheDocument();
  });
});
