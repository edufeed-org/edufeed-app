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

const { render, cleanup } = await import('@testing-library/svelte');
const { default: FieldsRenderer } = await import('$lib/components/forms/FieldsRenderer.svelte');

afterEach(() => cleanup());

describe('FieldsRenderer per-field description', () => {
  it('renders the description text between label and input', () => {
    const { getByText } = render(FieldsRenderer, {
      fields: [
        {
          id: 'q2',
          type: 'textarea',
          label: 'Welche Beobachtungen haben Sie gemacht?',
          options: { description: 'Gab es Aussagen, Reaktionen oder Situationen…' }
        }
      ],
      values: { q2: '' },
      errors: {},
      onchange: () => {}
    });
    expect(getByText('Gab es Aussagen, Reaktionen oder Situationen…')).toBeTruthy();
  });

  it('renders authored line breaks (bullet lists) rather than collapsing them', () => {
    const bullets = '• Was hat sich verändert?\n• Was ist geblieben?';
    const { getByText } = render(FieldsRenderer, {
      fields: [
        { id: 'q9', type: 'textarea', label: 'Reflexion', options: { description: bullets } }
      ],
      values: { q9: '' },
      errors: {},
      onchange: () => {}
    });
    const el = getByText((/** @type {string} */ t) => t.includes('Was hat sich verändert?'));
    // whitespace-pre-line is what turns the \n into a rendered break; asserting
    // the class pins the mechanism, since jsdom does not compute layout.
    expect(el.className).toContain('whitespace-pre-line');
  });

  it('control: no description, no description element', () => {
    const { container } = render(FieldsRenderer, {
      fields: [{ id: 'q1', type: 'text', label: 'Name', options: {} }],
      values: { q1: '' },
      errors: {},
      onchange: () => {}
    });
    expect(container.querySelector('[data-testid="field-description"]')).toBeNull();
  });
});
