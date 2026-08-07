/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import RelationFieldAdapter from '$lib/components/forms/fields/RelationFieldAdapter.svelte';
import RelationAdapterHost from './RelationAdapterHost.svelte';
import FieldsRenderer from '$lib/components/forms/FieldsRenderer.svelte';

vi.mock('$lib/components/educational/AMBResourceSearchInput.svelte', async () => {
  return { default: (await import('./RelationAdapterStub.svelte')).default };
});

describe('RelationFieldAdapter', () => {
  it('appends a picked ref and emits the coordinate list', async () => {
    const onchange = vi.fn();
    // Stateful host so the parent's updated value flows back and the chip renders.
    render(RelationAdapterHost, { initial: '', onchange });
    await fireEvent.click(screen.getByTestId('relation-stub-pick'));
    expect(onchange).toHaveBeenCalledWith([{ coordinate: '30142:abc:res1', relayHint: 'wss://r' }]);
    expect(screen.getByText(/30142:abc:res1/)).toBeTruthy();
  });

  it('does not fire onchange on mount when seeded with the string default', async () => {
    // FormRenderer seeds non-vocab fields with `field.defaultValue || ''` — the
    // adapter must NOT convert that ''→[] via onchange without a user action.
    const onchange = vi.fn();
    render(RelationFieldAdapter, {
      field: { id: 'parts', label: 'Parts', output: 'amb:hasPart', options: {} },
      value: '',
      error: null,
      readonly: false,
      onchange
    });
    expect(onchange).not.toHaveBeenCalled();
    // A real pick still emits the coordinate list.
    await fireEvent.click(screen.getByTestId('relation-stub-pick'));
    expect(onchange).toHaveBeenCalledWith([{ coordinate: '30142:abc:res1', relayHint: 'wss://r' }]);
  });

  it('renders label and error exactly once through FieldsRenderer (no duplication)', () => {
    const field = {
      id: 'parts',
      type: 'amb-relation',
      label: 'Parts',
      output: 'amb:hasPart',
      options: {}
    };
    render(FieldsRenderer, {
      fields: [field],
      values: { parts: [] },
      errors: { parts: 'Required' },
      onchange: vi.fn()
    });
    // FieldsRenderer renders the label + error generically; the adapter must not
    // render its own label or error block (Task-2 double-render regression check).
    expect(screen.getAllByText('Parts')).toHaveLength(1);
    expect(screen.getAllByText('Required')).toHaveLength(1);
  });
});
