// Termi conversation history in the chat-bot's NIP-78 shape (pure, no I/O).
// Spec: docs/superpowers/specs/2026-11-09-termi-ux-round-design.md §5.

import {
  TOOL_REGISTRY,
  persistItems,
  slimItem,
  strings,
  toolNameOf
} from '../../../termi/tool-registry.js';

/**
 * @typedef {import('$lib/termi/items.d.js').SlimItem} SlimItem
 * @typedef {{ type: string, toolName?: string, toolCallId: string, state: string,
 *   input?: unknown, output?: any }} UIMessagePart
 * @typedef {{ role: 'user'|'assistant', text: string, tier: 1|2, items?: SlimItem[],
 *   sourcesUnavailable?: string[], toolParts?: UIMessagePart[], sourcesLost?: boolean,
 *   draftNaddr?: string }} Turn
 * @typedef {{ id: string, title: string, createdAt: number, updatedAt: number, turns: Turn[] }} Conversation
 * @typedef {{ toolCallId: string, toolName: string, input: unknown, output?: any,
 *   state: 'output-available' }} SerializableToolInvocation
 * @typedef {{ id: string, role: 'user'|'assistant', content: string,
 *   toolInvocations?: SerializableToolInvocation[], draftNaddr?: string }} SerializableMessage
 * @typedef {{ id: string, title: string, createdAt: number, updatedAt: number,
 *   messages: SerializableMessage[] }} ConversationContent
 */

export const TIER1_TOOL = 'termi_search';
// Registry tools are the only tool parts worth keeping; foreign ones stay text-only.
/** @param {unknown} name */
const isStoredTool = (name) => typeof name === 'string' && Object.hasOwn(TOOL_REGISTRY, name);

/** @param {Record<string, unknown>} o */
const compact = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

/** A document's LiaScript draft (kind 30024 naddr), else nothing. @param {unknown} v */
const naddrOf = (v) =>
  typeof v === 'string' && /^naddr1[02-9ac-hj-np-z]+$/.test(v) ? v : undefined;

// What capContent keeps of an item before it drops whole outputs: enough for a card link and a source line.
const ATTRIBUTION = [
  'type',
  'id',
  'title',
  'creator',
  'publisher',
  'license',
  'licenseUrl',
  'sourceUrl',
  'href'
];

/**
 * A tool output's history form, by the tool's registry `persist`. An unknown
 * tool would be lost silently on restore: loud in DEV, warned and dropped in prod.
 * @param {string} name @param {any} output @returns {any} the persisted shape (items or ids)
 */
export function slimOutput(name, output) {
  if (!output || typeof output !== 'object') return undefined;
  if (name === TIER1_TOOL) return persistItems(output);
  if (isStoredTool(name)) return TOOL_REGISTRY[name].persist(output) ?? undefined;
  if (import.meta.env.DEV) throw new Error(`Termi history: tool "${name}" has no registry entry`);
  console.warn(`Termi history: dropped output of unregistered tool "${name}"`);
  return undefined;
}

/** Title = first user message, ≤ 50 characters at a word boundary + `…`. @param {string} text */
export function generateTitle(text) {
  const t = String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (t.length <= 50) return t;
  const cut = t.slice(0, 51); // one extra char: a word ending exactly at 50 is whole
  const space = cut.lastIndexOf(' ');
  return (space > 0 ? cut.slice(0, space) : t.slice(0, 50)).replace(/[\s,;:.]+$/, '') + '…';
}

/** A tier-1 window message (`role: 'user'|'bot'`) → Turn. @param {any} msg @returns {Turn} */
export function fromTier1Message(msg) {
  const role = msg.role === 'user' ? 'user' : 'assistant';
  /** @type {Turn} */
  const turn = { role, text: msg.text ?? '', tier: 1 };
  if (role === 'assistant') {
    turn.items = (msg.items ?? []).map(slimItem);
    turn.sourcesUnavailable = strings(msg.sourcesUnavailable);
    if (msg.sourcesLost) turn.sourcesLost = true;
    if (naddrOf(msg.draftNaddr)) turn.draftNaddr = msg.draftNaddr;
  }
  return turn;
}

