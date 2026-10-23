---
name: amb-educational
description: AMB educational resources (kind 30142): NIP-50 search via pool.request (a ranked search is one response per relay, never a feed window or a cached one-shot), SKOS concept-ID filters, and the resource form variant registry with NIP-32 labeling. Use when working on educational search, amb-search.js, searchQueryBuilder.js, ResourceFormWizard, or resource-form-variants.js.
---

## Educational Content (AMB - kind 30142)

Educational content uses the AMB (Allgemeines Metadatenprofil) spec with JSON-flattening:

- Search via NIP-50 `search` filter parameter
- SKOS vocabularies for classification (learningResourceType, about, audience)
- Special relay for AMB indexing: `runtimeConfig.educational.ambRelays`

### NIP-50 Search Implementation

**IMPORTANT:** Use `pool.request()` directly for NIP-50 searches, NOT `fetchEvents` or `createTimelineFeed` — a ranked search is one response per relay (relevance scores are only comparable within one response, see `searchRank.js`) and must not be served from the IDB cache or paged as a window. See `src/lib/loaders/amb-search.js` and `src/lib/helpers/educational/searchQueryBuilder.js`.

### SKOS Filter Pattern

```javascript
// Use concept IDs, not labels
parts.push(`learningResourceType.id:${concept.id}`);
// Example: learningResourceType.id:https://w3id.org/kim/hcrt/text
```

### Resource Form Variants (kind 30142)

The "Share Learning Resource" flow runs through `ResourceFormWizard.svelte` with a `variantId` prop. Variants are deployment-gated via `RESOURCE_FORM_VARIANTS` env (comma-separated, default `amb`).

**NIP-32 labeling:** Published events carry `["L", "metadata-form"]` + `["l", variantId, "metadata-form"]` so edit flows can reopen the correct form. `resolveVariantFromEvent.js` falls back to `'amb'` when missing.

Single-variant deployments skip the picker modal (FAB navigates directly). Legacy `/create/resource` always redirects via `+page.svelte`, preserving `?community=` and `?edit=`. Registry lives in `src/lib/config/resource-form-variants.js`.
