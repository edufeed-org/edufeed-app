/** Turns the model never saw (canned, router, tier 1) as plain chat messages, in order. */

const MAX_TITLES = 5;

/**
 * @param {{ role: 'user' | 'assistant', text?: string, items?: { title?: string }[] }[]} turns
 * @returns {import('ai').UIMessage[]}
 */
export function priorMessages(turns) {
  return turns.flatMap((t, i) => {
    const titles = (t.items ?? [])
      .map((x) => x.title)
      .filter(Boolean)
      .slice(0, MAX_TITLES);
    // only the model reads this label, never shown: German on purpose
    const text = [t.text, titles.length ? `[Treffer: ${titles.join('; ')}]` : '']
      .filter(Boolean)
      .join('\n');
    return text ? [{ id: `prior-${i}`, role: t.role, parts: [{ type: 'text', text }] }] : [];
  });
}
