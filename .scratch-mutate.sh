#!/usr/bin/env bash
# Mutation battery for the chat markdown lane.
#
# Rules learned the hard way and encoded here:
#  - refuse to start on a dirty tree (this script has deleted uncommitted
#    fixes five times by restoring over them)
#  - restore ONLY the files it mutated, never `git checkout -- src`
#  - assert the patch actually LANDED before believing a row's verdict
#  - assert tests actually RAN; a zero-test run reports as "survived"
set -uo pipefail
cd "$(dirname "$0")"

HELPER=src/lib/helpers/chatMarkdown.js
COMP=src/lib/components/shared/NostrContentRenderer.svelte
ROW=src/lib/components/chat/ChatMessageRow.svelte
FILES=("$HELPER" "$COMP" "$ROW")

SPECS="src/lib/helpers/__tests__/chatMarkdown.test.js \
src/lib/components/shared/__tests__/NostrContentRenderer.markdown.test.js \
src/lib/components/shared/__tests__/NostrContentRenderer.test.js \
src/lib/components/chat/__tests__/ChatMessageRow.markdown.test.js"

if [ -n "$(git status --porcelain -- "${FILES[@]}")" ]; then
  echo "REFUSING: mutation targets are dirty. Commit first."
  exit 2
fi

restore() { git checkout -- "${FILES[@]}"; }
trap restore EXIT

set -a; . ./.env; set +a

pass=0; caught=0; survived=0; broken=0

run_row() {
  local label="$1" file="$2" from="$3" to="$4"
  python3 - "$file" "$from" "$to" <<'PY'
import sys
path, frm, to = sys.argv[1], sys.argv[2], sys.argv[3]
s = open(path).read()
n = s.count(frm)
if n != 1:
    print(f"ANCHOR_COUNT={n}")
    sys.exit(9)
open(path, 'w').write(s.replace(frm, to))
PY
  local rc=$?
  if [ $rc -ne 0 ]; then
    echo "BROKEN  $label — anchor did not match exactly once"
    broken=$((broken+1)); restore; return
  fi
  # The patch must be visible in the diff, or the row measured nothing.
  if [ -z "$(git diff --numstat -- "$file")" ]; then
    echo "BROKEN  $label — patch did not land"
    broken=$((broken+1)); restore; return
  fi

  local out; out=$(npx vitest run $SPECS 2>&1)
  local total; total=$(echo "$out" | grep -oE '^\s+Tests .*' | head -1)
  local ran; ran=$(echo "$out" | grep -coE '^\s+(✓|×)')

  if ! echo "$total" | grep -qE '[0-9]+ passed'; then
    echo "BROKEN  $label — suite reported no tests (collect error?) [ran=$ran]"
    broken=$((broken+1)); restore; return
  fi
  if echo "$total" | grep -q 'failed'; then
    echo "CAUGHT  $label — $(echo "$total" | xargs)"
    caught=$((caught+1))
  else
    echo "SURVIVED $label — $(echo "$total" | xargs)"
    survived=$((survived+1))
  fi
  restore
}

echo "=== helper: chatMarkdown.js ==="
run_row "safeHref accepts any scheme" "$HELPER" \
  'if (!SAFE_SCHEMES.includes(url.protocol)) return null;' \
  'if (false) return null;'
run_row "safeHref allows protocol-relative" "$HELPER" \
  "if (href.startsWith('/') && !href.startsWith('//')) return href;" \
  "if (href.startsWith('/')) return href;"
run_row "gfm autolinking re-enabled" "$HELPER" \
  '.use({
  tokenizer: {
    url() {
      return undefined;
    }
  }
});' \
  ';'
run_row "br breaks the coalesced run" "$HELPER" \
  "      case 'br':
        pending.push('\\n');
        continue;" \
  "      case 'br':
        flush();
        continue;"
run_row "fence keeps raw not text" "$HELPER" \
  "return { type: 'code', lang: token.lang || null, text: token.text };" \
  "return { type: 'code', lang: token.lang || null, text: token.raw };"
run_row "codespan keeps its backticks" "$HELPER" \
  "out.push({ type: 'codespan', text: token.text });" \
  "out.push({ type: 'codespan', text: token.raw });"
run_row "trailing text run never flushed" "$HELPER" \
  "  flush();
  return out;
}" \
  "  return out;
}"
run_row "image degrades to raw not href" "$HELPER" \
  "      case 'image':
        out.push(nostrRun(token.href ?? ''));" \
  "      case 'image':
        out.push(nostrRun(token.raw ?? ''));"
run_row "blockquote loses its children" "$HELPER" \
  "return { type: 'blockquote', children: blocksFrom(token.tokens ?? [], nostrRun) };" \
  "return { type: 'blockquote', children: [] };"
run_row "list ordered flag inverted" "$HELPER" \
  'ordered: !!token.ordered,' \
  'ordered: !token.ordered,'
run_row "unsupported block no longer literal" "$HELPER" \
  "      return { type: 'paragraph', children: [nostrRun(token.raw ?? '')] };" \
  "      return null;"

echo "=== component: NostrContentRenderer.svelte ==="
run_row "markdown prop defaults on" "$COMP" \
  "depth = 0, markdown = false } = \$props();" \
  "depth = 0, markdown = true } = \$props();"
run_row "flatNodes ignores markdown nodes" "$COMP" \
  'const flatNodes = $derived(markdown ? (md?.nodes ?? []) : (tree?.children ?? []));' \
  'const flatNodes = $derived(tree?.children ?? []);'
run_row "run offset dropped" "$COMP" \
  '{@render nodeRun(child.nodes, child.offset)}' \
  '{@render nodeRun(child.nodes, 0)}'
run_row "explicit line break removed" "$COMP" \
  '{#if l > 0}<br />{/if}{line}' \
  '{line}'
run_row "markdown link loses its classes" "$COMP" \
  '<a href={child.href} target="_blank" rel="noopener noreferrer" class="link link-primary"' \
  '<a href={child.href} target="_blank" rel="noopener noreferrer"'
run_row "strong renders as plain text" "$COMP" \
  '<strong>{@render inlineList(child.children)}</strong>' \
  '{@render inlineList(child.children)}'
run_row "codespan renders as plain text" "$COMP" \
  '<code class="rounded bg-base-300/60 px-1 py-0.5 text-xs">{child.text}</code>' \
  '{child.text}'
run_row "fenced block renders as plain text" "$COMP" \
  '<pre class="my-1 overflow-x-auto rounded bg-base-300/60 p-2 text-xs text-base-content"><code
          >{block.text}</code
        ></pre>' \
  '{block.text}'
run_row "whitespace-pre-wrap kept in markdown mode" "$COMP" \
  "class=\"{className} break-words {markdown ? '' : 'whitespace-pre-wrap'}\"" \
  'class="{className} break-words whitespace-pre-wrap"'

echo "=== caller: ChatMessageRow.svelte ==="
run_row "chat stops asking for markdown" "$ROW" \
  '<NostrContentRenderer event={message} markdown />' \
  '<NostrContentRenderer event={message} />'

echo
echo "caught=$caught survived=$survived broken=$broken"
