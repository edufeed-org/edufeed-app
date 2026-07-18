NIP-101-EDU
===========

Educational form templates and responses
-----------------------------------------

`draft` `optional`

This document specifies edufeed's implementation of NIP-101 ("Forms" — draft
[nostr-protocol/nips#1190](https://github.com/nostr-protocol/nips/pull/1190),
spec text at the `nostr-form` branch of `abh3po/nips`, `101.md`) plus a small
set of additive extension tags that let a form template drive submission
straight into a kind 30142 (AMB) educational resource, and bind form fields
to SKOS-controlled vocabularies (kind 39737/39738, NIP-VOCAB).

It reuses NIP-101's base event kinds and tag layout unmodified:

- kind `30168` — form template (parameterized replaceable)
- kind `1069` — form response

`1070` (form request, peer-to-peer form sending) is defined in the base spec
and present in the edufeed codebase (`FORM_REQUEST_KIND`), but is out of
scope for this document.

### Relationship to NIP-101 and scope of this extension

NIP-101's base layer — the `d`/`name`/`settings` template tags, the `field`
tag layout, and the plain-tag response encoding — is adopted **as-is**. This
document only specifies:

1. Extension tags (`field-vocab`, `field-output`, `a ... forkOf`) that a
   base NIP-101 client does not need to understand.
2. Two `settings.sections` / `displayIf` / `nextSection` mechanisms for
   multi-page, conditionally-branching forms (Formstr-compatible schema).
3. How a filled-in form is turned into a kind 30142 AMB resource.

**Formstr's private-form key apparatus — per-form view/signing keypairs,
gift-wrapped distribution of those keys, and alias pubkeys for anonymous
responses — is deliberately not implemented.** Non-public forms in edufeed
are encrypted with NIP-44 directly between the responder's real signer and
the form author's real pubkey (see [Responses](#responses)); there are no
view keys, no signing keys distinct from the account key, and no gift wraps
in this implementation.

Everything edufeed adds is either a new tag (ignored by conformant NIP-101
clients) or a new key inside the existing `settings`/field-settings JSON
blobs (ignored by any JSON consumer that only reads the keys it knows). A
plain NIP-101 client can therefore render and collect responses for an
edufeed form; it will simply not offer vocabulary lookups, AMB emission, or
section branching.

Base conformance
-----------------

A form template is a kind `30168` event. Tag positions, verbatim from
`buildFormTemplateTags` / `parseFormTemplate`
(`src/lib/helpers/forms/format.js`):

```
["d", "<dTag>"]
["name", "<name>"]                    // omitted when empty
["settings", "<JSON>"]                // MUST be present (marks NIP-101 encoding)
["field", "<id>", "<inputType>", "<label>", "<optionsJSON>", "<fieldSettingsJSON>"]
```

one `field` tag per question. `inputType` is `"option"` when the field's
rich type is `select` or `radio` **and** the field has no vocabulary
binding; otherwise `"text"`.

`optionsJSON` is `JSON.stringify` of an array of option pairs or triples —
`"[]"` for non-option fields:

```json
[["cc-by", "CC BY 4.0"], ["cc-by-sa", "CC BY-SA 4.0", "{\"nextSection\":\"licensing-done\"}"]]
```

