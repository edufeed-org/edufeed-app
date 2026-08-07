// Thread replies (NIP-22 kind-1111 comments) in Concord channels.
//
// Armada's chat plane keeps threads distinct from inline replies: a kind-9
// `q` tag is an inline quote-reply (timeline row), a kind-1111 comment with
// uppercase `K`/`E`/`P` root tags + lowercase `k`/`e`/`p` parent tags is a
// thread reply (side panel). Tag layout matches Armada's buildV2CommentTags
// exactly (verified against armada src/concord-v2/lib/chat.ts) so replies
// round-trip between clients. All ids are RUMOR ids.
//
// Pure module — no package imports (src/lib/concord SSR convention). The
// send path goes through community.sendEvent(channelId, template), which
// appends the CORD-03 channel/epoch binding and seals like every other rumor.

/**
 * The thread-root rumor id a rumor belongs to, or null. Only kind-1111
 * comments participate; kind-9 `q`/`e` tags are deliberately NOT roots.
 * @param {{kind?: number, tags?: string[][]} | null | undefined} rumor
 * @returns {string | null}
 */
export function getThreadRootId(rumor) {
  if (rumor?.kind !== 1111) return null;
  const root = rumor.tags?.find((t) => t[0] === 'E')?.[1];
  return root || null;
}

/**
 * Fold a channel's kind-1111 timeline into per-root summaries for the
 * "N replies" badge.
 * @param {any[]} comments
 * @returns {Map<string, {count: number, latest: number}>}
 */
export function aggregateThreads(comments) {
  const map = new Map();
  for (const comment of comments) {
    const root = getThreadRootId(comment);
    if (!root) continue;
    const entry = map.get(root) ?? { count: 0, latest: 0 };
    entry.count += 1;
    entry.latest = Math.max(entry.latest, comment.created_at ?? 0);
    map.set(root, entry);
  }
  return map;
}

/**
 * One thread's replies, oldest first. Ties on created_at break on the
 * rumor's sub-second `ms` field (Armada convention), then on id so the
 * order is total and stable across clients.
 * @param {any[]} comments
 * @param {string} rootId
 * @returns {any[]}
 */
export function threadRepliesFor(comments, rootId) {
  return comments
    .filter((c) => getThreadRootId(c) === rootId)
    .sort(
      (a, b) =>
        (a.created_at ?? 0) - (b.created_at ?? 0) ||
        (a.ms ?? 0) - (b.ms ?? 0) ||
        String(a.id).localeCompare(String(b.id))
    );
}

/**
 * NIP-22 comment template for a thread reply to `parent` — tag-for-tag the
 * shape Armada's buildV2CommentTags produces: when the parent is itself a
 * comment its `K`/`E`/`P` root pointer is inherited verbatim (stable root at
 * any nesting depth); otherwise the parent IS the root. Lowercase `k`/`e`/`p`
 * always point at the immediate parent.
 * @param {{id: string, kind: number, pubkey: string, tags?: string[][]}} parent
 * @param {string} content
 * @returns {{kind: number, content: string, created_at: number, tags: string[][]}}
 */
export function buildThreadReplyTemplate(parent, content) {
  /** @type {string[][]} */
  const tags = [];

  const rootTags = (parent.tags ?? []).filter(([n]) => n === 'K' || n === 'E' || n === 'P');
  if (rootTags.length > 0) {
    for (const t of rootTags) tags.push([...t]);
  } else {
    tags.push(['K', String(parent.kind)]);
    tags.push(['E', parent.id, '', parent.pubkey]);
    tags.push(['P', parent.pubkey]);
  }

  tags.push(['k', String(parent.kind)]);
  tags.push(['e', parent.id, '', parent.pubkey]);
  tags.push(['p', parent.pubkey]);

  return {
    kind: 1111,
    content,
    created_at: Math.floor(Date.now() / 1000),
    tags
  };
}
