import { getTagValue } from 'applesauce-core/helpers';

/**
 * Search a profile map by name/display_name.
 * @param {string} term - Search term (min 2 chars)
 * @param {Map<string, any>} profileMap - Map<pubkey, profile>
 * @param {number} [limit=8]
 * @returns {Array<{pubkey: string, name: string, display_name: string, picture: string, nip05: string}>}
 */
export function searchProfileMap(term, profileMap, limit = 8) {
  if (!term || term.length < 2) return [];

  const lowerTerm = term.toLowerCase();
  /** @type {Array<{pubkey: string, name: string, display_name: string, picture: string, nip05: string, prefix: boolean}>} */
  const matches = [];

  for (const [pubkey, profile] of profileMap) {
    const name = (profile?.name || '').toLowerCase();
    const displayName = (profile?.display_name || '').toLowerCase();

    const nameMatch = name.includes(lowerTerm);
    const displayMatch = displayName.includes(lowerTerm);

    if (nameMatch || displayMatch) {
      const prefix = name.startsWith(lowerTerm) || displayName.startsWith(lowerTerm);
      matches.push({
        pubkey,
        name: profile?.name || '',
        display_name: profile?.display_name || '',
        picture: profile?.picture || '',
        nip05: profile?.nip05 || '',
        prefix
      });
    }
  }

  // Sort: prefix matches first, then alphabetical by name
  matches.sort((a, b) => {
    if (a.prefix !== b.prefix) return a.prefix ? -1 : 1;
    return (a.name || a.display_name).localeCompare(b.name || b.display_name);
  });

  return matches.slice(0, limit).map(({ prefix: _prefix, ...rest }) => rest);
}

/**
 * Check if a raw Nostr event matches a text search query.
 * Dispatches by event kind — used for community content view search.
 *
 * @param {import('nostr-tools').Event} event - Raw Nostr event
 * @param {string} query - Search query
 * @param {Map<string, any>} profiles - Map of pubkey → profile metadata
 * @returns {boolean}
 */
export function matchesEventSearch(event, query, profiles) {
  const lowerQuery = query.toLowerCase();
  const profile = profiles.get(event.pubkey);
  const name = profile?.name?.toLowerCase() || '';
  const displayName = profile?.display_name?.toLowerCase() || '';
  const authorMatch = name.includes(lowerQuery) || displayName.includes(lowerQuery);

  switch (event.kind) {
    case 30023: {
      // Article: title, summary, author
      const title = getTagValue(event, 'title')?.toLowerCase() || '';
      const summary = getTagValue(event, 'summary')?.toLowerCase() || '';
      return title.includes(lowerQuery) || summary.includes(lowerQuery) || authorMatch;
    }
    case 30142: {
      // AMB: name, description, keyword tags, author
      const resourceName = getTagValue(event, 'name')?.toLowerCase() || '';
      const description = getTagValue(event, 'description')?.toLowerCase() || '';
      const keywords = event.tags
        .filter((t) => t[0] === 'keyword')
        .map((t) => t[1]?.toLowerCase() || '')
        .join(' ');
      return (
        resourceName.includes(lowerQuery) ||
        description.includes(lowerQuery) ||
        keywords.includes(lowerQuery) ||
        authorMatch
      );
    }
    case 30301: {
      // Board: title, description, author
      const title = getTagValue(event, 'title')?.toLowerCase() || '';
      const description = getTagValue(event, 'description')?.toLowerCase() || '';
      return title.includes(lowerQuery) || description.includes(lowerQuery) || authorMatch;
    }
    case 30818: {
      // Wiki: d-tag (title), content, author
      const dTag = getTagValue(event, 'd')?.toLowerCase() || '';
      const content = event.content?.toLowerCase() || '';
      return dTag.includes(lowerQuery) || content.includes(lowerQuery) || authorMatch;
    }
    case 11: {
      // Forum thread: title, content, author
      const title = getTagValue(event, 'title')?.toLowerCase() || '';
      const content = event.content?.toLowerCase() || '';
      return title.includes(lowerQuery) || content.includes(lowerQuery) || authorMatch;
    }
    case 39701:
    case 9802:
    case 1111: {
      // Social bookmarks/highlights/comments: r-tag URL, content, author
      const rTag = getTagValue(event, 'r')?.toLowerCase() || '';
      const content = event.content?.toLowerCase() || '';
      return rTag.includes(lowerQuery) || content.includes(lowerQuery) || authorMatch;
    }
    default:
      return false;
  }
}

/**
 * Check if a discover-page item matches a text search query.
 *
 * @param {{type: string, data: any}} item - Content item with type and data
 * @param {string} query - Lowercased search query
 * @param {Map<string, any>} profiles - Map of pubkey → profile metadata
 * @returns {boolean}
 */
export function matchesTextSearch(item, query, profiles) {
  const lowerQuery = query.toLowerCase();
  const pubkey = item.data.pubkey;
  const profile = profiles.get(pubkey);
  const name = profile?.name?.toLowerCase() || '';
  const displayName = profile?.display_name?.toLowerCase() || '';

  if (item.type === 'article') {
    const title = getTagValue(item.data, 'title')?.toLowerCase() || '';
    const summary = getTagValue(item.data, 'summary')?.toLowerCase() || '';
    return (
      title.includes(lowerQuery) ||
      summary.includes(lowerQuery) ||
      name.includes(lowerQuery) ||
      displayName.includes(lowerQuery)
    );
  } else if (item.type === 'amb') {
    const resourceName = item.data.name?.toLowerCase() || '';
    const description = item.data.description?.toLowerCase() || '';
    const keywords = item.data.keywords?.join(' ').toLowerCase() || '';
    const subjects =
      item.data.subjects
        ?.map((/** @type {{label: string}} */ s) => s.label)
        .join(' ')
        .toLowerCase() || '';
    const creatorNames = item.data.creatorNames?.join(' ').toLowerCase() || '';
    return (
      resourceName.includes(lowerQuery) ||
      description.includes(lowerQuery) ||
      keywords.includes(lowerQuery) ||
      subjects.includes(lowerQuery) ||
      creatorNames.includes(lowerQuery) ||
      name.includes(lowerQuery) ||
      displayName.includes(lowerQuery)
    );
  } else if (item.type === 'event') {
    const title = item.data.title?.toLowerCase() || '';
    const summary = item.data.summary?.toLowerCase() || '';
    const locations = item.data.locations?.join(' ').toLowerCase() || '';
    return (
      title.includes(lowerQuery) ||
      summary.includes(lowerQuery) ||
      locations.includes(lowerQuery) ||
      name.includes(lowerQuery) ||
      displayName.includes(lowerQuery)
    );
  } else if (item.type === 'board') {
    const title = getTagValue(item.data, 'title')?.toLowerCase() || '';
    const description = getTagValue(item.data, 'description')?.toLowerCase() || '';
    return (
      title.includes(lowerQuery) ||
      description.includes(lowerQuery) ||
      name.includes(lowerQuery) ||
      displayName.includes(lowerQuery)
    );
  }
  return false;
}
