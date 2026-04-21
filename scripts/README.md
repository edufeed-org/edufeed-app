# Scripts

One-off publishing scripts for edufeed defaults. All require a private key
in `EDUFEED_PUBLISHER_NSEC` (hex) and a comma-separated relay list in
`EDUFEED_PUBLISH_RELAYS`.

Vocab and form definitions live in JSON data files under `scripts/data/` so
that the configurable content is separate from the publishing logic.

## publish:vocabs

Publishes edufeed default vocabularies under NIP-VOCAB v0.2 (schemes on
kind 39737, concepts on kind 39738 — the library builders pick the right
kind). Reads scheme definitions from `scripts/data/edufeed-vocabs.json`.
Two source types are supported:

- `skohub`: the scheme is fetched + parsed from a SkoHub URL via
  `nostr-vocab-skos-import`. Used for large vocabs (Schulfächer, HCRT, …).
- `inline`: the scheme is built directly from an embedded concept list.
  Used for small enums without a SkoHub source (interactivityType,
  conditionsOfAccess).

Each scheme is stamped with a `published_at` tag set to the current Unix
timestamp. This is the app-level signal (established by `nocabs`) that
distinguishes a released vocabulary from a work-in-progress draft —
picker clients skip schemes without it.

```
pnpm run publish:vocabs
```

The script logs the `naddr` of each published scheme. Paste them into
`.env` under the matching `SCHEME_NADDR_<UPPER_SNAKE>` variables before
running `publish:forms`.

## publish:forms

Publishes edufeed default form templates as kind 30168. Reads form
definitions from `scripts/data/edufeed-forms.json`. Each field may carry
a `vocabRef` (the d-tag of a scheme from `publish:vocabs`); the script
resolves these to scheme coordinates via env vars of the form
`SCHEME_NADDR_<UPPER_SNAKE>` (dashes in the d-tag become underscores,
e.g. `new-lrt` → `SCHEME_NADDR_NEW_LRT`).

Ships with two forms out of the box:

- `amb-basic` — minimal AMB resource (title, description, Fach,
  Ressourcentyp, Sprache, Lizenz).
- `amb-full` — all AMB-core facets with vocab bindings on every
  controlled property.

```
pnpm run publish:forms
```

## cleanup:legacy-vocab

NIP-09 cleanup for legacy kind-39737 concept/collection events emitted by
pre-v0.2 publish runs. Under NIP-VOCAB v0.2, kind 39737 is
ConceptScheme-only; concepts moved to 39738 and collections to 39739. This
script publishes kind-5 deletions for any stale `type: Concept` /
`type: Collection` events still owned by the publisher on kind 39737.

**Safety:** Dry-run by default. `--apply` is required to actually publish
the deletions. Schemes (and events with no `type` tag) are always
preserved. The script only touches events authored by the
`EDUFEED_PUBLISHER_NSEC` pubkey.

```
# 1. Inspect what would be deleted (dry-run)
pnpm run cleanup:legacy-vocab

# 2. Publish NIP-09 deletions
pnpm run cleanup:legacy-vocab -- --apply

# 3. Verify 0 legacy events remain
pnpm run cleanup:legacy-vocab
```

**Full migration sequence (NIP-VOCAB v0.2 rollout):**

1. `pnpm run publish:vocabs` — re-emit schemes + concepts at new kinds
   (schemes on 39737, concepts on 39738).
2. `pnpm run cleanup:legacy-vocab` — dry-run to inspect legacy
   concept/collection events on kind 39737.
3. `pnpm run cleanup:legacy-vocab -- --apply` — publish deletions.
4. `pnpm run cleanup:legacy-vocab` — verify the relay reports 0 remaining.

## Adding a new vocab or form

- **New vocab:** append an entry to `scripts/data/edufeed-vocabs.json`
  (skohub or inline). Run `publish:vocabs`, then add the matching
  `SCHEME_NADDR_*` line to `.env.example` and `.env`.
- **New form:** append an entry to `scripts/data/edufeed-forms.json`.
  Fields reference vocabs by their `d`-tag via `vocabRef`. Run
  `publish:forms`.
