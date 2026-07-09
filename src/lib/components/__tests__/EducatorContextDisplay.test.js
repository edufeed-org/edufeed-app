/**
 * EducatorContextDisplay — read-only edufeed block on the profile page:
 * Bildungsbereich + subject badges (localized concept labels) and interest
 * chips. Renders nothing when the edufeed object is empty.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import { BILDUNGSBEREICH_NAMESPACE_IRI } from '../../helpers/educational/bildungsbereichNamespace.js';

vi.mock('$lib/paraglide/runtime.js', () => ({
  getLocale: () => 'de'
}));

vi.mock('$lib/paraglide/messages', () => ({
  profile_display_levels_label: () => 'Bildungsbereich',
  educator_context_subjects_label: () => 'Fächer',
  educator_context_interests_label: () => 'Interessen'
}));

import EducatorContextDisplay from '../shared/EducatorContextDisplay.svelte';

const EMPTY = { interests: [], educationalLevels: [], subjects: [] };

beforeEach(() => cleanup());

describe('EducatorContextDisplay', () => {
  it('renders labeled level and subject badges and interest chips', () => {
    const { container } = render(EducatorContextDisplay, {
      props: {
        value: {
          interests: ['Klettern', 'Podcasts'],
          educationalLevels: [
            {
              id: `${BILDUNGSBEREICH_NAMESPACE_IRI}schule`,
              prefLabel: { de: 'Schule', en: 'School' }
            }
          ],
          subjects: [
            {
              id: 'https://w3id.org/kim/schulfaecher/s1017',
              prefLabel: { de: 'Mathematik', en: 'Mathematics' },
              vocab: 'schulfaecher'
            }
          ]
        }
      }
    });

    const text = container.textContent || '';
    expect(text).toContain('Bildungsbereich');
    expect(text).toContain('Schule');
    expect(text).toContain('Fächer');
    expect(text).toContain('Mathematik');
    expect(text).toContain('Interessen');
    expect(text).toContain('Klettern');
    expect(text).toContain('Podcasts');
    // German labels, not English
    expect(text).not.toContain('School');
    expect(text).not.toContain('Mathematics');
  });

  it('renders nothing when the edufeed object is empty', () => {
    const { container } = render(EducatorContextDisplay, { props: { value: EMPTY } });
    expect((container.textContent || '').trim()).toBe('');
  });

  it('dedupes identical display labels across vocabs instead of crashing', () => {
    // Real-world crash: "Latein" exists in both schulfaecher and
    // hochschulfaechersystematik — same de label, different concept ids.
    const { container } = render(EducatorContextDisplay, {
      props: {
        value: {
          interests: ['Podcasts', 'Podcasts'],
          educationalLevels: [],
          subjects: [
            {
              id: 'http://w3id.org/kim/schulfaecher/s1016',
              prefLabel: { de: 'Latein' },
              vocab: 'schulfaecher'
            },
            {
              id: 'https://w3id.org/kim/hochschulfaechersystematik/n095',
              prefLabel: { de: 'Latein', en: 'Latin' },
              vocab: 'hochschulfaecher'
            }
          ]
        }
      }
    });

    const badges = [...container.querySelectorAll('.badge')].map((b) => b.textContent);
    expect(badges.filter((t) => t === 'Latein')).toHaveLength(1);
    expect(badges.filter((t) => t === 'Podcasts')).toHaveLength(1);
  });

  it('falls back to the concept id when a concept has no label', () => {
    const { container } = render(EducatorContextDisplay, {
      props: {
        value: { ...EMPTY, subjects: [{ id: 'https://example.org/x' }] }
      }
    });
    expect(container.textContent).toContain('https://example.org/x');
  });
});
