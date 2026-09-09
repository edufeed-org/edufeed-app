/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// The adapter's only network dependency. Mocked so the test drives the
// adapter, not Crossref; the fetch wrapper itself is covered in
// publication/crossref.test.js.
const fetchDoiPrefill = vi.fn();
vi.mock('$lib/helpers/publication/crossref.js', () => ({
  fetchDoiPrefill: (/** @type {any[]} */ ...args) => fetchDoiPrefill(...args)
}));

const { render, screen, fireEvent, waitFor } = await import('@testing-library/svelte');
const { default: DoiFieldAdapter } = await import(
  '$lib/components/forms/fields/DoiFieldAdapter.svelte'
);

const field = { id: 'doi', type: 'doi', label: 'DOI', output: 'amb:id', options: {} };

beforeEach(() => {
  fetchDoiPrefill.mockReset();
  vi.useRealTimers();
});

describe('DoiFieldAdapter', () => {
  it('stores the canonical doi.org URL once the input is a valid DOI', async () => {
    const onchange = vi.fn();
    fetchDoiPrefill.mockResolvedValue({});
    render(DoiFieldAdapter, { props: { field, value: '', onchange } });
    const input = screen.getByRole('textbox');
    await fireEvent.input(input, { target: { value: 'doi:10.1000/ABC.123' } });
    expect(onchange).toHaveBeenLastCalledWith('https://doi.org/10.1000/ABC.123');
  });

  it('passes an incomplete DOI through unchanged and flags it, without fetching', async () => {
    const onchange = vi.fn();
    render(DoiFieldAdapter, { props: { field, value: '', onchange, onprefill: vi.fn() } });
    await fireEvent.input(screen.getByRole('textbox'), { target: { value: '10.10' } });
    expect(onchange).toHaveBeenLastCalledWith('10.10');
    expect(screen.getByRole('textbox').getAttribute('aria-invalid')).toBe('true');
    await new Promise((r) => setTimeout(r, 700));
    expect(fetchDoiPrefill).not.toHaveBeenCalled();
  });

  it('fetches the valid DOI once, debounced, and hands the metadata to onprefill', async () => {
    vi.useFakeTimers();
    const onprefill = vi.fn().mockReturnValue(['titel', 'autoren']);
    fetchDoiPrefill.mockResolvedValue({ title: 'T', creators: [{ name: 'A', type: 'Person' }] });
    render(DoiFieldAdapter, { props: { field, value: '', onchange: () => {}, onprefill } });
    const input = screen.getByRole('textbox');
    await fireEvent.input(input, { target: { value: '10.1000/x' } });
    await fireEvent.input(input, { target: { value: '10.1000/xy' } });
    expect(fetchDoiPrefill).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(600);
    expect(fetchDoiPrefill).toHaveBeenCalledTimes(1);
    expect(fetchDoiPrefill).toHaveBeenCalledWith('10.1000/xy');
    await vi.runAllTimersAsync();
    expect(onprefill).toHaveBeenCalledWith({
      title: 'T',
      creators: [{ name: 'A', type: 'Person' }]
    });
  });

  it('tells the respondent which fields were filled, by label', async () => {
    fetchDoiPrefill.mockResolvedValue({ title: 'T' });
    const onprefill = vi.fn().mockReturnValue(['Titel', 'Autoren']);
    render(DoiFieldAdapter, { props: { field, value: '', onchange: () => {}, onprefill } });
    await fireEvent.input(screen.getByRole('textbox'), { target: { value: '10.1000/x' } });
    await waitFor(
      () => expect(screen.getByTestId('doi-prefill-status').textContent).toMatch(/Titel, Autoren/),
      {
        timeout: 2000
      }
    );
  });

  it('stays quiet when Crossref has nothing for the DOI', async () => {
    fetchDoiPrefill.mockResolvedValue({});
    const onprefill = vi.fn();
    render(DoiFieldAdapter, { props: { field, value: '', onchange: () => {}, onprefill } });
    await fireEvent.input(screen.getByRole('textbox'), { target: { value: '10.1000/x' } });
    await waitFor(() => expect(fetchDoiPrefill).toHaveBeenCalled(), { timeout: 2000 });
    await new Promise((r) => setTimeout(r, 50));
    expect(onprefill).not.toHaveBeenCalled();
    expect(screen.queryByTestId('doi-prefill-status')).toBeNull();
  });

  it('renders the stored value read-only as a link', () => {
    render(DoiFieldAdapter, {
      props: { field, value: 'https://doi.org/10.1000/x', readonly: true, onchange: () => {} }
    });
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getByRole('link').getAttribute('href')).toBe('https://doi.org/10.1000/x');
  });
});
