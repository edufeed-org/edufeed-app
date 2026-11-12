// Termi conversation history in the chat-bot's NIP-78 shape (pure, no I/O).
// Spec: docs/superpowers/specs/2026-11-09-termi-ux-round-design.md §5.

import {
  TOOL_REGISTRY,
  compact,
  persistItems,
  slimItem,
  strings,
  toolNameOf,
  toolOptions
} from '../../../termi/tool-registry.js';
import { PART_KEY, addMaterialTo, sanitizeLessonState } from '../../../termi/lesson-state.js';
import { partsIn, supersededIn } from '../../../termi/werkbank.js';

/**
 * @typedef {import('$lib/termi/items.d.js').SlimItem} SlimItem
 * @typedef {{ type: string, toolName?: string, toolCallId: string, state: string,
 *   input?: unknown, output?: any }} UIMessagePart
 * @typedef {{ draftNaddr?: string, draftWraps?: Record<string, string> }} Artifacts per-answer results of an
 *   action: the LiaScript draft (kind 30024), the lesson parts' NIP-37 wraps by part key (`module`, `lesson-2`)
 * @typedef {{ status?: number, scope?: string, href: string }} TurnError
 * @typedef {{ id?: string, role: 'user'|'assistant', text: string, tier: 1|2,
 *   items?: SlimItem[] | import('$lib/termi/items.d.js').Item[],
 *   sourcesUnavailable?: string[], toolParts?: UIMessagePart[], sourcesLost?: boolean,
 *   artifacts?: Artifacts, actions?: import('../termi-router.js').TermiAction[], query?: string,
 *   link?: { label: string, attrs: Record<string, any> }, import?: import('../import/publish-imported.js').ImportState,
 *   guesses?: import('../termi-router.js').TermiAction[], error?: TurnError, pending?: boolean, busy?: import('$lib/termi/busy.js').BusyGroup,
 *   pageIds?: string[], options?: import('$lib/termi/tool-registry.js').OptionsCard,
 *   lessonParts?: import('$lib/termi/lesson-state.js').LessonPartText[],
 *   lessonPart?: import('$lib/termi/lesson-state.js').LessonPartText, textStub?: boolean,
 *   model?: string }} Turn
 *   One shape for the window and the history. Stored: role, text, tier, items (SlimItem),
 *   sourcesUnavailable, toolParts, sourcesLost, artifacts, model (the id that answered, tier 2), textStub (the text is a 300-char stub,
 *   the parts live in their wraps); the rest is render state
 *   (`id` from the controller, `pending` = still streaming, `error` = the chat's error line,
 *   `options` = the propose_options card, re-read from the stored tool part output).
 * @typedef {'ask'|'lesson'} TermiTask the server task of a conversation, fixed at its first message
 * @typedef {import('$lib/termi/lesson-state.js').LessonState} LessonState
 * @typedef {import('$lib/termi/lesson-state.js').LessonMaterial} LessonMaterial
 * @typedef {{ id: string, title: string, createdAt: number, updatedAt: number, task?: TermiTask,
 *   lesson?: LessonState, materials?: LessonMaterial[], turns: Turn[] }} Conversation task absent = 'ask'
 * @typedef {{ toolCallId: string, toolName: string, input: unknown, output?: any,
 *   state: 'output-available' }} SerializableToolInvocation
 * @typedef {{ id: string, role: 'user'|'assistant', content: string,
 *   toolInvocations?: SerializableToolInvocation[], draftNaddr?: string,
 *   draftWraps?: Record<string, string>, textStub?: boolean, model?: string }} SerializableMessage
 * @typedef {{ id: string, title: string, createdAt: number, updatedAt: number,
 *   task?: TermiTask, lesson?: LessonState, materials?: LessonMaterial[],
 *   messages: SerializableMessage[], syncedAt?: number }} ConversationContent
 *   task, lesson and materials are written only when set: an ask conversation keeps the chat-bot's shape;
 *   `syncedAt` (the relay event's created_at, s) lives on the local copy only, never in the encrypted content
 */

