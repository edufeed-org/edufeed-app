/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import * as m from '$lib/paraglide/messages';
import TermiSearchHits from '$lib/components/assistant/TermiSearchHits.svelte';

/** @param {number} i */
const hit = (i) => ({
  title: `Treffer ${i}`,
  description: `Beschreibung ${i}`,
  license: 'CC BY 4.0',
  creator: 'Ada',
  publisher: 'OERinfo',
  url: `https://example.org/r/${i}`,
  sourcePage: `https://example.org/page/${i}`
});

describe('TermiSearchHits', () => {
  it('renders at most five cards with title, description, license and creator', () => {
    const view = render(TermiSearchHits, {
      props: { hits: [1, 2, 3, 4, 5, 6, 7].map(hit), query: 'Brüche' }
    });
    const cards = view.getAllByTestId('termi-hit');
    expect(cards).toHaveLength(5);
    expect(view.getByText('Treffer 1')).toBeTruthy();
    expect(view.queryByText('Treffer 6')).toBeNull();
    expect(cards[0].textContent).toContain('Beschreibung 1');
    expect(cards[0].textContent).toContain('CC BY 4.0');
    expect(cards[0].textContent).toContain('Ada');
  });

  it('links to sourcePage, falls back to url, opens in a new tab', () => {
    const view = render(TermiSearchHits, {
      props: { hits: [hit(1), { ...hit(2), sourcePage: undefined }], query: 'x' }
    });
    const [a, b] = view.getAllByTestId('termi-hit');
    expect(a.getAttribute('href')).toBe('https://example.org/page/1');
    expect(b.getAttribute('href')).toBe('https://example.org/r/2');
    expect(a.getAttribute('target')).toBe('_blank');
    expect(a.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('drops non-http links', () => {
    const view = render(TermiSearchHits, {
      props: {
        hits: [{ title: 'Böse', url: 'javascript:alert(1)', sourcePage: 'data:text/html,x' }],
        query: 'x'
      }
    });
    expect(view.getByTestId('termi-hit').getAttribute('href')).toBeNull();
  });

  it('"Alle anzeigen" opens the learning search with the query', () => {
    const view = render(TermiSearchHits, { props: { hits: [hit(1)], query: 'Brüche Klasse 6' } });
    const all = view.getByText(m.termi_search_all());
    expect(all.getAttribute('href')).toBe(
      '/discover?type=learning&search=Br%C3%BCche%20Klasse%206'
    );
  });
});
