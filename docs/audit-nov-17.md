# Audit — the table link (2026-11-17)

A security audit of the table link alone: `src-tauri/src/table_link/`, its capabilities and command
registration, `src/lib/table-link/`, and `src/routes/table/`, following data into whatever they
reach. Audited at `009b54b4`; the question window (`e6a23f66`) and the fixes landed after it.

**Mode:** full. A blind pass by an independent agent, with no access to earlier audits, the threat
research or the security tracker, read the code against the threat model below; a second pass
walked the maintainers' own checklist of recurring faults; the two were then merged. Every finding
the blind pass reported as reproduced was re-run here, and every fix is held by a test in which the
attack no longer gets through.

**Threat model:** `internals/table-link.md` ▸ Who is trusted, and `internals/security.md`. Every
peer runs a modified build; relays and the network are untrusted; the GM may see and ask, never
apply; a player may say what their own sheet says; script in the page is an attacker class; a
table's key never lands in a file. The feature is in no release build, so none of this reached a
user.

- **CONFIRMED** — reproduced by a test against real endpoints on one machine, or by `cargo audit`.
- **LIKELY** — traced in code, not run.

A box is ticked by the rule in `internals/work-artifacts.md` ▸ "A box turns `[x]`…". The file is
deleted, with its line in `README.md`, once every box is ticked.

## Findings

### [x] T1 · A seat let in could take any name on its next connection — medium · closed

A key the GM had let in was seated again on any hello, under the name that hello carried: a player
let in as one name reconnected as another — "GM" included — and the GM's screen renamed the seat
while their rolls reached every other player under the new name. A seat card and the "whom to ask"
picker also printed the name the player's sheet claimed. **Fix:** a known key sits under the name it
was let in by; the GM's screen shows that name; the GM's rolls carry a badge no name can draw.
**Held by:** `session.rs` ▸ `a_seat_let_in_sits_again_under_the_name_it_was_let_in_by`. Blind pass.

### [x] T2 · A record's time, which its author sets, decided what the log kept — medium · closed

Eviction took the record with the oldest time, so a seated player writing records dated far ahead
was never evicted, every other author's later roll was dropped on arrival, their numbers restarted
at one, a hide could outlast the roll it hid, and the page sorted the flood above everything.
**Fix:** the record that arrived first goes; one dated more than ten minutes ahead is refused; an
author's numbers go on past eviction; a hidden roll frees its place on the page. **Held by:**
`records.rs` ▸ `a_far_future_time_neither_pins_the_log_nor_pushes_anyone_out`. Both passes.

### [x] T3 · Sixteen silent dials kept everyone out — medium · closed in part

Anyone who knew the GM's key and route could hold the sixteen greeting places with connections that
never say hello, so nobody — not even a player let in before — could sit, and shutting the door did
not help. **Fix:** handshakes have their own pool; a key let in before skips the greeting pool; at a
shut door a stranger is let go at once, told why. **Held by:** `session.rs` ▸
`strangers_who_never_say_hello_keep_out_nobody_already_let_in`. **Still open:** while the door is
open, strangers can crowd out NEW joiners (TABLE-LINK-AUDIT-OPEN). Blind pass.

### [x] T4 · A dismissed seat that stopped reading kept its seat — medium · closed

Dismissing a seat only queued a goodbye; a peer that stopped reading filled its queue, never got the
goodbye, and was handed rolls made after it was sent away. **Fix:** dismissing a seat, or a newer
connection of its key, closes the old connection. **Held by:** `session.rs` ▸
`a_dismissed_seat_that_stopped_reading_is_cut_off`. Blind pass.

### [x] T5 · One seat could spend another author's pace — low-medium · closed

The pace limit counted per author and before the held-already check, so a seat replaying another
player's public records silenced that player's next rolls. **Fix:** a held record costs nothing,
and pace is counted against the seat that hands a record over. **Held by:** `session.rs` ▸
`a_seat_replaying_another_authors_rolls_spends_its_own_pace_not_theirs`. Blind pass.

### [x] T6 · `quinn-udp` 0.5.15: a receive loop that spins on a truncated datagram — medium · closed

RUSTSEC-2026-0538, under iroh's transport: anyone reaching a table's UDP port could make the app
spin. **Fix:** 0.5.16. **Held by:** `cargo audit` in the release checklist. Checklist pass.

### [x] T7 · A name in a question could reword it — low · closed

`plain_text` kept quotation marks, line and paragraph separators and invisible format characters,
so a forty-character name could close its quotes and add a sentence; placeholders were filled one
after another, so a name reading `{code}` was filled in again; an invitation could carry a relay
AND addresses while the question named only the relay. **Fix:** those characters are dropped,
placeholders are filled in one pass, and a two-route invitation is not one. **Held by:** `wire.rs` ▸
`a_name_is_printed_without_what_could_reword_a_dialog`,
`an_invitation_survives_being_pasted_and_nothing_else_is_one`; `mod.rs` ▸
`a_question_prints_what_it_was_given_as_data`. Blind pass.

### [x] T8 · The question defaulted to "allow" — low · closed

The system message box put the default on its first button, Allow, and a request that replaced
the one just answered kept the focus on Accept, so a second press accepted what had not been read.
**Fix:** the question window starts with the focus on the refusal (`e6a23f66`), and the request
dialog opens anew, focus on Decline, for each request. Not held by a test — the request dialog's
focus is checked by `/dev/table`, the question window by the live drive. Blind pass.

### [x] T9 · A peer could word a logged roll with any sentence of the app — low · closed

A roll's name carried any catalog key, which the log translated. **Fix:** only a roll's own keys
(`combat.roll.check|save.*`, `skillName.*`) are translated; any other shows the roll's own words.
Blind pass.

### [ ] T10 · What is still open, all low

In TABLE-LINK-AUDIT-OPEN (`work/release.md`): with the door open, strangers can crowd out new
joiners (T3); page script can forget or leave a table, reopen the door and dismiss seats without a
question; the player's side believes the GM on names, pace and hides, which is the trust the model
gives the GM, but its disk writes are unpaced; `have` tells every seat how many rolls each author
kept to the GM; the request prompt can name a state by the first row of its id in the graph while
the sheet applies the character's own row. Blind pass, except the page-script commands (both).

## Ruled out

The command ACL (every command declared, granted to its window only, nothing that opens a window),
no socket before a yes, the transport preset and dial policy, frame bounds and closed shapes, record
signatures (domain, exact text, table, author), hide authority on the GM's side, `visible_to` on
both the live and the `have` path, the door and its secret, the remembered tables' file names and
writes, every peer event held to its schema, and peer text rendered as text.

## Not checked

The real desktop app: the question window's look and focus on Windows, the Windows credential store
under a real profile, the fs scope over the local data folder at runtime; macOS and Linux; relayed
connections; `/dev/table-link*`.

## Outside the table, found on the way

- **The web build has no CSP** — the desktop's refuses inline script, the web's has none. Before a
  table on the web, in TABLE-LINK-WEB.
- **JS advisories** (`pnpm audit`): `@sveltejs/kit` and `adapter-static` (server and Vercel paths
  the static build does not run), `deepmerge` under `svelte-i18n` (merges the app's own catalogs),
  `minimatch` under eslint (dev only). None reaches a user.