export const TIER1_TOOL = 'termi_search';
// Registry tools are the only tool parts worth keeping; foreign ones stay text-only.
/** @param {unknown} name */
const isStoredTool = (name) => typeof name === 'string' && Object.hasOwn(TOOL_REGISTRY, name);

/** A document's LiaScript draft (kind 30024 naddr), else nothing. @param {unknown} v */
const naddrOf = (v) =>
  typeof v === 'string' && /^naddr1[02-9ac-hj-np-z]+$/.test(v) ? v : undefined;
/** Untrusted artifacts → the known, valid ones; undefined when none. @param {any} a @returns {Artifacts | undefined} */
const artifactsOf = (a) => {
  const draftNaddr = naddrOf(a?.draftNaddr);
  /** @type {Record<string, unknown>} */
  const raw = a?.draftWraps && typeof a.draftWraps === 'object' ? a.draftWraps : {};
  const wraps = Object.entries(raw).flatMap(([k, v]) => {
    const naddr = naddrOf(v);
    return naddr && PART_KEY.test(k) ? [[k, naddr]] : [];
  });
  const draftWraps = wraps.length ? Object.fromEntries(wraps) : undefined;
  return draftNaddr || draftWraps ? compact({ draftNaddr, draftWraps }) : undefined;
};

// A saved lesson answer is stored as a stub: its parts live in their (encrypted) wraps.
const STUB_OVER = 600;
const STUB_KEEP = 300;

// find_people (name) and search_passages (question) carry no query: the first part that has one.
/** @param {any[]} parts @returns {string} */
export const firstQuery = (parts) =>
  parts.find((p) => typeof p.input?.query === 'string' && p.input.query)?.input?.query ?? '';

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

/** A tier-1 window turn → its stored form (slim items, no render state). @param {any} msg @returns {Turn} */
export function fromTier1Message(msg) {
  const role = msg.role === 'user' ? 'user' : 'assistant';
  /** @type {Turn} */
  const turn = { role, text: msg.text ?? '', tier: 1 };
  if (role === 'assistant') {
    turn.items = (msg.items ?? []).map(slimItem);
    turn.sourcesUnavailable = strings(msg.sourcesUnavailable);
    if (msg.sourcesLost) turn.sourcesLost = true;
    const artifacts = artifactsOf(msg.artifacts);
    if (artifacts) turn.artifacts = artifacts;
  }
  return turn;
}

/**
 * A stored turn → a read-only tier-1 window turn: tier-2 tool outputs become
 * its cards (`items`, first real `query`) and its show_pages ids (`pageIds`).
 * @param {Turn} turn @param {string} [id] @returns {Turn}
 */
export function toTier1Message(turn, id) {
  const parts = turn.tier === 2 && turn.role === 'assistant' ? (turn.toolParts ?? []) : null;
  const outputs = (parts ?? []).map((p) => p.output ?? {});
  const items = parts ? outputs.flatMap((o) => o.items ?? []) : turn.items;
  const pageIds = outputs.flatMap((o) => o.ids ?? []);
  return /** @type {Turn} */ (
    compact({
      id,
      role: turn.role === 'user' ? 'user' : 'assistant',
      tier: 1,
      text: turn.text,
      items: items?.map(({ start, ...it }) => compact({ ...it, date: start })),
      sourcesUnavailable: parts
        ? [...new Set(outputs.flatMap((o) => o.sourcesUnavailable ?? []))]
        : turn.sourcesUnavailable,
      sourcesLost: turn.sourcesLost,
      artifacts: turn.artifacts,
      textStub: turn.textStub,
      model: turn.tier === 2 ? turn.model : undefined,
      query: (parts && firstQuery(parts)) || undefined,
      pageIds: pageIds.length ? pageIds : undefined,
      options: (parts && toolOptions(parts)) || undefined
    })
  );
}

