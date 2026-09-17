---
name: kind-1063-media
description: Image license attestation (kind 1063 NIP-94 events keyed by SHA-256, license/credit/ai tags, LicenseBadge, ImageLicenseOverlay) and webxdc interactive resources (.xdc/.h5p packages, sandbox origin, dual-purpose 1063 discovery event). Use when touching image or file uploads, LicensedImageInput/LicensedFileInput, LicenseModal, AI labels, image-license.js, src/lib/webxdc/, or publishing interactive AMB resources.
---

## Image License Attestation (Kind 1063 convention)

Edufeed uses NIP-94 (kind 1063) events to attest licenses for images, keyed by SHA-256 hash. A license attestation has these tags:

| Tag           | Required by NIP-94 | Required by edufeed | Notes                                   |
| ------------- | ------------------ | ------------------- | --------------------------------------- |
| `url`         | yes                | yes                 | Image location                          |
| `x`           | yes                | yes                 | SHA-256 hex — the PK we look up by      |
| `m`           | yes                | yes                 | MIME type                               |
| `size`, `dim` | no                 | optional            | Bytes, "WxH"                            |
| `license`     | no                 | **yes**             | License URL (CC, MIT, etc.)             |
| `credit`      | no                 | **yes**             | Human-readable attribution              |
| `source`      | no                 | optional            | Origin page where the image was found   |
| `p`           | no                 | optional            | Attribution to a Nostr pubkey           |
| `ai`          | no                 | optional            | `generated` \| `modified` — EU AI label |
| `ai-tool`     | no                 | optional            | `[label, conceptUri?]` — only with `ai`  |
| `ai-edited`   | no                 | optional            | `true` — manually edited after generation |
| `ai-training` | no                 | optional            | `allowed` \| `disallowed` (form default: allowed) |

**twillo alignment:** the three `ai-*` tags mirror edu-sharing's `ccm:commonlicense_ai_{generated,tool,manually_modified,allow_usage}` node properties (twillo "Informationen zur KI-Herkunft & -Nutzung"). `ai-tool` concept URIs come from edu-sharing's aiTools SKOS scheme (`AI_TOOLS` in `ai-label.js`, `http://w3id.org/edu-sharing/vocabs/aiTools/`). twillo does not export these into its AMB/OERSI metadata, so there is nothing to align on kind 30142 — file level only.

**Lookup:** filter `{ kinds: [1063], '#x': [hash] }`. When multiple events exist, newest `created_at` wins; tie-break by lex order of `id`.

**Gate:** the resource form requires a license event for any image that came from an upload (`formData.imageWasUploaded === true`). Pasted URLs pass through with no gate; if the URL is a Blossom URL, `getSha256FromURL` extracts the hash and the resource event still gets an `["x", hash]` tag so the badge can render when a license event for that hash exists in the network.

**Helpers / files:**

- `src/lib/helpers/image-license.js` — `buildLicenseTemplate(...)` pure helper.
- `src/lib/helpers/ai-label.js` — `AI_LABELS` / `getAiLabel(event)`: the `ai` tag marks AI-generated (`generated`) or AI-modified (`modified`) files, chosen in `LicenseModal`; `ImageLicenseOverlay` renders the EU "AI" mark (`AiLabelIcon`) wherever the image shows. Also `AI_TOOLS` + `getAiTool`, `getAiEdited`, `getAiTraining` for the twillo-aligned tags (shown in the modal's Accept-existing view and the overlay tooltip).
- `src/lib/stores/image-license.svelte.js` — `useLicenseForHash(getHash)` reactive hook.
- `src/lib/components/shared/LicensedImageInput.svelte` — upload/paste field + license modal.
- `src/lib/components/shared/LicenseBadge.svelte` — display badge for `AMBResourceCard` / `AMBResourceView`.

## Interactive Resources (webxdc)

Sandboxed interactive learning apps (webxdc `.xdc` packages, plus a `.h5p`→`.xdc` wrapper) published as AMB resources. Module: `src/lib/webxdc/` — `WebxdcPlayer.svelte` (launch card + stage), `SandboxFrame.svelte` (iframe.diy protocol client), `xdc-archive.js` (zip/unzip + hash verification, never executes unverified bytes), `webxdc-host.js` (window.webxdc bridge over a `local-sync.js` AppSync backend, Phase 1 solo/localStorage), `h5p-wrap.js` (wraps the vendored `static/h5p-standalone` player into an .xdc).

Sandbox origin is configurable per deployment: `SANDBOX_DOMAIN` env → `runtimeConfig.webxdc.sandboxDomain` (default `iframe.diy`); cross-origin subdomain isolation is the primary security boundary, the iframe `sandbox` attribute is defense-in-depth.

Publish flow: `resource-form-variants.js` adds an `interactive` variant (`InteractivePackageInput.svelte`); on save it uploads the package to Blossom and `image-license.js`'s `publishLicenseAttestation` emits **one** dual-purpose kind-1063 (license attestation + NIP-DC discovery, `m: application/x-webxdc`), explicitly routed to the educational (AMB) relays in addition to its normal kind-based routing.

Spec: `docs/superpowers/specs/2026-08-19-webxdc-interactive-resources-design.md`.
