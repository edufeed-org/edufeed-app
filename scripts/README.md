# Scripts

One-off publishing scripts for edufeed defaults. All require a private key
in `EDUFEED_PUBLISHER_NSEC` (hex) and a comma-separated relay list in
`EDUFEED_PUBLISH_RELAYS`.

Form definitions live in a JSON data file under `scripts/data/` so that the
configurable content is separate from the publishing logic.

Vocabularies are published from the `edufeed/vocabs` repo (`pnpm plan` /
`pnpm apply`); edufeed-app only consumes them via `SCHEME_NADDR_*`.

## publish:forms

Publishes edufeed default form templates as kind 30168. Reads form
definitions from `scripts/data/edufeed-forms.json`. Each field may carry
a `vocabRef` (the d-tag of a scheme published from the `edufeed/vocabs`
repo); the script resolves these to scheme coordinates via env vars of
the form `SCHEME_NADDR_<UPPER_SNAKE>` (dashes in the d-tag become
underscores, e.g. `new-lrt` → `SCHEME_NADDR_NEW_LRT`).

Ships with two forms out of the box:

- `amb-basic` — minimal AMB resource (title, description, Fach,
  Ressourcentyp, Sprache, Lizenz).
- `amb-full` — all AMB-core facets with vocab bindings on every
  controlled property.

```
pnpm run publish:forms
```

It accepts `--only d1,d2` to publish just the named forms — publishing
one NEW entry must not re-sign and re-stamp every other one. Unknown
names abort before anything is published.

## Adding a new form

Append an entry to `scripts/data/edufeed-forms.json`. Fields reference
vocabs by their `d`-tag via `vocabRef`, resolved against the
`SCHEME_NADDR_*` vars published from `edufeed/vocabs`. Run
`publish:forms`.
