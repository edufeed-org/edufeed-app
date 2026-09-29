# Metadata forms as Nostr events in edufeed

A metadata profile says which fields describe a learning resource, which vocabularies those fields draw from, and how the answers map onto the resource's metadata. In edufeed a metadata profile is a form template: a kind 30168 Nostr event. Filling in the form publishes a kind 30142 AMB resource. This article describes the approach, what ships today and what is still open, so other people can review it before it goes live.

The normative wire format is the extension spec [NIP-101-EDU](https://git.edufeed.org/edufeed/edufeed-app/src/branch/main/docs/nips/nip-101-edu.md). This article is the overview; the spec has every tag position and edge case. Resource metadata itself follows [NIP-AMB](nostr:naddr1qq8k2er4vejk2epdv9kkyttwd9cqz9mhwden5te0wfjkccte9ejkgatxv4jkgtn0wfnsyg9acg0e8v0zed6kpr8v67s2qznhjauajdnae9uchk0jz0cxe9dufqpsgqqq0p3qfew2x9), and controlled vocabularies follow [NIP-VOCAB](nostr:naddr1qqgk2er4vejk2epdwehkxctz94hxjuqpzamhxue69uhhyetvv9ujuetyw4nx2ety9ehhyeczyz7uy8unk83vkatq3nkd0g9qpfmew7wexe7uj7vtm8ep8urvjk7ysqcyqqq8scsypnrnn).

## The mechanism in one line

`form template (kind 30168) → rendered as a step-by-step form → answers mapped per field → AMB resource (kind 30142) with an a-tag back to the template`

## Why forms, and why as events

Until now every metadata profile in edufeed was hand-written Svelte code: one large wizard with configuration at the edges. Every new profile (a Konfi path, a Hochschul path, a regional church profile) meant a code change and a release.

Turning a profile into a Nostr event changes who can make one:

- **Profiles become data.** A community or institution publishes its own profile as an event. No code change, no release.
- **Profiles are forkable.** Anyone can copy a template, adapt it and publish it under their own key. The copy carries a `forkOf` reference to its parent, so lineage stays visible.
- **Profiles are portable.** Any client that understands the format can render the same form and produce the same resource metadata.
- **The output stays standard.** Whatever the form looks like, the result is an ordinary NIP-AMB resource that every AMB consumer already reads.

## Building on NIP-101 instead of inventing a format

Kind 30168 (template) and kind 1069 (response) come from NIP-101, the draft forms NIP used by Formstr. edufeed adopts its base layer as written: `d`, `name`, one `settings` tag with a JSON object, and one `field` tag per question.

```
["field", "<id>", "text" | "option" | "label", "<label>", "<optionsJSON>", "<fieldSettingsJSON>"]
```

Rich field types (textarea, date, creator, DOI and so on) live in the field settings as `renderElement`, which is Formstr's own convention. A client that does not know a type falls back to a text input instead of misreading the event.

The interop is tested, not assumed. Our templates parse cleanly in Formstr's reference SDK, including steps and branching, and Formstr-shaped templates parse in edufeed. One known gap remains: Formstr and edufeed use different names for some widgets, so a Formstr radio button currently renders as a text box in edufeed. A small name mapping fixes it without any wire change.

## What edufeed adds on top

Every addition is either a new tag or a new key inside an existing JSON object. A plain NIP-101 client ignores them and still renders the form.

- **`field-vocab`** binds a field to a SKOS concept scheme (kind 39737). The field then offers a vocabulary picker, and its answers are concept URIs instead of free text.
- **`field-output`** says where an answer lands in the resource. `amb:<property>` puts it under a standard AMB property such as `name`, `about` or `learningResourceType`. `ext` puts it under a namespaced extension tag, `ext:<form-d-tag>:<field-id>`, for anything the AMB standard does not cover.
- **Steps, conditions and routing** follow Formstr's schema. Sections group fields into wizard steps. A `displayIf` rule shows a field only when an earlier answer matches. An option can route the respondent to a specific step, for example "Hochschule" jumps to the Hochschul questions.
- **Composite field types** emit fixed NIP-AMB shapes. A `creator` field emits `p` tags for Nostr users and `creator:*` tags for people without a key. An `amb-relation` field emits an `a` tag with the role `isPartOf`, `hasPart` or `isBasedOn`. A `doi` field fetches the publication's metadata from Crossref and pre-fills the other fields.

### Example: one field, bound to a vocabulary

```json
["field", "fachsystematik", "text", "Fachsystematik", "[]", "{\"renderElement\":\"select\"}"],
["field-vocab", "fachsystematik", "a", "39737:<scheme-pubkey>:fachsystematik-theologie", "wss://relay.edufeed.org"],
["field-output", "fachsystematik", "amb:about"]
```

Choosing a concept in this field produces the NIP-AMB concept triad on the resource:

```json
["about:id", "<concept-uri>"],
["about:prefLabel:de", "<label>"],
["about:type", "Concept"]
```

## From answers to a resource

Metadata forms are event composers. Submitting one publishes a kind 30142 resource, not a kind 1069 response. The answers go through the same AMB converter library (`amb-nostr-converter`) that the hand-written wizard uses, so both paths produce identical tags for the same data.

Every resource made from a template carries a back-reference to it:

```json
["a", "30168:<form-author-pubkey>:<form-d-tag>", "<relay>", "form"]
```

This lets anyone see which profile described a resource, and filter resources by profile.

Kind 1069 responses still exist for ordinary forms, such as the membership application for an edufeed.org address. Those are encrypted to the form author with NIP-44 unless the form is marked public.

## How it appears in the app

- **Building.** Any logged-in user can build a template at `/forms/new`. The builder supports steps, show-only-if rules, option routing, a field-to-AMB mapping on every field, vocabulary bindings, help texts per field, and a preview of the form as a respondent sees it.
- **Filling in a template directly.** Every published metadata template can be filled in from its own page (`/forms/<naddr>/create-resource`).
- **Plugging a template into the resource picker.** The "Share learning resource" picker lists the variants a deployment enables. A deployment points a variant at a template with one environment variable, `RESOURCE_FORM_TEMPLATE_NADDR_<VARIANT>`. With the variable set, that variant renders the template. Without it, the variant keeps using the hand-written wizard. This lets a deployment move one profile at a time.
- **Default templates.** The edufeed default templates live as data in the repository (`scripts/data/edufeed-forms.json`) and are published with `pnpm run publish:forms`. Vocabulary references resolve to the schemes published with `pnpm run publish:vocabs`.

| Template             | What it is                                                                                               | Steps |
| -------------------- | -------------------------------------------------------------------------------------------------------- | ----- |
| `amb-basic`          | minimal AMB learning resource: title, description, subject, type, language, licence, creators, relations | 5     |
| `amb-full`           | AMB with all core facets: audience, level, interactivity, access, keywords                               | none  |
| `ekw-full`           | EKW religious-education material: grade level, school type, didactics, method, Bible references          | none  |
| `ekkw-hochschule`    | EKKW scientific publication and Hochschul content, with DOI prefill and a Theologie subject scheme       | 4     |
| `edufeed-membership` | application for an edufeed.org address (kind 1069 response, not a resource)                              | none  |

## Status (September 2026)

All of the code described above is merged into the edufeed-app main branch. None of it is switched on yet.

- **No deployment activates a template.** No `RESOURCE_FORM_TEMPLATE_NADDR_*` variable is set on any edufeed deployment. Every resource form still uses the hand-written wizard.
- **The current default templates are not on the edufeed relays yet.** The EKKW template and its Theologie scheme were only published to a local test relay.
- **The hand-written wizard is not retired.** The plan is to retire it one variant at a time, once a deployment runs a profile fully on its template.

## Open questions for reviewers

1. **Who may build profiles for a community?** Today any logged-in user can publish a template. The plan is to bind templates to a community and restrict authoring to members of a community profile list, like other community sections. This is not built yet.
2. **Anonymity in response forms.** A form can say "responses are evaluated anonymously", but a kind 1069 response is always signed by the respondent's real key. The options are a warning in the builder or real anonymous responses. This is undecided.
3. **Library or app?** The generic form engine (format, branching, encryption, field types) does not depend on edufeed and could become a reusable package. The AMB composer, the vocabulary bindings and the membership flow would stay in edufeed. The alternative is to lean on Formstr for generic forms and keep only the metadata composer.
4. **Upstream.** Should the branching and vocabulary additions be proposed to the NIP-101 draft, or stay an edufeed extension?

## Next steps

1. Publish `amb-basic` and `ekkw-hochschule` with their vocabularies to the edufeed relays.
2. Set the two template variables on dev.edufeed.org and test both profiles end to end on staging.
3. Decide the open questions above, then move production one variant at a time.
