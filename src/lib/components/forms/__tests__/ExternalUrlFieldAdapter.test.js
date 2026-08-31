/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import ExternalUrlFieldAdapter from '$lib/components/forms/fields/ExternalUrlFieldAdapter.svelte';
import FieldsRenderer from '$lib/components/forms/FieldsRenderer.svelte';

vi.mock('$lib/components/educational/ExternalUrlInput.svelte', async () => {
  return { default: (await import('./ExternalUrlInputStub.svelte')).default };
});

describe('ExternalUrlFieldAdapter', () => {
  it('emits string[] via onchange when the inner input changes', async () => {
    const onchange = vi.fn();
    render(ExternalUrlFieldAdapter, {
      field: { id: 'refs', label: 'References', options: {} },
      value: [],
      error: null,
      readonly: false,
      onchange
    });
    await fireEvent.click(screen.getByTestId('external-url-stub-add'));
    expect(onchange).toHaveBeenCalledWith(['https://a.example']);
  });

  it('does not fire onchange on mount when seeded with the string default', () => {
    // FormRenderer seeds non-vocab fields with `field.defaultValue || ''` — the
    // adapter must NOT convert that ''→[] via onchange without a user action.
    const onchange = vi.fn();
    render(ExternalUrlFieldAdapter, {
      field: { id: 'refs', label: 'References', options: {} },
      value: '',
      error: null,
      readonly: false,
      onchange
    });
    expect(onchange).not.toHaveBeenCalled();
  });

  it('renders label and error exactly once through FieldsRenderer (no duplication)', () => {
    const field = {
      id: 'refs',
      type: 'external-urls',
      label: 'References',
      options: {}
    };
    render(FieldsRenderer, {
      fields: [field],
      values: { refs: [] },
      errors: { refs: 'Required' },
      onchange: vi.fn()
    });
    // FieldsRenderer renders the label + error generically; the adapter must not
    // render its own label or error block.
    expect(screen.getAllByText('References')).toHaveLength(1);
    expect(screen.getAllByText('Required')).toHaveLength(1);
  });

  it('renders a static read-only list (no add control) when readonly', () => {
    const field = { id: 'refs', type: 'external-urls', label: 'References', options: {} };
    render(FieldsRenderer, {
      fields: [field],
      values: { refs: ['https://a.example'] },
      errors: {},
      onchange: vi.fn(),
      readonly: true
    });
    expect(screen.getByText('https://a.example')).toBeTruthy();
    // The interactive ExternalUrlInput (stub) must not render in read-only mode.
    expect(screen.queryByTestId('external-url-stub')).toBeNull();
  });
});
