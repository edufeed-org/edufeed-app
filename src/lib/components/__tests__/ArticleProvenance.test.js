/**
 * ArticleProvenance — credited people, license card with TULLU citation,
 * source and modification note below a NIP-23 article.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/svelte';

const PUBLISHER = 'a'.repeat(64);
const CORINNA = 'd'.repeat(64);

vi.mock('$lib/paraglide/messages.js', () => ({
  article_view_authors: () => 'Autor*innen',
  article_view_changes: () => 'Änderungen',
  article_view_source: () => 'Ursprung',
  amb_resource_license: () => 'Lizenz',
  amb_resource_view_license: () => 'Lizenz ansehen',
  amb_resource_role_creator: () => 'Autor*in',
  amb_resource_role_contributor: () => 'Mitwirkende*r',
  amb_resource_citation_format: (/** @type {any} */ s) =>
    `„${s.title}“ von ${s.creator} unter der Lizenz ${s.license} via ${s.origin}`,
  amb_resource_citation_heading: () => 'Zitieren',
  amb_resource_citation_copy: () => 'Kopieren',
  amb_resource_citation_hint: () => 'TULLU',
  amb_resource_citation_copied: () => 'Kopiert',
  amb_resource_citation_copy_failed: () => 'Fehler'
}));
vi.mock('$lib/helpers/toast.js', () => ({ showToast: vi.fn() }));
vi.mock('$app/paths', () => ({ resolve: (/** @type {string} */ p) => p }));
vi.mock('$lib/helpers/nostrUtils.js', () => ({
  profileLink: (/** @type {string} */ pk) => `/p/${pk}`
}));
vi.mock('$lib/stores/profile-map.svelte.js', () => ({
  useProfileMap: () => () => new Map([[CORINNA, { name: 'Corinna Profil' }]])
}));
vi.mock('$lib/stores/user-profile.svelte.js', () => ({
  useUserProfile: () => () => ({ name: 'Jörg' })
}));
vi.mock('../shared/ProfileAvatar.svelte', () => ({ default: () => ({}) }));

const ArticleProvenance = (await import('../article/ArticleProvenance.svelte')).default;

/** @param {string[][]} tags */
const article = (tags) => ({
  id: 'e'.repeat(64),
  kind: 30023,
  pubkey: PUBLISHER,
  created_at: 1,
  content: '',
  tags: [['d', 'x'], ['title', 'Mein Beitrag'], ...tags]
});

const app = { pageUrl: 'https://edufeed.org/naddr1x', appName: 'Edufeed' };

describe('ArticleProvenance', () => {
  it('renders nothing for an article without people or license', () => {
    const { container } = render(ArticleProvenance, { props: { event: article([]), ...app } });
    expect(container.textContent?.trim()).toBe('');
  });

  it('lists credited people with resolved names and role badges', () => {
    const { container, getByTestId } = render(ArticleProvenance, {
      props: {
        event: article([
          ['creator:name', 'Corinna Beispiel'],
          ['contributor:name', 'Gina'],
          ['p', CORINNA, '', 'creator']
        ]),
        ...app
      }
    });
    const people = getByTestId('article-people');
    expect(people.textContent).toContain('Corinna Beispiel');
    expect(people.textContent).toContain('Corinna Profil');
    expect(people.textContent).toContain('Gina');
    expect(container.querySelectorAll('[data-testid="role-contributor"]').length).toBe(1);
    expect(container.querySelector('[data-testid="article-license"]')).toBeNull();
  });

  it('shows the license with a TULLU citation, the source and the change note', () => {
    const { getByTestId } = render(ArticleProvenance, {
      props: {
        event: article([
          ['creator:name', 'Corinna Beispiel'],
          ['license:id', 'https://creativecommons.org/licenses/by-sa/4.0/'],
          ['source', 'https://blog.example.org/beitrag'],
          ['changes', 'geändert von Gina, Links ausgetauscht']
        ]),
        ...app
      }
    });
    const card = getByTestId('article-license');
    expect(card.textContent).toContain('CC BY-SA 4.0');
    expect(
      card.querySelector('a[href="https://creativecommons.org/licenses/by-sa/4.0/"]')
    ).toBeTruthy();
    const citation = getByTestId('citation-note').textContent;
    expect(citation).toContain('„Mein Beitrag“ von Corinna Beispiel');
    expect(citation).toContain('via blog.example.org');
    expect(card.textContent).toContain('geändert von Gina, Links ausgetauscht');
    expect(card.querySelector('a[href="https://blog.example.org/beitrag"]')).toBeTruthy();
  });

  it('cites the publisher and the app page when nobody else is credited', () => {
    const { getByTestId } = render(ArticleProvenance, {
      props: {
        event: article([['license:id', 'https://creativecommons.org/licenses/by/4.0/']]),
        ...app
      }
    });
    const citation = getByTestId('citation-note').textContent;
    expect(citation).toContain('von Jörg');
    expect(citation).toContain('via Edufeed');
  });
});
