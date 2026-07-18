/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';

// Stub matchMedia before any imports that pull in app-settings.svelte.js
// (FieldsRenderer → FormConceptPicker → relay-helper → app-settings).
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

// FormConceptPicker pulls in nostr/applesauce machinery — stub it (unused by
// this fixture, which has no vocab-bound fields).
vi.mock('$lib/components/forms/FormConceptPicker.svelte', () => ({
  default: () => null
}));

const { render, screen, fireEvent } = await import('@testing-library/svelte');
const { default: FormRenderer } = await import('$lib/components/forms/FormRenderer.svelte');
const { buildFormTemplateTags } = await import('$lib/helpers/forms.js');

function templateEvent() {
  const fields = [
    {
      id: 'bereich',
      type: 'radio',
      label: 'Bereich?',
      options: {
        required: true,
        options: [
          { id: 'schule', label: 'Schule', nextSection: 'sec-schule' },
          { id: 'konfi', label: 'Konfi', nextSection: 'sec-konfi' }
        ]
      }
    },
    { id: 'schulfach', type: 'text', label: 'Schulfach', options: {} },
    { id: 'zielgruppe', type: 'text', label: 'Zielgruppe', options: {} }
  ];
  const sections = [
    { id: 'start', title: 'Start', questionIds: ['bereich'] },
    { id: 'sec-schule', title: 'Schule', questionIds: ['schulfach'] },
    { id: 'sec-konfi', title: 'Konfi', questionIds: ['zielgruppe'] }
  ];
  return {
    id: 'evt-wiz',
    sig: '',
    kind: 30168,
    pubkey: 'pk',
    content: '',
    created_at: 0,
    tags: buildFormTemplateTags('wiz', fields, { name: 'Wizard', sections })
  };
}

describe('FormRenderer sections mode', () => {
  it('shows one section at a time and routes by the chosen option', async () => {
    render(FormRenderer, { formEvent: templateEvent(), onsubmit: vi.fn() });
    expect(screen.getByText('Start')).toBeTruthy();
    expect(screen.queryByLabelText('Schulfach')).toBeNull();

    await fireEvent.click(screen.getByDisplayValue('konfi'));
    await fireEvent.click(screen.getByRole('button', { name: /weiter|next/i }));
    expect(screen.getByText('Konfi')).toBeTruthy();
    expect(screen.queryByText('Schule', { selector: 'h3' })).toBeNull();
  });

  it('blocks Next on invalid required fields in the current section', async () => {
    render(FormRenderer, { formEvent: templateEvent(), onsubmit: vi.fn() });
    await fireEvent.click(screen.getByRole('button', { name: /weiter|next/i }));
    // still on section 1, error shown
    expect(screen.getByText('Start')).toBeTruthy();
    expect(screen.getByText(/required/i)).toBeTruthy();
  });

  it('submits from the last reached section and Back returns along history', async () => {
    const onsubmit = vi.fn();
    render(FormRenderer, { formEvent: templateEvent(), onsubmit });
    await fireEvent.click(screen.getByDisplayValue('schule'));
    await fireEvent.click(screen.getByRole('button', { name: /weiter|next/i }));
    await fireEvent.click(screen.getByRole('button', { name: /zurück|back/i }));
    expect(screen.getByText('Start')).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: /weiter|next/i }));
    // sec-schule routes linearly to sec-konfi; sec-konfi is last → Submit visible
    await fireEvent.click(screen.getByRole('button', { name: /weiter|next/i }));
    await fireEvent.click(screen.getByRole('button', { name: /submit/i }));
    expect(onsubmit).toHaveBeenCalledWith(expect.objectContaining({ bereich: 'schule' }));
  });
});
