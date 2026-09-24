<!--
  ComposerInput — the composer text field shared by every composer (notes,
  comments, threads, articles, chat, DMs) with Slack-style emoji
  handling (laoc, 2026-09-18):

  - typing `:xx` opens EmojiAutocomplete with the user's custom emojis first
    and unicode emojis after; Tab / arrows cycle, Enter inserts, Escape closes;
  - a picked custom emoji is rendered INLINE as its image, which a plain
    <input>/<textarea> cannot do — the field is a contenteditable whose DOM
    is the view of one string: `value` (bindable) holds the NIP-30 text form
    (`:shortcode:`), the DOM shows text nodes plus <img data-shortcode> for
    every shortcode the caller's packs know. Unknown shortcodes stay text;
  - Enter submits (`onSubmit`), Shift+Enter inserts a newline in multiline
    mode; paste is plain text; the picker button feeds `insert()`.

  Sync rules: user edits flow DOM → value (serialize on input, no re-render,
  so the caret is never touched); every programmatic change (a pick, insert(),
  the parent clearing the draft after send) flows value → DOM (render + caret
  restore). `rendered` remembers what the DOM currently shows so the effect
  only re-renders on real external changes.
-->
<script>
  import { tick } from 'svelte';
  import { nip19 } from 'nostr-tools';
  import { detectEmojiQuery, searchEmojis, applyEmoji } from '$lib/helpers/emoji-autocomplete.js';
  import {
    detectMentionQuery,
    applyMention,
    mentionPubkeysIn
  } from '$lib/helpers/mention-autocomplete.js';
  import { useProfileMap } from '$lib/stores/profile-map.svelte.js';
  import { useMentionCandidates } from '$lib/stores/mention-candidates.svelte.js';
  import { getUserDisplayName } from '$lib/helpers/message-utils.js';
  import EmojiAutocomplete from './EmojiAutocomplete.svelte';
  import MentionAutocomplete from './MentionAutocomplete.svelte';

  /**
   * @type {{
   *   value?: string,
   *   customEmojiSets?: import('$lib/helpers/emoji-autocomplete.js').EmojiPack[],
   *   placeholder?: string,
   *   disabled?: boolean,
   *   multiline?: boolean,
   *   onSubmit?: () => void,
   *   onfocus?: () => void,
   *   class?: string,
   *   testid?: string,
   *   minHeight?: string
   * }}
   */
  let {
    value = $bindable(''),
    customEmojiSets = [],
    placeholder = '',
    disabled = false,
    multiline = false,
    onSubmit = undefined,
    onfocus = undefined,
    class: className = '',
    testid = 'emoji-input',
    /** CSS length; when set, the multiline editor grows past the chat cap */
    minHeight = undefined
  } = $props();

  /** @type {HTMLDivElement | undefined} */
  let editor;
  /** what the DOM currently represents — plain let, bookkeeping only */
  let rendered = '';

  /** The open autocomplete, if any: `:query` (emoji) or `@query` (people). */
  let query = $state(
    /** @type {{ kind: 'emoji' | 'mention', start: number, query: string } | null} */ (null)
  );
  let highlight = $state(0);
  const getMentionCandidates = useMentionCandidates(() =>
    query?.kind === 'mention' ? query.query : null
  );
  const emojiCandidates = $derived(
    query?.kind === 'emoji' ? searchEmojis(query.query, customEmojiSets) : []
  );
  const mentionCandidates = $derived(query?.kind === 'mention' ? getMentionCandidates() : []);
  const candidateCount = $derived(
    query?.kind === 'emoji' ? emojiCandidates.length : mentionCandidates.length
  );
  /** urls of custom emojis handed to insert() — a pick from a pack the caller
   *  does not list (or removed since) must still render inline */
  let extraUrls = $state.raw(/** @type {Record<string, string>} */ ({}));
  /** shortcode → url of every custom emoji this input can render (plain
   *  object, rebuilt by $derived — never mutated) */
  const urlByShortcode = $derived.by(() => {
    /** @type {Record<string, string>} */
    const byShortcode = { ...extraUrls };
    for (const pack of customEmojiSets ?? []) {
      for (const emoji of pack.emojis ?? []) {
        if (!(emoji.shortcode in byShortcode)) byShortcode[emoji.shortcode] = emoji.url;
      }
    }
    return byShortcode;
  });

  const SHORTCODE_RE = /:([\w+-]+):/g;
  const BLOCK_TAGS = new Set(['DIV', 'P']);

  // ---- mention chips ------------------------------------------------------
  // A NIP-27 `nostr:npub…`/`nostr:nprofile…` token in the value renders as a
  // non-editable `@Name` chip; the value keeps the raw reference.
  const MENTION_RE = /nostr:((?:npub|nprofile)1[02-9ac-hj-np-z]+)/g;
  /** Profiles for every mention in the value; chips get their label from here. */
  const getProfiles = useProfileMap(() => mentionPubkeysIn(value));
  /** Profiles handed over by a pick so the chip never flashes the hex label. */
  let seededProfiles = $state.raw(/** @type {Record<string, any>} */ ({}));

  /** @param {string} bech32 @returns {string | null} hex pubkey, or null when not a profile pointer */
  function mentionPubkey(bech32) {
    try {
      const decoded = nip19.decode(bech32);
      if (decoded.type === 'npub') return decoded.data;
      if (decoded.type === 'nprofile') return decoded.data.pubkey;
    } catch {
      /* not a valid pointer — stays text */
    }
    return null;
  }
  /** @param {string} pubkey */
  function chipLabel(pubkey) {
    const profile = getProfiles().get(pubkey) ?? seededProfiles[pubkey];
    if (profile?.display_name || profile?.name) return `@${getUserDisplayName(pubkey, profile)}`;
    return `@${pubkey.slice(0, 8)}`;
  }
  /** @param {string} ref bech32 @param {string} pubkey hex */
  function createChip(ref, pubkey) {
    const chip = document.createElement('span');
    chip.dataset.mention = pubkey;
    chip.dataset.ref = ref;
    chip.setAttribute('contenteditable', 'false');
    chip.className = 'badge mx-px align-baseline badge-ghost badge-sm';
    chip.textContent = chipLabel(pubkey);
    return chip;
  }

  /**
   * @typedef {{ type: 'text', text: string }
   *   | { type: 'emoji', shortcode: string, url: string }
   *   | { type: 'mention', ref: string, pubkey: string }} Piece
   */
  /**
   * Split one line into text / emoji / mention pieces, in order.
   * @param {string} line
   * @returns {Piece[]}
   */
  function tokenizeLine(line) {
    /** @type {Array<{ at: number, len: number, piece: Piece }>} */
    const hits = [];
    for (const match of line.matchAll(SHORTCODE_RE)) {
      const url = urlByShortcode[match[1]];
      if (!url) continue;
      hits.push({
        at: /** @type {number} */ (match.index),
        len: match[0].length,
        piece: { type: 'emoji', shortcode: match[1], url }
      });
    }
    for (const match of line.matchAll(MENTION_RE)) {
      const pubkey = mentionPubkey(match[1]);
      if (!pubkey) continue;
      hits.push({
        at: /** @type {number} */ (match.index),
        len: match[0].length,
        piece: { type: 'mention', ref: match[1], pubkey }
      });
    }
    hits.sort((a, b) => a.at - b.at);
    /** @type {Piece[]} */
    const out = [];
    let last = 0;
    for (const hit of hits) {
      if (hit.at < last) continue; // overlapping match — keep the earlier one
      if (hit.at > last) out.push({ type: 'text', text: line.slice(last, hit.at) });
      out.push(hit.piece);
      last = hit.at + hit.len;
    }
    if (last < line.length) out.push({ type: 'text', text: line.slice(last) });
    return out;
  }

  // ---- DOM → string ---------------------------------------------------
  /** @param {Node} node */
  function serializeNode(node) {
    let out = '';
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        out += /** @type {Text} */ (child).data;
      } else if (child.nodeName === 'BR') {
        out += '\n';
      } else if (child.nodeName === 'IMG') {
        const sc = /** @type {HTMLElement} */ (child).dataset.shortcode;
        out += sc ? `:${sc}:` : '';
      } else if (child.nodeName === 'SPAN' && /** @type {HTMLElement} */ (child).dataset.ref) {
        out += `nostr:${/** @type {HTMLElement} */ (child).dataset.ref}`;
      } else {
        if (out && !out.endsWith('\n') && BLOCK_TAGS.has(child.nodeName)) out += '\n';
        out += serializeNode(child);
      }
    }
    return out;
  }
  /** serialized length of one editor child @param {Node} child */
  function nodeLength(child) {
    if (child.nodeType === Node.TEXT_NODE) return /** @type {Text} */ (child).data.length;
    if (child.nodeName === 'BR') return 1;
    if (child.nodeName === 'IMG') {
      const sc = /** @type {HTMLElement} */ (child).dataset.shortcode;
      return sc ? sc.length + 2 : 0;
    }
    if (child.nodeName === 'SPAN' && /** @type {HTMLElement} */ (child).dataset.ref) {
      return (
        'nostr:'.length +
        /** @type {string} */ (/** @type {HTMLElement} */ (child).dataset.ref).length
      );
    }
    return serializeNode(child).length;
  }
  function serializeEditor() {
    return editor ? serializeNode(editor).replace(/\n$/, '') : '';
  }

  // ---- string → DOM ---------------------------------------------------
  // The editor's children are owned by this function, never by the template
  // (the <div> below is rendered empty), so Svelte's runtime has nothing to
  // get confused about — a contenteditable IS direct DOM manipulation.
  /* eslint-disable svelte/no-dom-manipulating */
  /** @param {string} text */
  function renderValue(text) {
    if (!editor) return;
    editor.replaceChildren();
    const lines = text.split('\n');
    lines.forEach((line, lineIndex) => {
      if (lineIndex > 0) editor?.appendChild(document.createElement('br'));
      for (const piece of tokenizeLine(line)) {
        if (piece.type === 'text') {
          editor?.appendChild(document.createTextNode(piece.text));
        } else if (piece.type === 'emoji') {
          const img = document.createElement('img');
          img.src = piece.url;
          img.alt = `:${piece.shortcode}:`;
          img.dataset.shortcode = piece.shortcode;
          img.draggable = false;
          img.setAttribute('contenteditable', 'false');
          img.className = 'mx-px inline h-5 w-5 object-contain align-text-bottom';
          editor?.appendChild(img);
        } else {
          editor?.appendChild(createChip(piece.ref, piece.pubkey));
        }
      }
    });
  }
  /* eslint-enable svelte/no-dom-manipulating */

  // ---- caret in serialized coordinates ----------------------------------
  /** serialized offset of a DOM point inside the editor @param {Node} node @param {number} offset */
  function offsetOf(node, offset) {
    if (!editor) return 0;
    const range = document.createRange();
    range.setStart(editor, 0);
    range.setEnd(node, offset);
    return serializeNode(range.cloneContents()).length;
  }
  function caretOffset() {
    const sel = typeof window === 'undefined' ? null : window.getSelection();
    if (
      !editor ||
      !sel ||
      sel.rangeCount === 0 ||
      !sel.focusNode ||
      !editor.contains(sel.focusNode)
    ) {
      return serializeEditor().length;
    }
    return offsetOf(sel.focusNode, sel.focusOffset);
  }
  /** Current selection in value coordinates (collapsed = caret). */
  export function getSelection() {
    const sel = typeof window === 'undefined' ? null : window.getSelection();
    if (
      !editor ||
      !sel ||
      sel.rangeCount === 0 ||
      !sel.anchorNode ||
      !sel.focusNode ||
      !editor.contains(sel.anchorNode) ||
      !editor.contains(sel.focusNode)
    ) {
      const end = serializeEditor().length;
      return { start: end, end };
    }
    const a = offsetOf(sel.anchorNode, sel.anchorOffset);
    const f = offsetOf(sel.focusNode, sel.focusOffset);
    return { start: Math.min(a, f), end: Math.max(a, f) };
  }
  /**
   * Replace a value range (toolbar path: wrap the selection in markdown).
   * @param {number} start @param {number} end @param {string} text @param {number} [caret]
   */
  export function replaceRange(start, end, text, caret = start + text.length) {
    void commit(value.slice(0, start) + text + value.slice(end), caret);
  }
  /** @param {number} offset */
  function setCaret(offset) {
    const sel = typeof window === 'undefined' ? null : window.getSelection();
    if (!editor || !sel) return;
    let remaining = offset;
    const children = Array.from(editor.childNodes);
    for (const child of children) {
      const len = nodeLength(child);
      if (child.nodeType === Node.TEXT_NODE && remaining <= len) {
        sel.collapse(child, remaining);
        return;
      }
      if (remaining <= len) {
        sel.collapse(editor, children.indexOf(child) + 1);
        return;
      }
      remaining -= len;
    }
    sel.collapse(editor, children.length);
  }

  // ---- sync -------------------------------------------------------------
  $effect(() => {
    // external change (initial value, parent clearing the draft, a pick)
    const next = value;
    if (next !== rendered) {
      renderValue(next);
      rendered = next;
    }
  });

  // Profile names arrive after the chip rendered: patch the label in place
  // (never re-render — the caret must not move while the user types).
  $effect(() => {
    void getProfiles();
    void seededProfiles;
    if (!editor) return;
    for (const chip of editor.querySelectorAll('span[data-mention]')) {
      const pubkey = /** @type {string} */ (/** @type {HTMLElement} */ (chip).dataset.mention);
      const label = chipLabel(pubkey);
      if (chip.textContent !== label) chip.textContent = label;
    }
  });

  function onInput() {
    rendered = serializeEditor();
    value = rendered;
    refreshQuery();
  }
  const NAV_KEYS = new Set(['ArrowDown', 'ArrowUp', 'Tab', 'Enter', 'Escape']);

  /**
   * Re-detect the trigger at the caret: `:query` (emoji) or `@query`
   * (people). Should both match, the trigger nearest the caret wins. The
   * highlight only resets when the query itself changed — a caret-only
   * event (keyup, click) must not snap a selection made with the arrow keys
   * back to the top (laoc, 2026-09-18).
   */
  function refreshQuery() {
    const caret = caretOffset();
    const emoji = detectEmojiQuery(value, caret);
    const mention = detectMentionQuery(value, caret);
    /** @type {typeof query} */
    let next = null;
    if (emoji && (!mention || emoji.start > mention.start)) next = { kind: 'emoji', ...emoji };
    else if (mention) next = { kind: 'mention', ...mention };
    const same =
      !!next &&
      !!query &&
      next.kind === query.kind &&
      next.start === query.start &&
      next.query === query.query;
    query = next;
    if (!same) highlight = 0;
  }
  /** @param {KeyboardEvent} event */
  function onKeyup(event) {
    if (NAV_KEYS.has(event.key)) return; // handled on keydown, caret unchanged
    refreshQuery();
  }
  /** @param {string} nextText @param {number} caret */
  async function commit(nextText, caret) {
    query = null;
    value = nextText;
    renderValue(nextText);
    rendered = nextText;
    await tick();
    editor?.focus();
    setCaret(caret);
  }
  /** @param {import('$lib/helpers/emoji-autocomplete.js').EmojiHit} hit */
  function pickEmoji(hit) {
    if (!query) return;
    const inserted = hit.type === 'custom' ? `:${hit.shortcode}:` : hit.char;
    const result = applyEmoji(value, query.start, caretOffset(), inserted);
    void commit(result.text, result.caret);
  }
  /** @param {string} pubkey */
  function pickMention(pubkey) {
    if (!query) return;
    const candidate = mentionCandidates.find((c) => c.pubkey === pubkey);
    if (candidate?.profile) seededProfiles = { ...seededProfiles, [pubkey]: candidate.profile };
    const result = applyMention(value, query.start, caretOffset(), nip19.npubEncode(pubkey));
    void commit(result.text, result.caret);
  }

  /**
   * Picker path: insert a unicode emoji or a custom emoji at the caret.
   * @param {string | { shortcode: string, url: string }} emoji
   */
  export function insert(emoji) {
    const inserted = typeof emoji === 'string' ? emoji : `:${emoji.shortcode}:`;
    if (typeof emoji !== 'string' && !(emoji.shortcode in urlByShortcode)) {
      extraUrls = { ...extraUrls, [emoji.shortcode]: emoji.url };
    }
    const caret = caretOffset();
    // glued to a word ("hey:cat:") reads badly and some renderers will not
    // even see the shortcode — separate it like a typed word would be
    const lead = caret > 0 && !/\s/.test(value[caret - 1]) ? ' ' : '';
    const result = applyEmoji(value, caret, caret, lead + inserted);
    void commit(result.text, result.caret);
  }
  export function focus() {
    editor?.focus();
  }

  /** @param {KeyboardEvent} event */
  function onKeydown(event) {
    if (query && candidateCount > 0) {
      const n = candidateCount;
      if (event.key === 'ArrowDown' || (event.key === 'Tab' && !event.shiftKey)) {
        event.preventDefault();
        highlight = (highlight + 1) % n;
        return;
      }
      if (event.key === 'ArrowUp' || (event.key === 'Tab' && event.shiftKey)) {
        event.preventDefault();
        highlight = (highlight - 1 + n) % n;
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        if (query.kind === 'emoji') pickEmoji(emojiCandidates[highlight]);
        else pickMention(mentionCandidates[highlight].pubkey);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        query = null;
        return;
      }
    }
    if (event.key === 'Enter' && !event.isComposing) {
      if (multiline && event.shiftKey) return; // newline
      event.preventDefault();
      onSubmit?.();
    }
  }
  /** @param {ClipboardEvent} event */
  function onPaste(event) {
    event.preventDefault();
    const text = event.clipboardData?.getData('text/plain') ?? '';
    if (!text) return;
    const caret = caretOffset();
    const nextText = value.slice(0, caret) + text + value.slice(caret);
    void commit(nextText, caret + text.length);
  }
