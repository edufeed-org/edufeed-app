<!--
  EmojiInput — the chat composer's text field with Slack-style emoji
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
  import { detectEmojiQuery, searchEmojis, applyEmoji } from '$lib/helpers/emoji-autocomplete.js';
  import EmojiAutocomplete from './EmojiAutocomplete.svelte';

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
   *   testid?: string
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
    testid = 'emoji-input'
  } = $props();

  /** @type {HTMLDivElement | undefined} */
  let editor;
  /** what the DOM currently represents — plain let, bookkeeping only */
  let rendered = '';

  let query = $state(/** @type {{ start: number, query: string } | null} */ (null));
  let highlight = $state(0);
  const candidates = $derived(query ? searchEmojis(query.query, customEmojiSets) : []);
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
      let last = 0;
      for (const match of line.matchAll(SHORTCODE_RE)) {
        const url = urlByShortcode[match[1]];
        if (!url) continue;
        const at = /** @type {number} */ (match.index);
        if (at > last) editor?.appendChild(document.createTextNode(line.slice(last, at)));
        const img = document.createElement('img');
        img.src = url;
        img.alt = match[0];
        img.dataset.shortcode = match[1];
        img.draggable = false;
        img.setAttribute('contenteditable', 'false');
        img.className = 'mx-px inline h-5 w-5 object-contain align-text-bottom';
        editor?.appendChild(img);
        last = at + match[0].length;
      }
      if (last < line.length) editor?.appendChild(document.createTextNode(line.slice(last)));
    });
  }
  /* eslint-enable svelte/no-dom-manipulating */

  // ---- caret in serialized coordinates ----------------------------------
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
    const range = document.createRange();
    range.setStart(editor, 0);
    range.setEnd(sel.focusNode, sel.focusOffset);
    return serializeNode(range.cloneContents()).length;
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

  function onInput() {
    rendered = serializeEditor();
    value = rendered;
    refreshQuery();
  }
  function refreshQuery() {
    query = detectEmojiQuery(value, caretOffset());
    highlight = 0;
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
  function pick(hit) {
    if (!query) return;
    const inserted = hit.type === 'custom' ? `:${hit.shortcode}:` : hit.char;
    const result = applyEmoji(value, query.start, caretOffset(), inserted);
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
    if (query && candidates.length > 0) {
      const n = candidates.length;
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
        pick(candidates[highlight]);
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
  <EmojiAutocomplete {candidates} highlightIndex={highlight} onSelect={pick} />
  <div
    bind:this={editor}
    class="emoji-input min-w-0 break-words whitespace-pre-wrap focus:outline-none {multiline
      ? 'max-h-40 overflow-y-auto'
      : 'overflow-hidden whitespace-nowrap'} {className}"
    contenteditable={!disabled}
    role="textbox"
    aria-multiline={multiline}
    aria-placeholder={placeholder}
    data-placeholder={placeholder}
    data-testid={testid}
    tabindex="0"
    enterkeyhint={multiline ? undefined : 'send'}
    oninput={onInput}
    onkeyup={refreshQuery}
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
