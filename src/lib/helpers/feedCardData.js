/**
 * Maps any Nostr event to normalized feed card display data.
 *
 * @param {any} event - Nostr event
 * @returns {{ title: string, subtitle?: string, typeKey: string, tags: string[], description?: string }}
 */
export function getFeedCardData(event) {
  /** @param {string} name */
  const getTag = (name) => event.tags?.find(/** @param {string[]} t */ (t) => t[0] === name)?.[1];
  /** @param {string} name */
  const getTags = (name) =>
    event.tags
      ?.filter(/** @param {string[]} t */ (t) => t[0] === name)
      .map(/** @param {string[]} t */ (t) => t[1]) || [];

  // Universal: first 3 hashtags
  const tags = getTags('t').slice(0, 3);

  switch (event.kind) {
    case 30023: {
      const summary = getTag('summary') || truncate(event.content, 120);
      return {
        title: getTag('title') || 'Untitled Article',
        typeKey: 'article',
        tags,
        description: summary
      };
    }
    case 30142: {
      const lrt = getTag('learningResourceType');
      const lrtLabel = lrt ? lrt.split('/').pop() : undefined;
      return {
        title: getTag('name') || 'Untitled Resource',
        typeKey: 'learning',
        tags,
        description: lrtLabel
      };
    }
    case 30301: {
      const colCount = getTags('col').length;
      const description = colCount > 0 ? `${colCount} columns` : undefined;
      return {
        title: getTag('title') || getTag('name') || 'Untitled Board',
        typeKey: 'board',
        tags,
        description
      };
    }
    case 30818: {
      const summary = getTag('summary') || truncate(event.content, 120);
      return {
        title: getTag('title') || getTag('d') || 'Untitled Wiki',
        typeKey: 'wiki',
        tags,
        description: summary
      };
    }
    case 31922:
    case 31923: {
      const title = getTag('title') || 'Untitled Event';
      const startStr = getTag('start');
      return { title, subtitle: startStr, typeKey: 'calendar', tags };
    }
    case 30168: {
      return {
        title: getTag('name') || 'Untitled Form',
        typeKey: 'form',
        tags,
        description: getTag('description')
      };
    }
    case 1: {
      const text = truncate(event.content, 120);
      return { title: text || 'Note', typeKey: 'note', tags };
    }
    case 11: {
      const excerpt = truncate(event.content, 120);
      return {
        title: getTag('title') || 'Untitled Thread',
        typeKey: 'thread',
        tags,
        description: excerpt
      };
    }
    case 39701: {
      const dTag = getTag('d');
      const url = dTag ? (dTag.startsWith('http') ? dTag : `https://${dTag}`) : undefined;
      return {
        title: getTag('title') || url || 'Bookmark',
        subtitle: url,
        typeKey: 'bookmark',
        tags,
        description: truncate(event.content, 120)
      };
    }
    case 9802: {
      const text = truncate(event.content, 120);
      let subtitle = getTag('r');
      if (!subtitle) {
        const aTag = getTag('a');
        if (aTag) {
          const parts = aTag.split(':');
          const kind = parts[0] ? parseInt(parts[0]) : 0;
          const identifier = parts.slice(2).join(':');
          const label = kind === 30818 ? 'Wiki' : 'Article';
          subtitle = `${label}: ${identifier}`;
        }
      }
      return {
        title: text || 'Highlight',
        subtitle,
        typeKey: 'highlight',
        tags
      };
    }
    case 1111: {
      const noteText = truncate(event.content, 120);
      return {
        title: noteText || 'Note',
        subtitle: getTag('K') === 'web' ? getTag('I') : getTag('r'),
        typeKey: 'note',
        tags
      };
    }
    default:
      return { title: 'Untitled', typeKey: 'unknown', tags };
  }
}

/**
 * @param {string | undefined} str
 * @param {number} maxLen
 * @returns {string | undefined}
 */
function truncate(str, maxLen) {
  if (!str) return undefined;
  const clean = str.replace(/\n+/g, ' ').trim();
  if (!clean) return undefined;
  return clean.length > maxLen ? clean.slice(0, maxLen) + '...' : clean;
}
