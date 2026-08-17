# Groups journey testing — consolidated findings (2026-08-14)

Four fresh-eyes agent testers ran the journeys from `e2e/JOURNEYS.md` against
the live dev server (worktree group-pointer @ 540bb420, GROUPS_ENABLED +
CONCORD_ENABLED, relays relay.edufeed.org + groups.0xchat.com). Agents drove
the real browser with goal-level instructions only — no source access, no
click scripts. Full per-journey reports are in the session transcript;
screenshots under `/tmp/nix-shell.Ehowe8/claude-chrome-screenshots-w7q4C8/`
and the session scratchpad.

Testing infrastructure notes: the Playwright MCP is unusable on this host
(`.mcp.json` hardcodes the broken nix chromium); agents used claude-in-chrome
against alternate origins (`[::1]:5173`, `foo.localhost:5173`) to isolate
storage from the human session. The dev server binds `::1` only —
`127.0.0.1:5173` is unreachable.

## What works end-to-end (verified against live relays)

- J1: fresh signup → profile → open community → chat message → survives
  reload; kind 0/10222/9 confirmed on relay.edufeed.org by direct REQ.
- J2: moderated creation with new keypair → roster (owner + human admin
  king) → access-tier edit → type flips both directions (persist).
- J3: first-channel creation flow, message round-trip, sidebar update.
- J4: application form → submit (encrypted, pending survives reload) →
  approval by the HUMAN admin → joiner gets Mitglied badge + unlocked chat.
- J5: closed community E2E incl. cross-account direct-invite round trip;
  visitor shell leaks nothing.
- J6: no crashes/blank pages anywhere, logged-out reads work on all types.

## Critical bugs (break the redesign's core promises)

1. **Moderated community ships with NO join path.** Type card promises
   "Beitrittsanfragen", but no application form is created/attached by the
   wizard; strangers see only Folgen + Einladungscode. The join lane only
   appears after the owner manually finds "Standard-Formular erstellen" +
   "Übernehmen" in settings. (J4)
2. **Join requests are invisible to the community account.** Applications
   are readable only by roster admins (the human key); the app auto-switches
   the creator TO the community account, where "Beitrittsanfragen" shows
   "Keine offenen Anfragen" forever. Approval only works after manually
   switching back to the human account — least guessable behavior of the
   whole test. (J4)
3. **Roster ops as the community account fail silently.** "Mitglieder
   verwalten" put-user → relay `blocked: unknown member` (community key is
   not a group admin); no error UI at all. Same op as the human admin works.
   Two-signer discipline breaks when the active account IS the community. (J4)
4. **Admin settings UI renders for logged-in strangers** on moderated
   communities: type flip, member management, invite codes, tier editors all
   visible + clickable (writes fail at the relay only). Logged-out visitors
   are NOT affected. (J4/J6)
5. **Owner of a fresh Geschlossen community sees the visitor lock shell**
   ("Diese Community ist geschlossen…") — survives reload; only sidebar
   tools reveal ownership. (J5)
6. **Invite-code failure is fully silent** — button spins ~50 s, resets; the
   9009 relay rejection lands only in the console. (J2)
7. **E2E channel on Moderiert silently demotes the type to Offen** — the
   known XOR gap, now observed end-to-end incl. loss of member management
   and the human admin vanishing from the members list. (J2, known)

## Significant bugs

8. Closed community's Mitglieder view says "Dies ist eine offene Community —
   jeder kann beitragen." (J6)
9. "Community folgen" gives no in-session feedback and never flips state
   until a full reload → users click repeatedly, publish duplicate follows. (J4)
10. Chat gate tells logged-in non-members "Melde dich an, um am Chat
    teilzunehmen" — wrong reason, no join CTA. (J4/J6)
11. Member counts inconsistent across surfaces ("2 Mitglieder" vs
    "1 Mitglieder" incl. plural bug); human admin drops out of the members
    list after type flips and is not restored. (J2/J4)
12. Flip round-trip Moderiert→Offen→Moderiert resets every access tier to
    "Alle" — foreshadowed in the dialog, but lossy with no restore. (J2)
13. `community_invite_hint` in messages/de.json has double-escaped
    `\\u201e`/`\\u201c` — renders literally (verified, de.json:3296). (J2/J4)