/** A UIMessage's text parts, joined; some models (qwen) lead with blank lines. @param {any} msg */
export const textOf = (msg) =>
  (Array.isArray(msg.parts) ? msg.parts : [])
    .filter((/** @type {any} */ p) => p.type === 'text')
    .map((/** @type {any} */ p) => p.text)
    // one text part per step: the sentence before a tool call and the answer after it are paragraphs
    .join('\n\n')
    .trim();

/** An untrusted model id → itself when a short string. @param {unknown} v */
const modelOf = (v) => (typeof v === 'string' && v && v.length <= 100 ? v : undefined);

/** An AI SDK UIMessage → Turn: text plus the finished knowledge/show_pages parts. @param {any} msg @returns {Turn} */
export function fromUIMessage(msg) {
  const parts = Array.isArray(msg.parts) ? msg.parts : [];
  const text = textOf(msg);
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
      artifacts: artifactsOf(msg.metadata?.artifacts),
      textStub: msg.metadata?.textStub || undefined,
      model: role === 'assistant' ? modelOf(msg.metadata?.model) : undefined
    })
  );
}

/** @param {Turn} turn @param {string} id */
export function toUIMessage(turn, id) {
  return {
    id,
    role: turn.role,
    parts: [...(turn.toolParts ?? []), ...(turn.text ? [{ type: 'text', text: turn.text }] : [])],
    ...(turn.sourcesLost || turn.artifacts || turn.textStub || turn.model
      ? {
          metadata: compact({
            sourcesLost: turn.sourcesLost,
            artifacts: turn.artifacts,
            textStub: turn.textStub,
            model: turn.model
          })
        }
      : {})
  };
}

/** @param {Conversation} conv @returns {ConversationContent} */
export function toContent(conv) {
  const task = conv.task ?? 'ask';
  // a key a later turn writes again: its wrap (replaceable) now holds the newer text
  const over = supersededIn(conv.turns, task);
  const messages = conv.turns.map((t, i) => {
    /** @type {SerializableMessage} */
    const m = { id: `${conv.id}-${i}`, role: t.role, content: t.text };
    if (t.role !== 'assistant') return m;
    // the chat-bot shape keeps the draft at the message's top level
    if (t.artifacts?.draftNaddr) m.draftNaddr = t.artifacts.draftNaddr;
    const gone = over[i];
    // an unloaded stub's text is only in its wrap: it keeps it (the save pass waits for its load)
    const wraps = Object.fromEntries(
      Object.entries(t.artifacts?.draftWraps ?? {}).filter(([k]) => t.textStub || !gone[k])
    );
    if (Object.keys(wraps).length) m.draftWraps = wraps;
    const keys = t.textStub ? [] : partsIn(t, task).map((p) => p.key);
    // cut only when every part is in its wrap or a revision replaced it (then the old
    // version is dropped on purpose); a part saved nowhere else, or another document, stays in full
    const cut =
      keys.length > 0 &&
      keys.every((k) => wraps[k] || gone[k] === 'same') &&
      t.text.length > STUB_OVER;
    // a cut text is a stub even with nothing left to load: no export of it, no part in it
    if (t.textStub) m.textStub = true;
    else if (cut) {
      m.content = t.text.slice(0, STUB_KEEP) + ' …';
      m.textStub = true;
    }
    if (t.model && t.tier === 2) m.model = t.model;
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
    } else if (t.toolParts?.length || t.sourcesLost) {
      m.toolInvocations = (t.toolParts ?? []).map((p) => ({
        toolCallId: p.toolCallId,
        toolName: /** @type {string} */ (toolNameOf(p)),
        input: p.input,
        output: p.output,
        state: 'output-available'
      }));
      // an outputless search: fromContent re-derives sourcesLost from it (document actions stay off)
      if (t.sourcesLost)
        m.toolInvocations.push({
          toolCallId: `${m.id}-lost`,
          toolName: 'search_passages',
          input: {},
          state: 'output-available'
        });
    }
    return m;
  });
  return {
    id: conv.id,
    title: conv.title,
    createdAt: conv.createdAt,
    updatedAt: conv.updatedAt,
    ...(conv.task === 'lesson' ? { task: conv.task } : {}),
    ...(conv.lesson ? { lesson: withoutMessageWraps(conv.lesson, messages) } : {}),
    ...(conv.materials?.length ? { materials: conv.materials } : {}),
    messages
  };
}

