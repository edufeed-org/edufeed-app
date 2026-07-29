/**
 * ResourceCover component tests.
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';

// Stub the license-hook before importing the component so the module-level
// $effect doesn't try to spin up a real applesauce loader during tests.
// Tests that care about the overlay override `licenseState.current`.
const licenseState = {
  current: /** @type {any} */ ({ event: null, status: 'loading' })
};
vi.mock('$lib/stores/image-license.svelte.js', () => ({
  useLicenseForHash: () => () => null,
  useLicenseStatus: () => () => licenseState.current
}));

// Stub the SKOS cache — concept-side label resolution isn't under test here.
vi.mock('$lib/stores/skos-cache.svelte.js', () => ({
  getCachedConcepts: () => ({}),
  ensureVocabularyLoaded: () => {}
}));

// Pin the locale so label derivation is deterministic. The rest of the runtime
// stays real — paraglide's message functions read other exports off it, and the
// license overlay renders messages once an image branch is on screen.
vi.mock('$lib/paraglide/runtime.js', async (importOriginal) => {
  const actual = /** @type {any} */ (await importOriginal());
  return { ...actual, getLocale: () => 'en' };
});

// Stub publisher-profile lookup. Tests that want to exercise the fallback
// can override `mockedProfile` before rendering.
const profileState = { current: /** @type {any} */ (null) };
vi.mock('$lib/stores/user-profile.svelte.js', () => ({
  useUserProfile: () => () => profileState.current
}));

