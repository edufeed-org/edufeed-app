/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import MetadataCardGrid from '../educational/MetadataCardGrid.svelte';

describe('MetadataCardGrid', () => {
  it('renders nothing when there are no cards', () => {
    const { container } = render(MetadataCardGrid, { props: { cards: [] } });
    expect(container.querySelector('.mcg-grid')).toBeNull();
  });

  it('renders a card label and plain value', () => {
    const { getByText } = render(MetadataCardGrid, {
      props: {
        cards: [
          { key: 'core:subjects', iconKey: 'book', label: 'Subjects', value: 'Ethik, Politik' }
        ]
      }
    });
    expect(getByText('Subjects')).toBeTruthy();
    expect(getByText('Ethik, Politik')).toBeTruthy();
  });

  it('renders a provenance chip on extension cards', () => {
    const { getByText } = render(MetadataCardGrid, {
      props: {
        cards: [
          {
            key: 'ekw:methodOther',
            iconKey: 'methode',
            label: 'Method',
            value: 'Bibeltheater',
            chip: 'EKKW'
          }
        ]
      }
    });
    const chip = getByText('EKKW');
    expect(chip.classList.contains('mcg-chip')).toBe(true);
  });

  it('marks wide cards so they span two columns', () => {
    const { container } = render(MetadataCardGrid, {
      props: {
        cards: [
          {
            key: 'ekw:schoolType',
            iconKey: 'schulart',
            label: 'School type',
            value: 'A, B, C',
            wide: true
          }
        ]
      }
    });
    expect(container.querySelector('.mcg-card.mcg-wide')).not.toBeNull();
  });

  it('renders scalars as stacked links when an href is present', () => {
    const { getByRole, getByText } = render(MetadataCardGrid, {
      props: {
        cards: [
          {
            key: 'ekw:bibleReference',
            iconKey: 'bibelstelle',
            label: 'Bible reference',
            scalars: [
              { text: 'Mt 5,3-12', href: 'https://www.die-bibel.de/bibel/LU17/MAT.5.3-12' },
              { text: 'Freitext-Notiz' }
            ]
          }
        ]
      }
    });
    const link = getByRole('link', { name: 'Mt 5,3-12' });
    expect(link.getAttribute('href')).toBe('https://www.die-bibel.de/bibel/LU17/MAT.5.3-12');
    // free text without href is a plain span, not a link
    expect(getByText('Freitext-Notiz').tagName).toBe('SPAN');
  });

  it('appends a muted fallback note after the value', () => {
    const { getByText } = render(MetadataCardGrid, {
      props: {
        cards: [
          {
            key: 'core:level',
            iconKey: 'graduationCap',
            label: 'Level',
            value: '5–6',
            valueMuted: '(German)'
          }
        ]
      }
    });
    const muted = getByText('(German)');
    expect(muted.classList.contains('mcg-muted')).toBe(true);
  });

  // The grid sizes every glyph via `class_="w-7 h-7"`. An icon that only reads
  // a bare `class` prop renders an unsized (invisible) svg — which is what the
  // neutral `tag` fallback used to do, so unknown facets lost their icon.
  it('sizes the icon on every card, including the neutral tag fallback', () => {
    const { container } = render(MetadataCardGrid, {
      props: {
        cards: [
          { key: 'core:type', iconKey: 'tag', label: 'Resource Type', value: 'Text, Video' },
          { key: 'ext:unknown', iconKey: 'no-such-icon', label: 'Unknown', value: 'x' },
          { key: 'core:subjects', iconKey: 'book', label: 'Subjects', value: 'Ethik' }
        ]
      }
    });

    const svgs = [...container.querySelectorAll('.mcg-ic svg')];
    expect(svgs).toHaveLength(3);
    for (const svg of svgs) {
      expect(svg.getAttribute('class')).toContain('w-7');
      expect(svg.getAttribute('class')).toContain('h-7');
    }
  });
});
