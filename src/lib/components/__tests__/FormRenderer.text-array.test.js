/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';

// Stub matchMedia before any imports that pull in app-settings.svelte.js
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn()
  }))
});

vi.mock('$lib/paraglide/runtime.js', () => ({
  getLocale: () => 'de'
}));

vi.mock('$lib/paraglide/messages', () => ({
  form_select_placeholder: () => '— Select —',
  form_min_characters: (/** @type {{ min: number }} */ { min }) => `Min ${min}`,
  form_encrypted_info: () => 'encrypted'
}));

// FormConceptPicker pulls in nostr/applesauce machinery — stub it.
vi.mock('$lib/components/forms/FormConceptPicker.svelte', () => ({
  default: () => null
}));

const { render, fireEvent } = await import('@testing-library/svelte');
const { default: FormRenderer } = await import('$lib/components/forms/FormRenderer.svelte');

/** Build a synthetic kind-30168 form template with one text-array field. */
function makeFormEvent() {
  return {
    id: 'evt1',
    pubkey: '0'.repeat(64),
    kind: 30168,
    created_at: 0,
    sig: '',
    content: '',
    tags: [
      ['d', 'test-form'],
      ['name', 'Test'],
      ['field', 'refs', 'text-array', 'Refs', '', JSON.stringify({ required: false })]
    ]
  };
}

describe('FormRenderer text-array field', () => {
  it('renders one empty text input by default and supports add', async () => {
    const { container, getByText } = render(FormRenderer, {
      props: { formEvent: makeFormEvent() }
    });

    let inputs = container.querySelectorAll('input[type="text"]');
    expect(inputs.length).toBe(1);

    await fireEvent.click(getByText('+ Hinzufügen'));
    inputs = container.querySelectorAll('input[type="text"]');
    expect(inputs.length).toBe(2);
  });

  it('submits a string[] value', async () => {
    /** @type {Record<string, any> | null} */
    let captured = null;
    const onsubmit = (/** @type {Record<string, any>} */ v) => {
      captured = v;
    };
    const { container, getByText } = render(FormRenderer, {
      props: { formEvent: makeFormEvent(), onsubmit }
    });

    await fireEvent.click(getByText('+ Hinzufügen'));
    const inputs = container.querySelectorAll('input[type="text"]');
    await fireEvent.input(inputs[0], { target: { value: 'A' } });
    await fireEvent.input(inputs[1], { target: { value: 'B' } });

    await fireEvent.click(getByText('Submit'));

    expect(captured).toEqual({ refs: ['A', 'B'] });
  });
});
