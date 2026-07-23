import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/svelte';
import CreatorFieldAdapter from '$lib/components/forms/fields/CreatorFieldAdapter.svelte';

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
});
