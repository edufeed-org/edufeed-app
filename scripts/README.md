# Scripts

One-off publishing scripts for edufeed defaults. All require a private key
in `EDUFEED_PUBLISHER_NSEC` (hex) and a comma-separated relay list in
`EDUFEED_PUBLISH_RELAYS`.

Vocab and form definitions live in JSON data files under `scripts/data/` so
that the configurable content is separate from the publishing logic.

## publish:vocabs

Publishes edufeed default vocabularies as kind 39737. Reads scheme
definitions from `scripts/data/edufeed-vocabs.json`. Two source types are
supported:

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

## Adding a new vocab or form

- **New vocab:** append an entry to `scripts/data/edufeed-vocabs.json`
  (skohub or inline). Run `publish:vocabs`, then add the matching
  `SCHEME_NADDR_*` line to `.env.example` and `.env`.
- **New form:** append an entry to `scripts/data/edufeed-forms.json`.
  Fields reference vocabs by their `d`-tag via `vocabRef`. Run
  `publish:forms`.
