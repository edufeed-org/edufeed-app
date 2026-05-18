/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach } from 'vitest';

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

vi.mock('$lib/paraglide/messages', () => ({}));

// FormConceptPicker pulls in nostr/applesauce machinery — stub it.
vi.mock('$lib/components/forms/FormConceptPicker.svelte', () => ({
  default: () => null
}));

const { render, fireEvent, cleanup } = await import('@testing-library/svelte');
const { default: FieldsRenderer } = await import('$lib/components/forms/FieldsRenderer.svelte');

afterEach(() => cleanup());

describe('FieldsRenderer', () => {
  it('renders a text input and emits onchange on input', async () => {
    const onchange = vi.fn();
    const { getByPlaceholderText } = render(FieldsRenderer, {
      fields: [
        { id: 'subtitle', type: 'text', label: 'Subtitle', options: { placeholder: 'Enter…' } }
      ],
      values: { subtitle: '' },
      errors: {},
      onchange
    });
    const input = getByPlaceholderText('Enter…');
    await fireEvent.input(input, { target: { value: 'hi' } });
    expect(onchange).toHaveBeenCalledWith('subtitle', 'hi');
  });

  it('renders a textarea and emits onchange', async () => {
    const onchange = vi.fn();
    const { container } = render(FieldsRenderer, {
      fields: [{ id: 'notes', type: 'textarea', label: 'Notes', options: {} }],
      values: { notes: '' },
      errors: {},
      onchange
    });
    const ta = /** @type HTMLTextAreaElement */ (container.querySelector('textarea'));
    await fireEvent.input(ta, { target: { value: 'multi\nline' } });
    expect(onchange).toHaveBeenCalledWith('notes', 'multi\nline');
  });

  it('renders a checkbox and emits boolean onchange', async () => {
    const onchange = vi.fn();
    const { container } = render(FieldsRenderer, {
      fields: [{ id: 'plain', type: 'checkbox', label: 'Plain', options: {} }],
      values: { plain: false },
      errors: {},
      onchange
    });
    const cb = /** @type HTMLInputElement */ (container.querySelector('input[type="checkbox"]'));
    await fireEvent.click(cb);
    expect(onchange).toHaveBeenCalledWith('plain', true);
  });

  it('renders the error message under a field when present', () => {
    const { getByText } = render(FieldsRenderer, {
      fields: [{ id: 'x', type: 'text', label: 'X', options: { required: true } }],
      values: { x: '' },
      errors: { x: 'X is required' },
      onchange: vi.fn()
    });
    expect(getByText('X is required')).toBeTruthy();
  });

  it('renders a required indicator when options.required', () => {
    const { getByText } = render(FieldsRenderer, {
      fields: [{ id: 'x', type: 'text', label: 'My Label', options: { required: true } }],
      values: { x: '' },
      errors: {},
      onchange: vi.fn()
    });
    expect(getByText('My Label')).toBeTruthy();
    expect(getByText('*')).toBeTruthy();
  });
});