14. Role badge shows raw relay-assigned token "king" (0xchat's creator role)
    untranslated/unexplained. (J2/J4)
15. ServiceWorker registration fails on non-`localhost` origins (dev-env;
    verify irrelevant for prod). (J1)

## Recurring UX theme: the silent account switch

The wizard switching the active account to the new community keypair caused
confusion in every journey that founded a community (J2/J4/J5): users are
greeted as the community mid-wizard, post their first channel message AS the
community, and combined with bug #2 end up in an identity where owner duties
(approvals) don't work. Needs an explicit moment: announce the switch, or
stay on the human account and switch only for community-signed actions.

## UX findings

- Community type flash: reload shows the stale type for 10-15 s before
  settling — admins can't trust what they see after a flip. (J2)
- Bestätigen step omits the chosen community type. (J2/J4)
- Invites: channel-wizard invite step gives zero feedback (field clears, no
  chip) → duplicate invites; received invites show raw hex sender, arrive
  ~20 s later with no loading state. (J5)
- Member-add modal: name search doesn't work despite placeholder ("per Name
  oder npub"), suggestion row clipped by modal edge, no profile preview. (J4)
- Folgen vs. Mitgliedschaft never explained anywhere. (J4)
- Directory type badges 🔒/🛡️ carry no tooltip/legend; "no badge = open" is
  implicit. (J6)
- Sidebar padlocks on gated sections have no tooltip. (J6)
- Onboarding: step-4 button says "Fertig" but a 5th step (membership form)
  follows; key backup never surfaced outside a dismissible Termi hint. (J1)
- Community-suggestion list in onboarding leads with test debris. (J1)
- Empty chat has no empty state; "# general" auto-channel unexplained;
  reload reopens general instead of last-used channel. (J1/J2)

## Polish / i18n

- English fragments in the German UI: "Profil erstellen für Your Community",
  confirm-step + Inhalte-&-Rechte content-type labels ("Calendar",
  "Learning"…), "Submit" on the Mitgliedsantrag, chat timestamps
  ("now", "Aug 14, 2026" instead of DD.MM.YYYY).
- Sie/Du register mix (key step + several wizard strings in Sie, rest Du).
- Type-flip dialog renders "(Kanäle: )" when no channels exist.
- nsec downloads are generic `nostr-private-key (N).txt` — indistinguishable
  across communities; downloading NSEC also marks NCRYPTSEC "Heruntergeladen".
- Account dialog titled "Konto hinzufügen" though it's the switcher; header
  shows "Anmelden" for seconds while session hydrates.
- Fresh profile shows loud orange "NICHT VERIFIZIERT" badge (reads like an
  error).

## Test artifacts (throwaway, on [::1]:5173 origin of the dev browser)

Accounts: Testerin Tina (`npub1v7569…`), Joiner Jonas (`npub1u37t4…`);
communities: "Testerin Tina" (open, = Tina's key), "Journey Zwei"
(`npub1fppch…`, demoted to Offen by bug #7), "Beitritts Test"
(`npub1ysk0tk…`, moderated), "Geheimclub" (`npub1lez83…`, closed).
Throwaway nsecs in `~/Downloads/nostr-private-key (6|7|8).txt`.

## Fix status (second pass, same day — commits after 4f47273c)

Fixed and verified live (fresh moderated community "Fix Check",
`npub1lt3r2pcxp494gd5hrda3x7vzdhmsa76q0976xjyerdc8yzgh369s8gyret`):

- #1 wizard now auto-creates + attaches the default application form
  (10222 carries the `application` tag from creation — wire-verified).
- #2/#3 provisioning seats the community pubkey as a 39001 admin (role
  `admin`, wire-verified on 0xchat) → the community account is a reviewer
  for applications and can sign roster ops; Beitrittsanfragen +
  Beitrittsformular panes render for the community account.
- #5 closed shell shows an insider variant (owner ∪ roster ∪ Concord
  member): "Du bist Mitglied…" + "Zu den Kanälen" (verified as area member).
- #6/silent toasts: showToast targeted CSS modals (clipped by their
  transform/overflow) and reused stale containers via subtree
  querySelector; now body/top-layer-dialog targeted with direct-child
  containers (4 new unit tests).
- #7 XOR: `withConcordPointer` strips membership/application (spec XOR),
  and PrivateChannelsView gates Concord founding/attach on a moderated
  community behind a "Mitgliederverwaltung ersetzen?" confirm (verified).
- #8 closed community's members view no longer claims "offene Community".
- #10 chat gate distinguishes signed-in non-members ("Nur Mitglieder
  können hier schreiben.") from logged-out visitors.
- #13 de.json double-escaped „ " fixed.

Re-classified: #4 (strangers see admin settings) is largely a
single-browser artifact — `isCommunityOwner` is key-holding ("any account
in this manager holds the community key"), and the testers' browser held
every community key. A real stranger's browser shows no admin UI (J6
logged-out confirms). The genuinely wrong part was admin OPS failing when
the active account isn't a 39001 admin — solved by the #2/#3 seat.

Third pass (same day):

- #9 ROOT-CAUSED + FIXED: joinCommunity bootstraps an empty follow set and
  adds the follow within the same second; NIP-01 resolves equal-created_at
  replaceables by LOWEST id — a coin flip that silently kept the empty set
  half the time. The bootstrap is now back-dated by one second so any
  update strictly wins. Verified live: "Folge ich" flips in-session.
