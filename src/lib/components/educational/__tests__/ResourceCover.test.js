/**
 * ResourceCover component tests.
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/svelte';

// Stub the license-hook before importing the component so the module-level
// $effect doesn't try to spin up a real applesauce loader during tests.
vi.mock('$lib/stores/image-license.svelte.js', () => ({
  useLicenseForHash: () => () => null
}));

// Stub the SKOS cache — concept-side label resolution isn't under test here.
vi.mock('$lib/stores/skos-cache.svelte.js', () => ({
  getCachedConcepts: () => ({}),
  ensureVocabularyLoaded: () => {}
}));

// Stub runtime so paraglide locale lookups don't blow up in jsdom.
vi.mock('$lib/paraglide/runtime.js', () => ({
  getLocale: () => 'en'
}));

import ResourceCover from '../ResourceCover.svelte';

/**
 * Build a minimal AMB resource shape that matches what AMBResourceCard
 * passes through today. Only fields read by ResourceCover are populated.
 *
 * @param {Partial<{
 *   image: string | null,
 *   name: string,
 *   identifier: string,
 *   tags: string[][]
 * }>} overrides
 */
function buildResource(overrides = {}) {
  return {
    image: 'https://example.com/cover.jpg',
    name: 'Morgen bestimme ich',
    identifier: 'sample-d-tag',
    tags: [
      ['d', 'sample-d-tag'],
      ['name', 'Morgen bestimme ich'],
      ['learningResourceType:id', 'https://w3id.org/kim/hcrt/lesson_plan'],
      ['learningResourceType:prefLabel:en', 'Lesson plan'],
      ['educationalLevel:id', 'https://w3id.org/kim/educationalLevel/level_3'],
      ['educationalLevel:prefLabel:en', '8–10 years']
    ],
    ...overrides
  };
}

describe('ResourceCover — image branch', () => {
  it('renders ImageWithFallback when resource.image is present', () => {
    const { container } = render(ResourceCover, {
      props: { resource: buildResource(), size: 'full', aspect: 'wide' }
    });
    expect(container.querySelector('img')).not.toBeNull();
    expect(container.querySelector('[data-testid="typo-cover-card"]')).toBeNull();
  });

  it('applies the caller-specified aspect ratio class to the image container', () => {
    const samples = /** @type {const} */ ([
      ['square', /aspect-square/],
      ['video', /aspect-video/],
      ['wide', /aspect-\[2\/1\]/],
      ['portrait', /aspect-\[3\/4\]/]
    ]);
    for (const [aspect, pattern] of samples) {
      const { container } = render(ResourceCover, {
        props: { resource: buildResource(), size: 'full', aspect }
      });
      const wrapper = container.querySelector('[data-testid="resource-cover-image"]');
      expect(wrapper).not.toBeNull();
      expect(wrapper?.className).toMatch(pattern);
    }
  });

  it('aspect="auto" does not force an aspect class on the image container', () => {
    const { container } = render(ResourceCover, {
      props: { resource: buildResource(), size: 'full', aspect: 'auto' }
    });
    const wrapper = container.querySelector('[data-testid="resource-cover-image"]');
    expect(wrapper?.className ?? '').not.toMatch(/aspect-/);
  });
});

describe('ResourceCover — typo branch', () => {
  it('renders TypoCover when resource.image is missing/null', () => {
    const { container, queryByTestId } = render(ResourceCover, {
      props: {
        resource: buildResource({ image: null }),
        size: 'full',
        aspect: 'wide'
      }
    });
    expect(container.querySelector('img')).toBeNull();
    expect(queryByTestId('typo-cover-card')).not.toBeNull();
  });

  it('derives the content-type pill from learningResourceType (uppercased)', () => {
    const { getByTestId } = render(ResourceCover, {
      props: {
        resource: buildResource({ image: null }),
        size: 'full',
        aspect: 'wide'
      }
    });
    expect(getByTestId('typo-cover-pill').textContent).toContain('LESSON PLAN');
  });

  it('derives metaLabel from educationalLevel (uppercased)', () => {
    const { getByTestId } = render(ResourceCover, {
      props: {
        resource: buildResource({ image: null }),
        size: 'full',
        aspect: 'wide'
      }
    });
    expect(getByTestId('typo-cover-meta').textContent).toContain('8–10 YEARS');
  });

  it('falls back to audience when educationalLevel is absent', () => {
    const tags = [
      ['d', 'r1'],
      ['learningResourceType:id', 'https://w3id.org/kim/hcrt/worksheet'],
      ['learningResourceType:prefLabel:en', 'Worksheet'],
      ['audience:id', 'https://example.org/audience/teachers'],
      ['audience:prefLabel:en', 'Lehrkräfte']
    ];
    const { getByTestId } = render(ResourceCover, {
      props: {
        resource: buildResource({ image: null, tags, identifier: 'r1' }),
        size: 'full',
        aspect: 'wide'
      }
    });
    expect(getByTestId('typo-cover-meta').textContent).toContain('LEHRKRÄFTE');
  });

  it('omits metaLabel when neither educationalLevel nor audience is present', () => {
    const tags = [
      ['d', 'r2'],
      ['learningResourceType:id', 'https://w3id.org/kim/hcrt/worksheet'],
      ['learningResourceType:prefLabel:en', 'Worksheet']
    ];
    const { container } = render(ResourceCover, {
      props: {
        resource: buildResource({ image: null, tags, identifier: 'r2' }),
        size: 'full',
        aspect: 'wide'
      }
    });
    expect(container.querySelector('[data-testid="typo-cover-meta"]')).toBeNull();
  });
});

describe('ResourceCover — class prop', () => {
  it('forwards class to the outer container', () => {
    const { container } = render(ResourceCover, {
      props: {
        resource: buildResource(),
        size: 'full',
        aspect: 'wide',
        class: 'mb-3 ring-2'
      }
    });
    const root = container.firstElementChild;
    expect(root?.className).toMatch(/mb-3/);
    expect(root?.className).toMatch(/ring-2/);
  });
});
