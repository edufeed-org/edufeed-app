# User-Journey Katalog (agent-driven exploratory testing)

Two series: **Groups/Communities** (J1–J6, desktop) and **Mobile** (M1–M5,
phone viewport, played by the personas in `PERSONAS.md`).

# Series 1 — Groups/Communities

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

# Series 2 — Mobile (personas, phone viewport)

Goal-level journeys for the mobile UX round (first run 2026-10-13). Each
journey is played by ONE persona from `PERSONAS.md`, in that persona's
knowledge and patience. Goals only — no clicks. The question is never "does
it work" but "would this person get there, and what did they think on the
way".

## Run protocol

- Viewport: iPhone 14 preset (390×664 CSS px, touch, `de-DE`), fresh browser
  context per persona (no site data, so first-run dialogs appear). One desktop
  control run (1280×800) of M1 separates mobile-only from general findings.
- Screenshot-first: the tester looks at the screen and taps coordinates, like
  a thumb. Reading the accessibility tree or page text is a fallback only
  after two failed attempts, and the log says so when it happened.
- No code access. Testers do not read the repo, the i18n files or the tests.
- Log every confusion moment, not only failures: expectation, what happened,
  severity (`bug` / `ux` / `polish`, see Series 1), screenshot. End every goal
  with reached / given up, number of actions, and the single biggest hurdle.
- Every publish is captured in the cleanup ledger (see PERSONAS.md).

## M1 — Anna: Material finden, Fachgruppe beitreten

Als Anna öffne ich Edufeed zum ersten Mal auf dem Handy. Ich will verstehen,
was das ist, ein Material für Mathe Klasse 8 finden (erst mal ohne Konto),
eine Fortbildung im Kalender entdecken, dann eine Fachgruppe zu Mathe finden
und ihr beitreten — wobei ich erst beim Beitreten merke, dass ich ein Konto
brauche. Danach will ich die Gruppe wiederfinden und sehen, was drin ist.

Checks: Landing erklärt den Zweck? Suche/Entdecken auffindbar und
Ergebnisse brauchbar? Registrierung mitten im Flow: zumutbar, Schlüssel-
Thema verständlich? Beitreten-Affordance klar? Rückweg zur Gruppe klar?

## M2 — Ben: Konto, Profil, erster Beitrag, Nachricht

Als Ben lege ich ein Konto an, fülle mein Profil (Name, Bild, Über mich),
verschaffe mir einen Überblick über die Startseite nach dem Login, poste
einen ersten Beitrag, finde eine Person und schreibe ihr eine Nachricht, und
finde heraus, wo Antworten und Benachrichtigungen auftauchen. Zum Schluss
melde ich mich ab und wieder an.

Checks: Signup-Schritte und ihre Reihenfolge nachvollziehbar? Backup-Hinweis
verstanden oder weggeklickt? Dashboard-Struktur (Tabs, Feed, "Mein Zeug")
klar? Erstellen-Einstieg auffindbar? Personensuche + DM-Einstieg? Posteingang
vs. Nachrichten unterscheidbar? Re-Login mit dem eigenen Schlüssel möglich?

## M3 — Claudia: Community gründen und leiten

Als Claudia lege ich ein Konto an und gründe eine Community für mein
Fortbildungsnetzwerk (Name, Beschreibung, wer darf rein). Ich lege darin
einen Termin an, suche einen Weg, Kolleginnen einzuladen oder einen Link zu
teilen, finde die Einstellungen meiner Community und will wissen, wie sie
für Außenstehende aussieht.

Checks: "Community erstellen" auffindbar? Typ-Wahl (offen/moderiert/
geschlossen) verständlich in ihren Worten? Community-Navigation auf dem
Handy (Seitenleiste, Bereiche) begreifbar? Termin anlegen aus der Community
heraus? Einladen/Teilen vorhanden und klar? Außenansicht erreichbar?

## M4 — Dirk: mit vorhandenem Schlüssel

Als Dirk melde ich mich mit meinem vorhandenen nsec an, prüfe, ob das mein
Profil ist, finde und folge einer Community, finde unter Entdecken eine
Lernressource und teile oder merke sie mir, suche die Einstellungen (Relays)
und melde mich ab.

Checks: Login-Weg mit nsec auffindbar ohne Google-Umweg? Profil wird
erkannt (Name, Bild)? Folgen vs. Beitreten verständlich? Teilen/Merken an
einer Ressource vorhanden? Einstellungen und Relays auffindbar? Abmelden
auffindbar und eindeutig?

## M5 — Desktop control (Anna, M1 at 1280×800)

Same goals as M1 on a desktop viewport, same persona. Findings that appear
here too are general UX, not mobile layout.
