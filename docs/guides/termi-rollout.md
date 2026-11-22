# Termi rollout checklist

What a deployment needs before and after the Termi branch (`pr/termi-router`)
reaches it. `.env.example` explains every variable; this page is the order of
work and the things that are easy to forget. As of 2026-11-19 the homelab repo
has **no** `TERMI_*` setting on any deployment — nothing below is set yet.

Without `TERMI_AI_ENABLED=true` a deployment keeps the old canned Termi and
none of the other settings do anything.

## Which deployments

| Deployment              | Termi | Answer feedback |
| ----------------------- | ----- | --------------- |
| edufeed.org             | yes   | yes             |
| dev.edufeed.org         | yes   | yes             |
| rpi.edufeed.org         | no    | no              |
| finder.stil.edufeed.org | no    | no              |

rpi and stil-finder also have `DM_RELAYS=wss://dm.edufeed.org`, so the DM relay
setting does not keep the thumbs away from them — leaving `TERMI_FEEDBACK_NPUB`
out does.

## Before the deploy

- [ ] The pull request is rebased or merged onto `main` and released
      (`vX.Y.Z-rc.N` on dev first).
- [ ] nope-mcp ≥ 0.8.0 and mem-mcp ≥ 3.0.0 are live (older servers answer
      404/400 to the session-less client).
- [ ] `NOPE_MCP_URL` and its Keycloak variables are set (already used by
      `/api/enrich`); without it the assistant reports "off".
- [ ] A directory for the monthly quota counter is mounted into the container
      (`TERMI_STATE_DIR`), otherwise the counter restarts on every deploy.
- [ ] `PRIVACY_POLICY_PATH` is set, so `/privacy` exists and shows the Termi
      sections (they render only with the flag on).
- [ ] The privacy text matches what will be switched on. It names SAIA/GWDG,
      Anthropic (only if `TERMI_EXTERNAL_*` is set), LiaScript and the answer
      feedback. Do not switch a part on that the text does not describe.

## Settings

Minimum for search without a model (everyone who is signed in):

```
TERMI_AI_ENABLED=true
TERMI_SEARCH_RELAYS=amb-relay,oersi,sodix
```

Model answers, lesson planner and file import for eligible accounts:

```
TERMI_LLM_BASE_URL=https://chat-ai.academiccloud.de/v1
TERMI_LLM_API_KEY=<SAIA key, vault>
TERMI_LLM_MODELS=glm-5.3,glm-5.3-flash
TERMI_ELIGIBLE_NIP05_DOMAINS=edufeed.org
TERMI_STATE_DIR=/data/termi
TERMI_QUOTA_DAILY=40
TERMI_QUOTA_MONTHLY=2800
MEM_MCP_URL=https://mcp.mem.edufeed.org/mcp
```

Answer feedback (needs `DM_RELAYS`; never sent to fallback relays):

```
TERMI_FEEDBACK_NPUB=npub1fzkl32v4ppc5njapp6rvg80u0rl30tq2q27nszrxhk59en8m7vksvtmmr7
```

That is the "edufeed Support" account. Its profile, relay list and DM relay
list (kind 10050 → `wss://dm.edufeed.org`) are published. The key is on laoc's
machine (`~/.config/edufeed-support/key`); back it up before rollout — without
it nobody can read the feedback.

Optional, each its own decision:

- `TERMI_EMBED_URL` / `TERMI_EMBED_API_KEY` — the embedding router. Leave unset
  until `scripts/termi-eval.js` has run against the real service and the
  thresholds in `termi-skills.js` are set from it. Unset = keyword router.
- `TERMI_EXTERNAL_PUBKEYS`, `TERMI_EXTERNAL_MODELS`, `TERMI_ANTHROPIC_API_KEY`,
  `TERMI_EXTERNAL_QUOTA_*` — Anthropic models for listed accounts only.

Never in production: `TERMI_TRANSCRIPT_DIR` (it writes user text to disk).

## After the deploy

- [ ] `/api/config` shows `termi: { enabled: true, llm: true, feedbackPubkey: … }`
      on edufeed.org and dev, and no `feedbackPubkey` on rpi and stil-finder.
- [ ] `GET /api/termi/models` lists the SAIA models as ready.
- [ ] Signed in with an eligible account: a material question gets a model
      answer with cards; "Was kannst du?" gets the help answer, not a search.
- [ ] Signed in with a non-eligible account: the same question gets search
      cards without a model.
- [ ] One thumbs-down with a comment arrives in the support account (log in
      with the support key in any NIP-17 client).
- [ ] `/privacy` shows the Termi sections, including "Rückmeldung zu Antworten".
- [ ] Users who paired a NIP-46 signer before the release pair again once:
      the lesson drafts (kind 31234) are a new background-signed kind.

## Open before rollout (owner decisions)

- A lawyer's look at the privacy text: legal basis for Anthropic, and consent
  and withdrawal for unnamed feedback.
- Quota numbers for production (a six-lesson series costs about 40–50 steps).
- Whether the embedding router goes live with the first rollout or later.
