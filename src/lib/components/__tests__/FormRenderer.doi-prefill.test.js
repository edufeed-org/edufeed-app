/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';

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
vi.mock('$lib/components/forms/FormConceptPicker.svelte', () => ({ default: () => null }));

const fetchDoiPrefill = vi.fn();
vi.mock('$lib/helpers/publication/crossref.js', () => ({
  fetchDoiPrefill: (/** @type {any[]} */ ...args) => fetchDoiPrefill(...args)
}));

const { render, screen, fireEvent, waitFor } = await import('@testing-library/svelte');
const { default: FormRenderer } = await import('$lib/components/forms/FormRenderer.svelte');
const { buildFormTemplateTags } = await import('$lib/helpers/forms.js');

// A slice of the EKKW form: the doi field and the siblings Crossref can fill.
function templateEvent() {
  const fields = [
    { id: 'doi', type: 'doi', label: 'DOI', output: 'amb:id', options: {} },
    { id: 'titel', type: 'text', label: 'Titel', output: 'amb:name', options: {} },
    { id: 'band', type: 'text', label: 'Band', output: 'ext', options: {} },
    { id: 'autoren', type: 'creator', label: 'Autoren', output: 'amb:creator', options: {} }
  ];
  return {
    id: 'evt-doi',
    sig: '',
    kind: 30168,
    pubkey: 'pk',
    content: '',
    created_at: 0,
    tags: buildFormTemplateTags('ekkw-slice', fields, { name: 'EKKW slice' })
  };
}

describe('FormRenderer + doi field', () => {
  it('fills empty sibling fields from the DOI lookup and reports their labels', async () => {
    fetchDoiPrefill.mockResolvedValue({
      title: 'Ein Beitrag',
      volume: '12',
      creators: [{ name: 'Anna Beispiel', type: 'Person' }]
    });
    render(FormRenderer, { props: { formEvent: templateEvent() } });
    const doiInput = /** @type {HTMLInputElement} */ (screen.getByLabelText('DOI'));
    await fireEvent.input(doiInput, { target: { value: '10.1000/abc' } });

    await waitFor(
      () =>
        expect(/** @type {HTMLInputElement} */ (screen.getByLabelText('Titel')).value).toBe(
          'Ein Beitrag'
        ),
      { timeout: 2000 }
    );
    expect(/** @type {HTMLInputElement} */ (screen.getByLabelText('Band')).value).toBe('12');
    expect(screen.getByTestId('doi-prefill-status').textContent).toMatch(/Titel, Band, Autoren/);
  });

  it('keeps what the respondent already typed', async () => {
    fetchDoiPrefill.mockResolvedValue({ title: 'Ein Beitrag', volume: '12' });
    render(FormRenderer, { props: { formEvent: templateEvent() } });
    await fireEvent.input(screen.getByLabelText('Titel'), { target: { value: 'Mein Titel' } });
    await fireEvent.input(screen.getByLabelText('DOI'), { target: { value: '10.1000/abc' } });

    await waitFor(
      () =>
        expect(/** @type {HTMLInputElement} */ (screen.getByLabelText('Band')).value).toBe('12'),
      { timeout: 2000 }
    );
    expect(/** @type {HTMLInputElement} */ (screen.getByLabelText('Titel')).value).toBe(
      'Mein Titel'
    );
    expect(screen.getByTestId('doi-prefill-status').textContent).not.toMatch(/Titel/);
  });
});
