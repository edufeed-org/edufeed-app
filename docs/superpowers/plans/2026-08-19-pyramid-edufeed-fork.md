# pyramid-edufeed Fork Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend fiatjaf's pyramid relay with three edufeed policies: pending membership applications, member self-join on community subgroup channels, and virtual per-community relay endpoints — deployed as groups.edufeed.org.

**Architecture:** pyramid is a khatru-based Go relay; all NIP-29 policy lives in `groups/reject-event.go` (write gating), `groups/process-event.go` (relay reactions: auto put-user etc.), and `groups/filter.go` (read gating), wired from `main.go` (`relay.OnEvent`, `RequestAuthWhenNecessary`, outer HTTP `mux`). Group state comes from `fiatjaf.com/nostr/nip29` (already parses/applies the spec's `parent` tag). We change policy only — no storage or protocol layer changes — plus one new HTTP mount for virtual endpoints.

**Tech Stack:** Go, khatru, fiatjaf.com/nostr (+nip29), `go test` (existing harness: `groups/reject_event_test.go`, `groups/queries_test.go`).

**Spec:** `docs/superpowers/plans/2026-08-19-nip29-stories-roadmap.md` (in edufeed-app worktree). The three issues on the repo are the task anchors (nevents below).

## Global Constraints

- Repo: `nostr://laoc.xyz/relay.ngit.dev/pyramid-edufeed`, local checkout `/home/laoc/coding/edufeed/pyramid-edufeed`. claude-code npub is maintainer.
- **Workflow per task:** branch `pr/<name>` → commits → `git push -u origin pr/<name>` (single-commit PRs may use `-d`) with the PR body referencing the issue as `nostr:nevent…` → `ngit merge` → `git push origin master`. Verify `ngit account` shows `claude-code` before any signing/push.
- Commit trailers: same as edufeed-app (`Claude-Session: https://claude.ai/code/session_011Na3juB2TLLr7L7wRq8KWu`, `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`).
- Every change keeps `go build ./...` and `go test ./...` green; new behavior gets table-driven tests beside the existing ones.
- Keep the diff upstream-mergeable: additive policy, no reformatting sweeps; candidate upstream PRs are R1 and the R2 spec-rule.
- laoc builds and deploys (homelab); this plan ends at merged master + a tagged release note, not at deployment.

---

### Task 0: Bootstrap the fork with upstream history

**Files:** whole tree (import), `README.md` (merge conflict trivial: keep upstream README, append an "edufeed fork" section naming the three issues).

- [ ] **Step 1:** `cd /home/laoc/coding/edufeed/pyramid-edufeed && git remote add upstream https://github.com/fiatjaf/pyramid && git fetch upstream`
- [ ] **Step 2:** `git checkout master && git merge upstream/master --allow-unrelated-histories` — resolve the README (upstream content + fork section).
- [ ] **Step 3:** Verify the toolchain: `go build ./... && go test ./groups/...` — record the baseline (upstream tests must pass before any change; if a baseline test fails, note it in the README fork section rather than fixing silently).
- [ ] **Step 4:** Commit the merge, `git push origin master`. (First push signs git-state via the claude nostr key — if it hangs on signer approval that's ngit, not the network.)
- [ ] **Step 5:** Confirm on gitworkshop.dev that master shows the full tree.

---

### Task R1: Pending applications — store codeless 9021s to closed groups

**Issue:** nostr:nevent1qqsxhzkg33e2mp9f642h294ydtnzjjzlukt4ylej3x65awrhmger76cpz3mhxue69uhhyetvv9ujumn8d96zuer9wcek2tdk

**Files:**
- Modify: `groups/reject-event.go` (the `KindSimpleGroupJoinRequest` block, ~lines 92-132)
- Modify: `groups/process-event.go` (the join-request reaction, ~lines 122-151)
- Modify: `groups/filter.go` (`RequestAuthWhenNecessary`)
- Test: `groups/reject_event_test.go`, new `groups/pending_applications_test.go`

**Interfaces:**
- Produces: helper `isPendingApplication(group *Group, event nostr.Event) bool` in `groups/utils.go` — true iff kind 9021, group `Closed`, no `code` tag with a currently-valid invite code. Used by all three files so the accept/skip/read decisions can't drift apart.
- Behavior contract: pending 9021s are **accepted and stored** (client sees OK true — matches groups.0xchat.com); the relay does **not** auto-add; the events are served only to their author and to members with any role (admins/moderators); a later admin put-user admits the applicant through the normal path. Kicked users and existing members keep their current rejections.

- [ ] **Step 1: Failing tests** in `pending_applications_test.go` (reuse the fixtures/builders from `reject_event_test.go`):

```go
func TestCodelessJoinRequestOnClosedGroupIsStoredNotRejected(t *testing.T) { /* RejectEvent → false */ }
func TestCodelessJoinRequestOnClosedGroupDoesNotAutoAdd(t *testing.T)      { /* ProcessEvent → requester ∉ group.Members */ }
func TestKickedUserJoinRequestStillRejected(t *testing.T)                   { /* prior remove-user without self-removal → reject */ }
func TestMemberJoinRequestStillDuplicate(t *testing.T)                      { /* "duplicate: already a member" preserved */ }
```

- [ ] **Step 2:** `go test ./groups/ -run Pending` → FAIL (first two).
- [ ] **Step 3: Implement** — in `RejectEvent`, replace the hard `restricted: group is closed, you need an invite code` return with: run the kicked-check first (keep rejecting), then `return false, ""` (store) when `isPendingApplication`. In `ProcessEvent`, guard the auto put-user: `if isPendingApplication(group, event) { return }` before building `addUser`.
- [ ] **Step 4: Read gating** — in `RequestAuthWhenNecessary`, when the filter includes kind 9021 (or no kinds at all) AND an `h` for a known group: require auth; allow when every authed pubkey set intersects {event-author case is per-event, so instead scope by filter: authed user must be the `authors` value they query, or hold a role in each addressed group}. Concretely: reject the REQ unless (a) `filter.Authors` ⊆ authed pubkeys (an applicant checking their own pending request — this is what edufeed-app's GroupChat sends), or (b) some authed pubkey has `len(roles) > 0` in every addressed group (the admin queue REQ). Add `TestPendingApplicationsReadGating` covering: applicant-own-authors allowed, admin allowed, stranger CLOSED.
- [ ] **Step 5:** `go build ./... && go test ./...` → green (existing `TestJoinRequest…` cases in `reject_event_test.go` asserting the old rejection must be updated to the new contract in the same commit).
- [ ] **Step 6: PR + merge** — branch `pr/pending-applications`, body explains the NIP-29 "pending review" language and 0xchat parity, references the issue nevent. Merge, push master, comment-and-close the issue via `ngit issue resolved <id> --reason "merged in <commit>"`.

---

### Task R2: Parent-member self-join + 9002 parent authorization

**Issue:** nostr:nevent1qqswrden87tjs8mfkj0ekdz93ettfuxwflakhj8xqwwdwt9uxg6uk5cpz3mhxue69uhhyetvv9ujumn8d96zuer9wczdcyfs

**Files:**
- Modify: `groups/reject-event.go` (join-request block + the `nip29.EditMetadata` case in the moderation switch)
- Modify: `groups/utils.go` (`isPendingApplication` gains the parent check)
- Test: `groups/pending_applications_test.go` (extend), `groups/reject_event_test.go`

**Interfaces:**
- Produces: a codeless 9021 on a closed group whose `Parent` names a group where the requester **is a member** → treated like a valid-code join: accepted AND auto-added by the existing `ProcessEvent` put-user. Everyone else falls through to R1's pending path. Plus the spec rule: a `kind:9002` carrying `["parent", X]` is rejected unless its author has a role in group X (`restricted: must be an admin of the parent group`); a 9002 keeping an UNCHANGED parent from the same author rule applies identically (simple, predictable).
- Consumes: `State.Groups.Load(group.Parent)` for the parent lookup (nil parent group → pending path, never crash).

- [ ] **Step 1: Failing tests:**

```go
func TestParentMemberSelfJoinIsAutoAdded(t *testing.T)        { /* member of parent → RejectEvent false AND ProcessEvent adds */ }
func TestStrangerOnParentedChannelGoesPending(t *testing.T)    { /* not member of parent → stored, not added (R1 path) */ }
func TestEditMetadataParentRequiresParentAdmin(t *testing.T)   { /* 9002 with parent by non-admin-of-parent → rejected */ }
```

- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement** — in `isPendingApplication`: after the invite-code check, `if parent, ok := State.Groups.Load(group.Parent); ok { if _, isM := parent.Members[event.PubKey]; isM { return false } }` (with the same RLock discipline as the surrounding code). In the `nip29.EditMetadata` case: when `a.Group.Parent != ""` and it differs-or-not, load the parent group (reject `error: parent group doesn't exist` when absent — the spec's rule) and require `len(parentGroup.Members[event.PubKey]) > 0`.
- [ ] **Step 4:** Full `go test ./...` green.
- [ ] **Step 5: PR + merge** — branch `pr/parent-member-selfjoin`, reference the issue, resolve it after merge.

---

### Task R3: Virtual per-community relay endpoints

**Issue:** nostr:nevent1qqsqfst0tsasqyr2ypptd949sn9ffpsj062d00zfmy6n3f4n9vyrp5spz3mhxue69uhhyetvv9ujumn8d96zuer9wcmh9yk4

**Files:**
- Create: `groups/virtual.go` (+ `groups/virtual_test.go`)
- Modify: `main.go` (mux mounts, next to the existing `mux.Handle("/groups/", …)` at ~line 510)
- Modify: `groups/handler.go` only if the shared `hostRelay` needs exposing (prefer passing it into `virtual.go` from `Init`)

**Interfaces:**
- Produces: `groups.VirtualHandler` (an `http.Handler`) mounted at `/c/` in `main.go`:
  - `GET /c/<rootId>` with `Accept: application/nostr+json` → NIP-11 JSON: `name`/`description`/`icon` from the root group's state (`group.Name`, `group.About`, `group.Picture`), `pubkey`+`self` = the main relay's keys, `supported_nips` = the main document's list plus 29, `limitation.restricted_writes: true`. Unknown/deleted root id → 404.
  - Websocket upgrade on the same path → a lazily-created per-community `khatru.Relay` (cached `xsync.Map[string, *khatru.Relay]`, same map style the codebase already uses for `State.Groups`), configured with:
    - `QueryEvents`/`StoreEvent`/etc. delegating to the SAME functions `main.go` wires for the main relay,
    - `OnEvent` = subtree guard → then `groups.RejectEvent` (same ctx): reject `blocked: event targets a group outside this community` when the event's `h` (or `d` for metadata kinds) is neither `rootId` nor a group whose `Parent == rootId`,
    - `RejectFilters` = intersect: filters addressing `#h`/`#d` outside the subtree are rejected `restricted: not part of this community`; filters with NO `#h`/`#d` get the subtree ids injected instead of rejected (so a bare `{kinds:[39000]}` from Armada lists exactly this community's groups).
  - Helper `subtreeIDs(rootId string) []string` (root + all groups with `Parent == rootId`) with its own unit test.
  - Root-group deletion: the existing delete path (`process-event.go` `KindSimpleGroupDeleteGroup`) additionally drops the cached virtual relay so the endpoint 404s.
- Consumes: R2's `parent` wiring (channels carry `Parent`), `global.Settings.RelayInternalSecretKey`'s pubkey for `self`.

- [ ] **Step 1: Failing unit tests** — `subtreeIDs` covers exactly one level (root + direct children; the edufeed model is flat — a test asserts a grandchild is EXCLUDED and a doc comment states the deliberate limit); NIP-11 synthesis via `httptest`: known root → JSON with the group's name and the relay `self`; unknown → 404.
- [ ] **Step 2:** Run → FAIL. Implement `virtual.go` (NIP-11 + subtree first, ws wiring second).
- [ ] **Step 3: Websocket path** — construct the per-community `khatru.Relay` mirroring `main.go`'s hook wiring (extract that wiring into a shared `configureRelayHooks(r *khatru.Relay, scope *virtualScope)` if duplication exceeds ~30 lines). Manual verification step: run locally (`go run . --port 8080` or the repo's documented dev command), open `ws://localhost:8080/c/<id>` with a node probe: REQ `{kinds:[39000]}` returns only the community's groups; a kind-9 h-tagged to a foreign group is rejected.
- [ ] **Step 4:** `go build ./... && go test ./...` green; record the manual ws-probe transcript in the PR body.
- [ ] **Step 5: PR + merge** — branch `pr/virtual-community-endpoints`, reference the issue, resolve after merge.

---

### Task R4: Release notes for laoc's deploy

- [ ] **Step 1:** Append to the README fork section: the three behaviors, config knobs (none new — all unconditional policy), and the deploy note: build from this repo instead of upstream; existing on-disk state is untouched (policy-only changes).
- [ ] **Step 2:** `git tag edufeed-v1 && git push origin edufeed-v1` (annotated tag listing the three merged PRs). Tell laoc it's ready to build.

---

## Self-Review notes

- Issue coverage: R1↔issue 6b8ac88c…, R2↔issue e1b7333f…, R3↔issue 04c16f5c… — each task ends by resolving its issue.
- Order matters: R2 extends `isPendingApplication` introduced in R1; R3 depends on `Parent` being meaningfully set (app Task A2 writes it; R2 validates it).
- Divergence log (for upstream PR candidates): R1 accept-and-store deviates from the spec's MUST-reject in favor of 0xchat parity — the README fork section records this deliberately.
- Deployment (ansible/homelab image build) is explicitly out of scope — laoc owns it; nothing in this plan touches the live relay.