/**
 * A wrap a message's draftWraps already holds is stored there only (each is ~200 B; a
 * 12-lesson series has 17): fromContent puts it back into the lesson state.
 * @param {LessonState} lesson @param {SerializableMessage[]} messages @returns {LessonState}
 */
function withoutMessageWraps(lesson, messages) {
  const held = new Set(messages.flatMap((m) => Object.values(m.draftWraps ?? {})));
  /** @param {any} p */
  const slim = (p) => {
    if (!p || typeof p !== 'object' || !held.has(p.wrap)) return p;
    const { wrap: _held, ...rest } = p;
    return rest;
  };
  const parts = /** @type {Record<string, any>} */ (lesson.parts ?? {});
  return {
    ...lesson,
    parts: /** @type {any} */ (
      Object.fromEntries(
        Object.entries(parts).map(([k, v]) => [k, Array.isArray(v) ? v.map(slim) : slim(v)])
      )
    )
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
      const artifacts = artifactsOf({ draftNaddr: m.draftNaddr, draftWraps: m.draftWraps });
      // a cut text (only loaded when it has wraps: the window and actions check them)
      const textStub = m.textStub === true || undefined;
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
          artifacts,
          textStub
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
        artifacts,
        textStub,
        model: modelOf(m.model)
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
  const lesson = withMessageWraps(sanitizeLessonState(json?.lesson), turns);
  /** @type {LessonMaterial[]} */
  const materials = (Array.isArray(json?.materials) ? json.materials : []).reduce(
    addMaterialTo,
    []
  );
  return {
    id: String(json?.id ?? ''),
    title: typeof json?.title === 'string' ? json.title : '',
    createdAt: num(json?.createdAt),
    updatedAt: num(json?.updatedAt),
    task: json?.task === 'lesson' ? 'lesson' : 'ask',
    ...(lesson ? { lesson } : {}),
    ...(materials.length ? { materials } : {}),
    turns
  };
}

/**
 * withoutMessageWraps undone: a state part without a wrap takes its key's wrap from the turns.
 * @param {LessonState | null} lesson @param {Turn[]} turns
 */
function withMessageWraps(lesson, turns) {
  if (!lesson) return lesson;
  /** @type {Record<string, string>} */
  const byKey = Object.assign({}, ...turns.map((t) => t.artifacts?.draftWraps ?? {}));
  /** @param {string} key @param {any} p */
  const back = (key, p) =>
    p && typeof p === 'object' && !p.wrap && byKey[key] ? { ...p, wrap: byKey[key] } : p;
  const parts = /** @type {Record<string, any>} */ (lesson.parts ?? {});
  return {
    ...lesson,
    parts: /** @type {any} */ (
      Object.fromEntries(
        Object.entries(parts).map(([k, v]) => [
          k,
          Array.isArray(v) ? v.map((l) => back(`lesson-${l?.n}`, l)) : back(k, v)
        ])
      )
    )
  };
}

let warnedOversize = false;
/** @param {unknown} v */
const byteLength = (v) => new TextEncoder().encode(JSON.stringify(v)).length;

/**
 * Shrink items, then cut her files' text, then drop the oldest tool outputs (text kept) until the UTF-8 JSON fits. 28 KB, not
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
  // Her files next: each cut to 2 000 chars (the lesson state, up to 16 KB, is never dropped).
  if (byteLength(out) > maxBytes && Array.isArray(out.materials)) {
    for (const mat of out.materials) mat.text = String(mat.text ?? '').slice(0, 2000);
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
