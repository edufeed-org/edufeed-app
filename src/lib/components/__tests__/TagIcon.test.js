/**
 * TagIcon accepts both prop spellings.
 *
 * It is the only icon that historically took a bare `class`; the rest of the
 * set (and MetadataCardGrid, which uses TagIcon as its neutral fallback) pass
 * `class_`. Both call-site styles exist in the tree, so both must size the svg.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import TagIcon from '../icons/ui/TagIcon.svelte';

describe('TagIcon', () => {
  it('sizes the svg from class_ (project convention)', () => {
    const { container } = render(TagIcon, { props: { class_: 'w-7 h-7' } });
    expect(container.querySelector('svg')?.getAttribute('class')).toBe('w-7 h-7');
  });

  it('sizes the svg from a bare class (legacy call sites)', () => {
    const { container } = render(TagIcon, {
      props: { class: 'h-4 w-4 text-base-content/70' }
    });
    expect(container.querySelector('svg')?.getAttribute('class')).toBe(
      'h-4 w-4 text-base-content/70'
    );
  });

  it('falls back to a default size when neither is given', () => {
    const { container } = render(TagIcon, { props: {} });
    expect(container.querySelector('svg')?.getAttribute('class')).toBe('w-5 h-5');
  });
});