- A **pair** is `[optionId, label]`.
- A **triple** adds a third element: a JSON-stringified object, currently
  only ever `{"nextSection": "<sectionId>"}` (see
  [`nextSection`](#nextsection-option-routing)).

`fieldSettingsJSON` is `JSON.stringify` of the field's settings object with
its `options` array (the option list above) stripped out, plus:

- `renderElement` — edufeed's rich field type (`text | textarea |
  text-array | number | email | url | select | checkbox | radio | date`).
  This widens NIP-101's implicit `text`/`option` split for rendering; base
  clients that only understand `t[2]` (`"text"`/`"option"`) still work.
- `defaultValue` — carried inside the settings object rather than as a
  positional tag element (base NIP-101 puts it at `t[4]`; edufeed's
  `settings`-tagged encoding does not use a positional `defaultValue` slot).
- optionally `displayIf` — see [`displayIf`](#displayif-conditional-visibility).
- any other field option (`required`, `placeholder`, `min`, `max`,
  `multiple`, `allowCustom`, `customLabel`, `customButtonLabel`,
  `customPlaceholder`, `pattern`, …) passed through unchanged.

The `settings` tag's JSON value carries template-level configuration:

| key                   | type            | meaning                                        |
| --------------------- | --------------- | ---------------------------------------------- |
| `description`         | string          | template description                           |
| `publicForm`          | boolean         | `true` if responses are submitted in cleartext |
| `confirmationMessage` | string          | shown to the responder after submit            |
| `autoResponse`        | boolean         | reserved for auto-acknowledgement behavior     |
| `sections`            | `FormSection[]` | see [Sections](#sections)                      |

Keys are omitted from the JSON object when empty/false — the parser treats
a missing key the same as its falsy default.

All edufeed additions described below (`field-vocab`, `field-output`,
`a ... forkOf`, `sections`, `displayIf`, `nextSection`) are additive tags or
additive JSON keys layered on top of this base encoding — a conformant
NIP-101 client that does not recognize them will still parse `d`, `name`,
`settings`, and every `field` tag correctly.

### Example: minimal template event

```json
{
  "kind": 30168,
  "pubkey": "3f770d65...abcd",
  "created_at": 1752700000,
  "tags": [
    ["d", "workshop-feedback"],
    ["name", "Workshop Feedback"],
    ["settings", "{\"description\":\"Tell us how the session went.\",\"publicForm\":true}"],
    ["field", "rating", "option", "Overall rating", "[[\"1\",\"Poor\"],[\"5\",\"Excellent\"]]", "{\"renderElement\":\"radio\",\"required\":true}"],
    ["field", "comments", "text", "Additional comments", "[]", "{\"renderElement\":\"textarea\"}"]
  ],
  "content": ""
}
```

**Legacy note:** a 30168 event *without* a `settings` tag is parsed via a
transitional pre-NIP-101 dialect (positional `defaultValue`/`options` tag
slots, discrete `description`/`public`/`confirmation_message`/
`auto_response` tags) that predates this spec. It is not itself specified
here — new templates MUST always include the `settings` tag.

`field-vocab`: SKOS scheme binding
------------------------------------

A field MAY be bound to a SKOS concept scheme (kind `39737`, NIP-VOCAB) so
the renderer offers a controlled-vocabulary lookup instead of free text:

```
["field-vocab", "<fieldId>", "a", "39737:<schemePubkey>:<schemeDTag>", "<relay>"]
```

- `t[1]` — the `field` tag's `id` this binding applies to.
- `t[2]` — literal `"a"`, marking `t[3]` as an addressable-event coordinate.
- `t[3]` — the kind-39737 `ConceptScheme` coordinate `39737:<pubkey>:<d>`.
- `t[4]` — relay hint for resolving the scheme.

When a field carries a `field-vocab` tag it is **never** an `"option"`
field on the wire (`inputType` is always `"text"` for vocab-bound fields,
even though the renderer shows a picker) — its answer values are concept
external URIs (the `id` of a kind `39738` `Concept` under that scheme, per
NIP-VOCAB v0.2), not the scheme's own coordinate. A form MAY bind multiple
fields to the same or different schemes.

`field-output` and event composition
--------------------------------------

```
["field-output", "<fieldId>", "amb:<property>" | "ext"]
```

Declares where a field's answer lands when a response is turned into a
kind 30142 AMB resource (`buildAMBResourceTags` /
`src/lib/helpers/form-to-amb.js`):

- **`amb:<property>`** — the answer is emitted under the named top-level
  AMB/DC-derived property. The `amb:` prefix is a `field-output` namespace
  marker only and is **stripped before emission**: the tag key on the
  kind 30142 event is the bare `<property>` (e.g. `field-output` value
  `amb:name` → tag key `name`; `amb:learningResourceType` → tag key
  `learningResourceType`).
- **`ext`** — the answer is emitted as a namespaced extension tag scoped to
  this specific form, so unrelated forms/apps never collide on the same
  tag key: `ext:<formCoord>:<fieldId>` where `formCoord` is
  `30168:<formAuthorPubkey>:<formDTag>`.
- When a field has **no** `field-output` tag, it defaults to `amb:<fieldId>`
  (the field's own id used as the AMB property name — so the emitted tag
  key is the bare field id).

**Concept-valued fields** (bound via `field-vocab`) emit a `:id`/
`:prefLabel:<lang>`/`:type` tag triad per selected concept, plus an `a` tag
pointing at the concept's own addressable coordinate:

```
["<keyBase>:id", "<conceptExternalUri>"]
["<keyBase>:prefLabel:<lang>", "<label>"]        // one per known language
["<keyBase>:type", "Concept"]
["a", "<39738 concept coordinate>", "<relay>", "<role>"]
```

where `keyBase` is `<property>` for `amb:` output or `ext:<formCoord>:<fieldId>`
for `ext` output, and `role` on the `a` tag mirrors that same key
(`<property>` or `ext:<fieldId>`).

**Scalar fields** (everything without a `field-vocab` binding — vocab
fields always take the concept branch above and never reach scalar
emission) are emitted as one flat tag per value under `keyBase`.
Option-field values (radio/select) are resolved from the wire's optionId
back to the option's **label** before emission — the AMB resource carries
human-readable labels, never internal optionIds. Multi-value answers (a
`";"`-joined optionId string, or a real array for `text-array` fields)
are split/expanded into one tag per value.

The resource carries an informative back-reference to the form that
produced it (`a` tag, role `form`, MAY per NIP-101 base — always emitted
by this implementation):

```
["a", "30168:<formAuthorPubkey>:<formDTag>", "<relay>", "form"]
```

Note: the app-wide NIP-32 `["L","metadata-form"]` / `["l", <variantId>,
"metadata-form"]` labels used by the built-in "Share Learning Resource"
wizard (`ResourceFormWizard`, see project docs) are a **separate**
mechanism for that wizard's own resource-form-variant registry. Kind 30142
events produced from a NIP-101 form template (this spec) do not carry
those labels — provenance for form-produced resources is established
solely via the `form`-role `a` tag above.

### Example: response → AMB resource

Given a "rating" field with `field-output = amb:learningResourceType` bound
via `field-vocab` to a HCRT scheme, and answer concept
`https://w3id.org/kim/hcrt/worksheet` selected:

```json
{
  "kind": 30142,
  "tags": [
    ["d", "9c1e2a..."],
    ["learningResourceType:id", "https://w3id.org/kim/hcrt/worksheet"],
    ["learningResourceType:prefLabel:de", "Arbeitsblatt"],
    ["learningResourceType:prefLabel:en", "Worksheet"],
    ["learningResourceType:type", "Concept"],
    ["a", "39738:2b3c...:hcrt-worksheet", "wss://amb.edufeed.org", "learningResourceType"],
    ["ext:30168:3f770d65...abcd:workshop-feedback:comments", "Really enjoyed the session"],
    ["a", "30168:3f770d65...abcd:workshop-feedback", "wss://relay.edufeed.org", "form"]
  ],
  "content": ""
}
```

Sections
--------

`settings.sections` groups a template's fields into ordered pages
(Formstr's merged section shape):

```
FormSection = {
  id: string,
  title: string,
  description?: string,
  questionIds: string[],
  order?: number
}
```

Sections are sorted by `order`, falling back to array index when `order`
is absent. Any field id not assigned to a section (`questionIds` union
across all sections) is collected into a trailing implicit `__rest`
section — templates with sections MUST still function if a field is
omitted from every explicit section's `questionIds`. Templates with no
`settings.sections` entries have no sections; consuming renderers fall
back to a single-page layout.

`displayIf`: conditional visibility
--------------------------------------

A field's settings MAY carry `displayIf: { rules: ConditionGroup[] }`,
evaluated against the current answers map to decide whether the field is
shown:

```
ConditionGroup = {
  questionId?: string,
  value?: string | string[],
  operator?: 'equals' | 'notEquals' | 'contains' | 'startsWith' | 'endsWith'
           | 'greaterThan' | 'lessThan' | 'greaterThanEqual' | 'lessThanEqual',
  nextLogic?: 'AND' | 'OR',
  rules?: ConditionGroup[]
}
```

- A rule with a nested non-empty `rules` array is a **group**: it recurses
  and ignores its own `questionId`/`value`/`operator`.
- A rule without nested `rules` is a **leaf**: it compares the string form
  of `values[questionId]` against `value` (arrays are joined with `";"`
  before comparison) using `operator` (default `equals`).
- An unanswered question (`undefined`/`null`/`""`) makes the leaf
  evaluate to `false` unconditionally.
- Sibling rules in the same `rules` array chain left-to-right: each rule's
  own `nextLogic` (default `AND`) joins it to the **next** rule in the
  array, not the previous one. `[]`/absent `rules` evaluates to `true`
  (field always shown).
- `contains` has two behaviors depending on the shape of the answer: if
  the answer contains a `";"` (i.e. it is a multi-select optionId-joined
  string), `contains` requires **exact membership** — `expected` must be
  one of the `";"`-split parts. Otherwise it falls back to plain substring
  containment on the raw string. This lets `contains` be used both for "is
  this option among the selected ones" on a multi-select and "does this
  free-text answer mention X".
- Numeric operators (`greaterThan`/`lessThan`/`greaterThanEqual`/
  `lessThanEqual`) coerce both sides with `Number(...)`.

### `nextSection`: option routing

An option (radio/select) field's option MAY carry `nextSection` (see the
option triple in [Base conformance](#base-conformance)) to route the
responder to a specific section instead of the next one in document order:

- On leaving a section, each of its `questionIds` is checked in order for
  an answered option field whose *selected* option has a `nextSection`
  pointing at a section id that exists in the template. The first match
  wins.
- If no field in the current section has a matching routing rule, the
  next section in `order` is used.
- After the last section, there is no next section (routing returns
  `null`).

### Worked example: Bildungsbereich routing

A form asks which education sector ("Bildungsbereich") the responder works
in, then branches to sector-specific questions:

```json
{
  "kind": 30168,
  "tags": [
    ["d", "sector-survey"],
    ["settings", "{\"sections\":[{\"id\":\"start\",\"title\":\"Start\",\"questionIds\":[\"sector\"],\"order\":0},{\"id\":\"schule\",\"title\":\"Schule\",\"questionIds\":[\"school_type\"],\"order\":1},{\"id\":\"hochschule\",\"title\":\"Hochschule\",\"questionIds\":[\"faculty\"],\"order\":2},{\"id\":\"done\",\"title\":\"Danke\",\"questionIds\":[],\"order\":3}]}"],
    ["field", "sector", "option", "Bildungsbereich",
      "[[\"schule\",\"Schule\",\"{\\\"nextSection\\\":\\\"schule\\\"}\"],[\"hochschule\",\"Hochschule\",\"{\\\"nextSection\\\":\\\"hochschule\\\"}\"]]",
      "{\"renderElement\":\"radio\",\"required\":true}"],
    ["field", "school_type", "text", "Schulform", "[]", "{\"renderElement\":\"text\"}"],
    ["field", "faculty", "text", "Fakultät", "[]", "{\"renderElement\":\"text\",\"displayIf\":{\"rules\":[{\"questionId\":\"sector\",\"operator\":\"equals\",\"value\":\"hochschule\"}]}}"]
  ],
  "content": ""
}
```

Selecting `"schule"` on the `sector` field routes from `start` straight to
the `schule` section (skipping `hochschule`, and the `faculty` field never
displays there because `displayIf` also gates it independently).

Fork provenance
-----------------

A template forked from another template (e.g. duplicated and customized by
a different community) carries an extension `a` tag pointing at its
parent, role `forkOf`:

```
["a", "30168:<parentAuthorPubkey>:<parentDTag>", "<relay>", "forkOf"]
```

This tag is informative only — it does not change parsing or rendering of
the forked template, and a forked template is otherwise a complete,
independent 30168 event (it does not need its parent to resolve fields).

Responses
---------

A response is a kind `1069` event addressing its template via an `a` tag
and tagging the template author via `p`:

```
["a", "30168:<formAuthorPubkey>:<formDTag>"]
["p", "<formAuthorPubkey>"]
```

Each answered field becomes a 4-element `response` tag:

```
["response", "<fieldId>", "<value>", "<metadataJSON>"]
```

- `t[1]` — the field id from the template.
- `t[2]` — the answer, stringified. For option fields (radio/select) this
  is the option's **id**, never its label. Multi-select answers are a
  single string of selected optionIds joined with `";"`.
- `t[3]` — reserved per-answer metadata JSON; currently always `"{}"`.

### Public vs. encrypted responses

Whether a response is sent in cleartext depends on `settings.publicForm`
on the template at submit time:

- **Public form** (`publicForm: true`): the `response` tags above are
  pushed directly onto the event's `tags` array; `content` is empty.
- **Non-public form** (default): the full `response` tag array is
  `JSON.stringify`-ed and encrypted with NIP-44 from the responder's
  signer to the form author's pubkey; the ciphertext becomes `content`,
  and an `["encrypted"]` marker tag (no further elements) is added so
  readers know to decrypt before looking for `response` tags. No
  `response` tags appear directly on the event's `tags` array in this
  case.

Decryption is symmetric NIP-44 (ECDH-derived shared secret): the form
author decrypts with the response event's `pubkey` as counterparty,
exactly mirroring how the responder encrypted to the author's pubkey. As
noted in [Scope](#relationship-to-nip-101-and-scope-of-this-extension),
there is no separate view/signing key and no gift wrap — this is plain
pairwise NIP-44, same as NIP-17 DM content encryption.

### Example: public response

```json
{
  "kind": 1069,
  "pubkey": "8a5e...responder",
  "tags": [
    ["a", "30168:3f770d65...abcd:workshop-feedback"],
    ["p", "3f770d65...abcd"],
    ["response", "rating", "5", "{}"],
    ["response", "comments", "Great session, thanks!", "{}"]
  ],
  "content": ""
}
```

### Example: encrypted response

```json
{
  "kind": 1069,
  "pubkey": "8a5e...responder",
  "tags": [
    ["a", "30168:3f770d65...abcd:edufeed-membership"],
    ["p", "3f770d65...abcd"],
    ["encrypted"]
  ],
  "content": "AqR8f3z... (NIP-44 v2 ciphertext of JSON.stringify([[\"response\",\"wished_handle\",\"j.doe\",\"{}\"], ...]))"
}
```