</script>

<div class="relative min-w-0 flex-1">
  {#if query?.kind === 'mention'}
    <MentionAutocomplete
      candidates={mentionCandidates}
      highlightIndex={highlight}
      onSelect={pickMention}
    />
  {:else}
    <EmojiAutocomplete
      candidates={emojiCandidates}
      highlightIndex={highlight}
      onSelect={pickEmoji}
    />
  {/if}
  <div
    bind:this={editor}
    class="emoji-input min-w-0 break-words whitespace-pre-wrap focus:outline-none {multiline
      ? minHeight
        ? 'overflow-y-auto'
        : 'max-h-40 overflow-y-auto'
      : 'overflow-hidden whitespace-nowrap'} {className}"
    style={minHeight ? `min-height: ${minHeight}` : undefined}
    contenteditable={!disabled}
    role="textbox"
    aria-disabled={disabled}
    aria-multiline={multiline}
    aria-placeholder={placeholder}
    data-placeholder={placeholder}
    data-testid={testid}
    tabindex="0"
    enterkeyhint={multiline ? undefined : 'send'}
    oninput={onInput}
    onkeyup={onKeyup}
    onclick={refreshQuery}
    onkeydown={onKeydown}
    onpaste={onPaste}
    onfocus={() => onfocus?.()}
  ></div>
</div>

<style>
  .emoji-input:empty::before {
    content: attr(data-placeholder);
    opacity: 0.5;
    pointer-events: none;
  }
</style>