/** @param {Turn} turn */
export function toTier1Message(turn) {
  return compact({
    role: turn.role === 'user' ? 'user' : 'bot',
    text: turn.text,
    items: turn.items?.map(({ start, ...it }) => compact({ ...it, date: start })),
    sourcesUnavailable: turn.sourcesUnavailable,
    sourcesLost: turn.sourcesLost,
    draftNaddr: turn.draftNaddr
  });
}

/** An AI SDK UIMessage → Turn: text plus the finished knowledge/show_pages parts. @param {any} msg @returns {Turn} */
export function fromUIMessage(msg) {
  const parts = Array.isArray(msg.parts) ? msg.parts : [];
  const text = parts
    .filter((/** @type {any} */ p) => p.type === 'text')
    .map((/** @type {any} */ p) => p.text)
    .join('')
    .trim();
  const toolParts = parts
    .filter((/** @type {any} */ p) => p.state === 'output-available' && isStoredTool(toolNameOf(p)))
    .map((/** @type {any} */ p) => ({
      type: 'dynamic-tool',
      toolName: toolNameOf(p),
      toolCallId: p.toolCallId,
      state: 'output-available',
      // a plain copy: the live part's input can be a Svelte proxy
      input: p.input === undefined ? undefined : JSON.parse(JSON.stringify(p.input)),
      output: slimOutput(toolNameOf(p), p.output)
    }));
  const role = msg.role === 'user' ? 'user' : 'assistant';
  return /** @type {Turn} */ (
    compact({
      role,
      text,
      tier: 2,
      toolParts: toolParts.length ? toolParts : undefined,
      // a capped turn carried back into a running chat stays capped when re-saved
      sourcesLost: msg.metadata?.sourcesLost || undefined,
      draftNaddr: naddrOf(msg.metadata?.draftNaddr)
    })
  );
}

/** @param {Turn} turn @param {string} id */
export function toUIMessage(turn, id) {
  return {
    id,
    role: turn.role,
    parts: [...(turn.toolParts ?? []), ...(turn.text ? [{ type: 'text', text: turn.text }] : [])],
    ...(turn.sourcesLost || turn.draftNaddr
      ? { metadata: compact({ sourcesLost: turn.sourcesLost, draftNaddr: turn.draftNaddr }) }
      : {})
  };
}

/** @param {Conversation} conv @returns {ConversationContent} */
export function toContent(conv) {
  return {
    id: conv.id,
    title: conv.title,
    createdAt: conv.createdAt,
    updatedAt: conv.updatedAt,
    messages: conv.turns.map((t, i) => {
      /** @type {SerializableMessage} */
      const m = { id: `${conv.id}-${i}`, role: t.role, content: t.text };
      if (t.role !== 'assistant') return m;
      if (t.draftNaddr) m.draftNaddr = t.draftNaddr;
      if (t.tier === 1) {
        m.toolInvocations = [
          {
            toolCallId: `${m.id}-search`,
            toolName: TIER1_TOOL,
            input: {},
            // no output = lost, as when capContent dropped it
            output: t.sourcesLost
              ? undefined
              : { items: t.items ?? [], sourcesUnavailable: t.sourcesUnavailable ?? [] },
            state: 'output-available'
          }
        ];
      } else if (t.toolParts?.length) {
        m.toolInvocations = t.toolParts.map((p) => ({
          toolCallId: p.toolCallId,
          toolName: /** @type {string} */ (toolNameOf(p)),
          input: p.input,
          output: p.output,
          state: 'output-available'
        }));
      }
      return m;
    })
  };
}

/**
 * Untrusted JSON (relay or storage) → Conversation. Assistant turns with a
 * `termi_search` invocation are tier 1, other assistant turns tier 2; a user
 * turn takes the tier of the answer that follows it (else the one before).
 * @param {any} json @returns {Conversation}
 */
