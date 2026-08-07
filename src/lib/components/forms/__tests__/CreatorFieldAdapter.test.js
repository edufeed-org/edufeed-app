/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import CreatorFieldAdapter from '$lib/components/forms/fields/CreatorFieldAdapter.svelte';
import FieldsRenderer from '$lib/components/forms/FieldsRenderer.svelte';

vi.mock('$lib/components/educational/CreatorInput.svelte', async () => {
  const Stub = (await import('./CreatorFieldAdapterStub.svelte')).default;
  return { default: Stub };
});

describe('CreatorFieldAdapter', () => {
  it('emits Creator[] via onchange when the inner input changes', async () => {
    const onchange = vi.fn();
    render(CreatorFieldAdapter, {
      field: { id: 'creators', label: 'Creators', options: {} },
      value: [],
      error: null,
      readonly: false,
      onchange
    });
    // the stub auto-fires onchange([{name:'Alice',type:'Person'}]) on mount
    expect(onchange).toHaveBeenCalledWith([{ name: 'Alice', type: 'Person' }]);
  });

  it('renders label and error exactly once through FieldsRenderer (no duplication)', () => {
    const field = { id: 'creators', type: 'creator', label: 'Creators', options: {} };
    render(FieldsRenderer, {
      fields: [field],
      values: { creators: [] },
      errors: { creators: 'Required' },
      onchange: vi.fn()
    });
    // FieldsRenderer renders the label + error generically; the adapter must not
    // pass label into CreatorInput nor render its own error block.
    expect(screen.getAllByText('Creators')).toHaveLength(1);
    expect(screen.getAllByText('Required')).toHaveLength(1);
  });

  it('renders a static read-only list (no CreatorInput / add control) when readonly', () => {
    const field = { id: 'creators', type: 'creator', label: 'Creators', options: {} };
    render(FieldsRenderer, {
      fields: [field],
      values: { creators: [{ name: 'Alice', type: 'Person' }] },
      errors: {},
      onchange: vi.fn(),
      readonly: true
    });
    expect(screen.getByText('Alice')).toBeTruthy();
    // The interactive CreatorInput (stub) must not render in read-only mode.
    expect(screen.queryByTestId('creator-stub')).toBeNull();
  });
});