- #11: the count sources agree for new communities once the community key
  sits on the roster (second-pass seat fix); the "1 Mitglieder" plural is
  fixed via singular message variants on all three surfaces.
- #12: closed as BY DESIGN — flip-to-moderated deliberately never
  retroactively gates ("keeps sections ungated" is an explicit tested
  invariant), and both flip dialogs disclose the consequences.
- #14: known relay role tokens now display-mapped (king → "Gründer:in",
  admin → "Admin"; custom roles pass through verbatim since role-gated
  tiers match them literally) in MembersView + GroupMembersModal.
- Account-switch theme: the new-keypair flow now announces the switch with
  a toast ("Du bist jetzt als … aktiv"). Also fixed: "(Kanäle: )" empty
  render in the flip dialog, "Your Community" untranslated fallback, and
  the confirm step now names the chosen community type.

Fourth pass (UX/i18n batch):

- Content-section names display-localized everywhere they rendered raw
  (confirm step, Inhalte & Rechte rows, member chips) via
  content-section-label.js; custom section names pass through.
- Sie→Du sweep for the flows the journeys hit: signup wizard,
  community-creation wizard, keypair generator (37 strings).
- Chat/DM timestamps localized ("jetzt") and dates formatted in the
  active European locale instead of the browser locale.
- Channel-wizard invite step: a pasted npub of a non-member now renders
  as a selectable row instead of silently landing in an invisible
  selection; invite inbox resolves the inviter's profile name instead of
  raw hex.
- Onboarding step-4 button "Fertig" → "Weiter" (a 5th step follows).
- Directory type-badge tooltips now carry the full type description.
- False alarms on re-check: sidebar padlocks and chat empty state already
  have tooltips/copy — testers hit timing/hover gaps, not missing UI.

Still open (needs deeper work): stale-type flash on reload (data
freshness), key-backup surfacing in onboarding (design decision),
member-add name search + clipped dropdown, Concord invite dedupe, nsec
filename, remaining app-wide Sie/Du outside the tested flows.

## Fifth pass (laoc testing round, 2026-08-17)

- Chat composer invisible on empty chats: the input pill was base-200 on
  the base-200 page — now base-100 with a border (reply bar matched).
- Chat send "failed": account npub1uvh06f6… has NO kind 10002 on any
  relay (verified: relay.edufeed.org, purplepag.es, damus, nos.lol) —
  publishes then target only the 4 FALLBACK_RELAYS, and in that browser
  session several were unreachable/rejecting; on total failure the
  optimistic publish silently REMOVES the message again. Fixes: total
  send failure now toasts + restores the composer text, and
  saveRelayList additionally publishes the new list to the NEW relays
  themselves + the lookup indexers (breaking the "broken relay list
  can't be fixed" deadlock; purplepag.es previously never received relay
  lists at all). Note: the settings save itself reproduced FINE here
  (10002 landed on 3 relays) — the user's error was the environment, the
  robustness gap was real regardless.
- Double sidebar on the channels view: PrivateChannelsView's own rail is
  now MOBILE-ONLY; the app sidebar's KANÄLE zone is the single desktop
  surface, gaining the rail's controls: permanent "+ Neuer Kanal" (owner),
  "✉ Erhaltene Einladungen" (opens the invite inbox via ?invites=1 deep
  link), and the notification bell; group-mode attach/area-members moved
  into the overview pane (desktop-only action bar).

## Sixth pass (invite UX round, 2026-08-17)

- Invite card enriched: sender resolves to profile name + avatar (trust
  decision first), then area name, then an explicit access line ("Du
  erhältst Zugang zum privaten Bereich." + granted channel names from the
  bundle). Description/image are NOT in the CORD-05 bundle — only name,
  icon pointer, channels, creator — so no fake metadata is shown.
- Accept now navigates INTO the accepted area: the hosting community's
  Kanäle view when the modal belongs to it, else /private/<id>; the first
  granted channel is pre-selected. Verified live (Jonas → Geheimclub,
  landed in # Geheimtreff with messages readable).
- Sending-side scope: the channel invite sheet states "Die Einladung gilt
  für den gesamten privaten Bereich — inklusive Zugang zum Kanal ‚X'".
- Surfacing (UX consult): three surfaces already existed (Termi hint,
  dashboard card, sidebar badge) — the missing one was the GLOBAL BELL.
  Pending invites now count into the bell badge and render as a pinned
  row in the bell dropdown ("N Einladung(en) in private Bereiche …
  Ansehen" → opens the global concordInvites modal). Verified live.
- "Group but no channels" after accept: root-caused as engine sync
  latency (client emits communities$ correctly; the E2E channel metadata
  takes seconds). The channels pane now shows a "Bereich wird
  synchronisiert …" state with spinner instead of claiming emptiness.