// Stub the batch profile lookup for `["p", pk, relay, "creator"]` creators.
// Tests seed `profileMapState.current` with pubkey → kind:0 profile entries.
const profileMapState = { current: /** @type {Map<string, any>} */ (new Map()) };
vi.mock('$lib/stores/profile-map.svelte.js', () => ({
  useProfileMap: () => () => profileMapState.current
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

describe('ResourceCover — unloadable cover image (issue #51)', () => {
  beforeEach(() => {
    licenseState.current = { event: null, status: 'loading' };
  });

  // A cover URL that cannot be fetched (dead host, 404, blocked hotlink) used
  // to leave a grey placeholder box carrying the license pill. It now falls
  // through to the same branches an absent cover uses.
  /**
   * Error out every source stage of the cover image (size="card" → proxy stage
   * then original stage). Scoped to the image branch so a PDF-thumbnail img
   * rendered afterwards isn't failed too.
   * @param {Element} container
   */
  async function failEveryStage(container) {
    let img;
    while ((img = container.querySelector('[data-testid="resource-cover-image"] img'))) {
      await fireEvent.error(img);
    }
  }

  it('falls back to TypoCover once every image stage has failed', async () => {
    const { container, queryByTestId } = render(ResourceCover, {
      props: { resource: buildResource(), size: 'full', aspect: 'wide' }
    });
    expect(queryByTestId('resource-cover-image')).not.toBeNull();

    await failEveryStage(container);

    expect(queryByTestId('resource-cover-image')).toBeNull();
    expect(queryByTestId('image-fallback-placeholder')).toBeNull();
    expect(queryByTestId('typo-cover-card')).not.toBeNull();
  });

  it('drops the license overlay with the broken image', async () => {
    licenseState.current = { event: null, status: 'missing' };
    const { container, queryByTestId } = render(ResourceCover, {
      props: { resource: buildResource(), size: 'full', aspect: 'wide' }
    });
    expect(queryByTestId('license-caution')).not.toBeNull();

    await failEveryStage(container);

    expect(queryByTestId('license-caution')).toBeNull();
  });

  it('prefers the derived PDF thumbnail over TypoCover when the gate allows it', async () => {
    const tags = [
      ['d', 'r-pdf'],
      ['license:id', 'https://creativecommons.org/licenses/by/4.0/'],
      ['encoding:contentUrl', 'https://example.com/doc.pdf'],
      ['encoding:encodingFormat', 'application/pdf']
    ];
    const { container, queryByTestId } = render(ResourceCover, {
      props: {
        resource: buildResource({ tags, identifier: 'r-pdf' }),
        size: 'full',
        aspect: 'wide'
      }
    });

    await failEveryStage(container);

    expect(queryByTestId('resource-cover-pdf-thumb')).not.toBeNull();
    expect(queryByTestId('typo-cover-card')).toBeNull();
  });

  it('retries a new cover URL after a previous one failed', async () => {
    const { container, queryByTestId, rerender } = render(ResourceCover, {
      props: { resource: buildResource(), size: 'full', aspect: 'wide' }
    });
    await failEveryStage(container);
    expect(queryByTestId('typo-cover-card')).not.toBeNull();

    await rerender({
      resource: buildResource({ image: 'https://example.com/other-cover.jpg' }),
      size: 'full',
      aspect: 'wide'
    });

    expect(queryByTestId('resource-cover-image')).not.toBeNull();
    expect(queryByTestId('typo-cover-card')).toBeNull();
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

describe('ResourceCover — credit derivation', () => {
  beforeEach(() => {
    profileState.current = null;
    profileMapState.current = new Map();
  });

  it('includes a creator p-tag profile name in the attribution', () => {
    // NIP-AMB: creators with a Nostr identity have NO creator:name run — the
    // p-tag is their sole representation, name resolved from their kind:0.
    const colibri = 'f'.repeat(64);
    profileMapState.current = new Map([[colibri, { name: 'Colibri' }]]);
    const tags = [
      ['d', 'r-ptag'],
      ['creator:name', 'Corinna Link'],
      ['p', colibri, 'wss://hint', 'creator'],
      ['learningResourceType:prefLabel:en', 'Worksheet']
    ];
    const { getByTestId } = render(ResourceCover, {
      props: {
        resource: buildResource({ image: null, tags, identifier: 'r-ptag' }),
        size: 'full',
        aspect: 'wide'
      }
    });
    expect(getByTestId('typo-cover-author').textContent).toContain('Corinna Link & Colibri');
  });

  it('dedupes a legacy dual-write creator (creator:name run + p-tag for the same person)', () => {
    // Events written before the NIP-AMB single-representation fix carry both;
    // the profile name would otherwise be counted twice ("… et al.").
    const colibri = 'f'.repeat(64);
    profileMapState.current = new Map([[colibri, { name: 'Colibri' }]]);
    const tags = [
      ['d', 'r-legacy'],
      ['creator:name', 'Corinna Link'],
      ['creator:name', 'Colibri'],
      ['p', colibri, 'wss://hint', 'creator'],
      ['learningResourceType:prefLabel:en', 'Worksheet']
    ];
    const { getByTestId } = render(ResourceCover, {
      props: {
        resource: buildResource({ image: null, tags, identifier: 'r-legacy' }),
        size: 'full',
        aspect: 'wide'
      }
    });
    expect(getByTestId('typo-cover-author').textContent).toContain('Corinna Link & Colibri');
  });

  it('attributes to the p-tag creator profile even when it is not the publisher', () => {
    const creator = 'a'.repeat(64);
    profileMapState.current = new Map([[creator, { name: 'Actual Author' }]]);
    profileState.current = { name: 'Uploader' };
    const tags = [
      ['d', 'r-ptag-only'],
      ['p', creator, 'wss://hint', 'creator'],
      ['learningResourceType:prefLabel:en', 'Worksheet']
    ];
    const { getByTestId } = render(ResourceCover, {
      props: {
        resource: {
          ...buildResource({ image: null, tags, identifier: 'r-ptag-only' }),
          pubkey: '0'.repeat(64)
        },
        size: 'full',
        aspect: 'wide'
      }
    });
    expect(getByTestId('typo-cover-author').textContent).toContain('Actual Author');
  });

  it('falls back to the publisher while p-tag creator profiles are still loading', () => {
    profileState.current = { name: 'Uploader' };
    const tags = [
      ['d', 'r-ptag-loading'],
      ['p', 'a'.repeat(64), 'wss://hint', 'creator'],
      ['learningResourceType:prefLabel:en', 'Worksheet']
    ];
    const { getByTestId } = render(ResourceCover, {
      props: {
        resource: {
          ...buildResource({ image: null, tags, identifier: 'r-ptag-loading' }),
          pubkey: '0'.repeat(64)
        },
        size: 'full',
        aspect: 'wide'
      }
    });
    expect(getByTestId('typo-cover-author').textContent).toContain('Uploader');
  });

  it('uses a single creator:name tag as the attribution', () => {
    const tags = [
      ['d', 'r-with-creators'],
      ['creator:name', 'Constanze von Kitzing'],
      ['learningResourceType:prefLabel:en', 'Lesson plan']
    ];
    const { getByTestId } = render(ResourceCover, {
      props: {
        resource: buildResource({ image: null, tags, identifier: 'r-with-creators' }),
        size: 'full',
        aspect: 'wide'
      }
    });
    expect(getByTestId('typo-cover-author').textContent).toContain('Constanze von Kitzing');
  });

  it('joins two creator:name tags with " & "', () => {
    const tags = [
      ['d', 'r-two'],
      ['creator:name', 'Alice'],
      ['creator:name', 'Bob'],
      ['learningResourceType:prefLabel:en', 'Worksheet']
    ];
    const { getByTestId } = render(ResourceCover, {
      props: {
        resource: buildResource({ image: null, tags, identifier: 'r-two' }),
        size: 'full',
        aspect: 'wide'
      }
    });
    expect(getByTestId('typo-cover-author').textContent).toContain('Alice & Bob');
  });

  it('renders "A, B et al." when three or more creator:name tags are present', () => {
    const tags = [
      ['d', 'r-multi'],
      ['creator:name', 'Alice'],
      ['creator:name', 'Bob'],
      ['creator:name', 'Carol'],
      ['creator:name', 'Dan'],
      ['learningResourceType:prefLabel:en', 'Worksheet']
    ];
    const { getByTestId } = render(ResourceCover, {
      props: {
        resource: buildResource({ image: null, tags, identifier: 'r-multi' }),
        size: 'full',
        aspect: 'wide'
      }
    });
    expect(getByTestId('typo-cover-author').textContent).toContain('Alice, Bob et al.');
  });

  it('falls back to publisher profile display name when no creator:name tags', () => {
    profileState.current = { name: 'Fortbildner', display_name: '@Fortbild' };
    const { getByTestId } = render(ResourceCover, {
      props: {
        resource: buildResource({ image: null }),
        size: 'full',
        aspect: 'wide'
      }
    });
    expect(getByTestId('typo-cover-author').textContent).toContain('@Fortbild');
  });

  it('falls back to shortened pubkey when no creator:name and no profile', () => {
    profileState.current = null;
    const pubkey = '0'.repeat(64);
    const { getByTestId } = render(ResourceCover, {
      props: {
        resource: { ...buildResource({ image: null }), pubkey },
        size: 'full',
        aspect: 'wide'
      }
    });
    expect(getByTestId('typo-cover-author').textContent).toContain('00000000…');
  });

  it('uses resource.license.label verbatim as the license tag', () => {
    const { getByTestId } = render(ResourceCover, {
      props: {
        resource: {
          ...buildResource({ image: null }),
          license: { id: 'https://example.org/cc-by-sa', label: 'CC BY-SA 4.0' }
        },
        size: 'full',
        aspect: 'wide'
      }
    });
    expect(getByTestId('typo-cover-license').textContent).toContain('CC BY-SA 4.0');
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