export function fromContent(json) {
  const messages = Array.isArray(json?.messages) ? json.messages : [];
  /** @type {Turn[]} */
  const turns = messages
    .filter((/** @type {any} */ m) => m && (m.role === 'user' || m.role === 'assistant'))
    .map((/** @type {any} */ m) => {
      const text = typeof m.content === 'string' ? m.content : '';
      if (m.role === 'user') return { role: 'user', text, tier: 1 };
      // Foreign calls (the chat-bot's fetch_url, propose_calendar_event, unfinished
      // or failed ones) stay text-only. termi_search marks a tier-1 turn even when
      // capContent dropped its output.
      const inv = (Array.isArray(m.toolInvocations) ? m.toolInvocations : []).filter(
        (/** @type {any} */ i) =>
          i?.state === 'output-available' &&
          (i.toolName === TIER1_TOOL || (isStoredTool(i.toolName) && i.output))
      );
      // A search whose output capContent dropped: a document's sources are gone.
      const sourcesLost =
        (Array.isArray(m.toolInvocations) ? m.toolInvocations : []).some(
          (/** @type {any} */ i) =>
            i?.state === 'output-available' &&
            (i.toolName === TIER1_TOOL || isStoredTool(i.toolName)) &&
            !i.output
        ) || undefined;
      const draftNaddr = naddrOf(m.draftNaddr);
      const search = inv.find((/** @type {any} */ i) => i.toolName === TIER1_TOOL);
      if (search) {
        const out = slimOutput(TIER1_TOOL, search.output);
        return compact({
          role: 'assistant',
          text,
          tier: 1,
          items: out?.items ?? [],
          sourcesUnavailable: out?.sourcesUnavailable ?? [],
          sourcesLost,
          draftNaddr
        });
      }
      const toolParts = inv.map((/** @type {any} */ i) => ({
        type: 'dynamic-tool',
        toolName: i.toolName,
        toolCallId: String(i.toolCallId ?? ''),
        state: 'output-available',
        input: i.input,
        output: slimOutput(i.toolName, i.output)
      }));
      return compact({
        role: 'assistant',
        text,
        tier: 2,
        toolParts: toolParts.length ? toolParts : undefined,
        sourcesLost,
        draftNaddr
      });
    });
  turns.forEach((t, i) => {
    if (t.role !== 'user') return;
    const answer =
      turns.slice(i + 1).find((x) => x.role === 'assistant') ??
      turns.slice(0, i).findLast((x) => x.role === 'assistant');
    t.tier = answer?.tier ?? 1;
  });
  const num = (/** @type {unknown} */ v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  return {
    id: String(json?.id ?? ''),
    title: typeof json?.title === 'string' ? json.title : '',
    createdAt: num(json?.createdAt),
    updatedAt: num(json?.updatedAt),
    turns
  };
}

let warnedOversize = false;
/** @param {unknown} v */
const byteLength = (v) => new TextEncoder().encode(JSON.stringify(v)).length;

/**
 * Shrink, then drop the oldest tool outputs (text kept) until the UTF-8 JSON fits. 28 KB, not
 * 64: NIP-44 padding past 40,960 bytes jumps to 64 KB and base64 adds a third,
 * so a bigger plaintext overflows strfry's 64 KB event limit — and a bunker
 * wraps the whole event again.
 * @param {ConversationContent} content @param {number} [maxBytes]
 * @returns {ConversationContent}
 */
export function capContent(content, maxBytes = 28 * 1024) {
  // A JSON round-trip, not structuredClone: messages can carry Svelte-reactive
  // proxies (tool `input`), which structuredClone's class/brand check rejects.
  const out = JSON.parse(JSON.stringify(content));
  // First shrink items to their attribution, oldest first; only then drop whole outputs.
  for (const m of out.messages) {
    if (byteLength(out) <= maxBytes) return out;
    for (const inv of m.toolInvocations ?? []) {
      if (!Array.isArray(inv.output?.items)) continue;
      inv.output.items = inv.output.items.map((/** @type {any} */ it) =>
        Object.fromEntries(Object.entries(it).filter(([k]) => ATTRIBUTION.includes(k)))
      );
    }
  }
  for (const m of out.messages) {
    if (byteLength(out) <= maxBytes) return out;
    for (const inv of m.toolInvocations ?? []) delete inv.output;
  }
  if (byteLength(out) > maxBytes && !warnedOversize) {
    warnedOversize = true;
    console.warn(
      '[termi] conversation text alone exceeds the history size cap; relays may refuse it'
    );
  }
  return out;
}
