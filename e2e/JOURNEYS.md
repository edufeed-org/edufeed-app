# User-Journey Katalog — Groups/Communities (agent-driven exploratory testing)

Goal-level user stories for **fresh-eyes exploratory testing** against a live
dev server + real relays — complementary to the scripted Playwright specs
(see COVERAGE.md). A tester (human or agent) gets the GOAL of each journey,
not the clicks: figuring out what to click IS part of the test. Every moment
of confusion is a finding, even when nothing is technically broken.

Run conditions: dev server with `GROUPS_ENABLED=true` + `CONCORD_ENABLED=true`,
real relays (relay.edufeed.org, groups.0xchat.com). Fresh journeys start with
cleared site data (localStorage + IndexedDB) so first-run dialogs appear.

## Severity scale for findings

- **bug** — broken behavior (error, dead end, wrong result)
- **ux** — works, but a first-time user gets stuck, misled, or has to guess
- **polish** — cosmetic (layout, wording, alignment)

## Known issues (report if seen, but don't dwell)

- Invite-code minting (kind 9009) fails on groups.0xchat.com — relay policy.
- Creating a Concord channel on a Moderiert community demotes it to Offen
  (XOR violation, guard pending — known design gap).
- Console noise: dev.relay.edufeed.org is down; nostr.wine rejects writes.
- relay.edufeed.org may silently drop kind-1 notes from brand-new pubkeys.

## J1 — Fresh onboarding → first open community

As a brand-new visitor I open the app for the first time, create an account
in-app, complete my profile, and found an **open** community with my current
account. I then visit my community, understand the sidebar, and try to post
something into one content area (e.g. chat).

Checks: first-run dialogs/hints comprehensible? Signup nsec handling clear?
Wizard type step understandable? Does the created community look right
(sidebar zones, member badge, home)?

## J2 — Moderated community lifecycle (owner)

As a signed-in user I create a **Moderiert** community with a NEW keypair,
then explore everything an owner manages: the Mitglieder view, the settings
panes (Typ, Inhalte & Rechte / access tiers, Mitglieder & Rollen), and I flip
the community Moderiert → Offen → Moderiert again.

Checks: type derivation shown correctly everywhere (badge, settings)? Roster
visible with roles? Access-tier editor understandable? Flips take effect and
survive reload?

## J3 — Channels

In a community I own, I create the first channel from the sidebar, send a
message in it, and try to understand what kind of channel I created (E2E
Concord vs NIP-29). I also look at the channel overview and the invite
options for the channel/area.

Checks: "+ Neuer Kanal" discoverable? Create wizard understandable? Message
round-trip works? Do I understand who can read this channel?

## J4 — Joining (second user)

As a DIFFERENT fresh user I discover an existing **open** community and follow
it, then visit a **Moderiert** community: I expect a join affordance, send a
Beitrittsanfrage, and (switching to the owner account) look for where the
owner sees/approves it and adds me to the roster. Back as the joiner I verify
my member state (badge, gated content unlocked).

Checks: join lane visible to non-members? Request feedback (pending state)?
Owner-side approval discoverable? Does membership actually unlock things?

## J5 — Geschlossen (closed/E2E) community

As a signed-in user I create a **Geschlossen** community, verify the outside
view (visible shell: only that it exists), create a channel inside, and
exercise the invite path (direct invite / Erhaltene Einladungen on the other
side with a second account).

Checks: irreversibility warning at creation clear? Key-backup story clear?
Shell view correct for visitors? Invite round-trip works?

## J6 — Visitor / logged-out experience

Logged out (and separately: logged in but a stranger), I visit one community
of each type. What do I see, what is locked, is it explained why?

Checks: open = everything readable; moderated = readable but write-gated with
comprehensible locks; closed = shell only. Lock hints where content is hidden.
No crashes/blank pages anywhere.
