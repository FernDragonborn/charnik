# Table link — threat model and attack catalog

Research collected 2026-10-04, before the first spec of the **table link**: an opt-in module that
lets a GM's Charnik and the players' Charniks exchange data across networks, in both directions,
with no server anyone has to deploy. Transport candidate: iroh.

This document is the input to that spec. It lists the ways **our** layer can hurt a user, how each
one would actually show up in Charnik, and what the spec must do about it. It deliberately does not
audit iroh itself — that is a stated trust assumption (§2), checked only at the API level we depend
on.

**Pinned versions.** Every code reference is to these exact commits, so a reader can check it:

| What | Version / commit |
| --- | --- |
| Charnik | `9e4bcebf0f3f57912ea8d732df4c1b7c5e1fbd39` (0.7.0) |
| iroh (workspace) | `n0-computer/iroh@b4c8fc68ef21b78781741fab8c6c86a1043d0f97` (`iroh` 1.3.0) |
| iroh-gossip | `n0-computer/iroh-gossip@2885dd9f1120e46aca5acbcd7f212e4c64e278b9` (0.101.0) |
| JS libs (Charnik lockfile) | zod 4.6.2, dompurify 3.4.15, marked 18.0.12 |
| Rust libs (experiments) | serde 1.0.229, serde_json 1.0.151 |

## 0. How to read this

Every factual claim carries a tag saying how it is known. A claim without a tag is a definition or a
restatement of the design, not a fact about the world.

| Tag | Meaning |
| --- | --- |
| **[code]** | Read in source at the pinned commit; file and line given. |
| **[exp]** | Reproduced by an experiment in Appendix A, with the output quoted. |
| **[spec]** | Standards-track or IETF/W3C/Unicode publication (incl. Informational and BCP RFCs). Section given. |
| **[doc]** | Vendor documentation. May drift; re-check before relying on it. |
| **[lit]** | Published research, advisory or CVE record. |
| **[inference]** | Our own reasoning from the above. Not verified. Argue with it. |
| **[device]** | Cannot be checked without real devices/networks. Procedure in §5. |

Mitigations are marked **MUST** (no networked release without it), **SHOULD** (do unless there is a
written reason not to), **MAY** (worth considering).

## 1. Scope

**In scope — the parts we write and can get wrong:**

- pairing and invitations (tickets, deep links, join approval, remembered peers);
- identity and authorization above iroh (who may connect, who may send what);
- the protocol envelope and its decoding, at the Rust boundary;
- the boundary between Rust and the webview, and how peer data is rendered;
- applying GM requests to a character, and storing what peers send;
- what leaves the device (egress), including attempts by our own code to send traffic the protocol
  does not define;
- privacy-relevant iroh settings we choose (direct vs relay-only, discovery, port mapping);
- key storage.

**Out of scope:** iroh's internals (QUIC, TLS, hole punching, relay server code) beyond the
assumptions in §2; supply chain and release signing (asked to be left out); the web demo, which gets
no networking at all.

**Design assumptions this catalog was written against** (from the design discussion, not yet a
spec): the GM and players exchange messages in both directions; a GM's message to a player is a
*proposal* applied through the same actions as local UI; only the player's own app ever writes that
player's `character.json`; networking is off unless the user turns it on.

## 2. What we rely on from iroh

Each assumption is something our design leans on. If any of them stops being true, the entries that
cite it must be revisited.

| # | Assumption | Evidence |
| --- | --- | --- |
| A1 | Dialing an `EndpointId` authenticates the **server**: TLS 1.3 with raw public keys (RFC 7250), the certificate key must equal the dialed id. A wrong id fails the handshake. | [code] `iroh/src/tls.rs` L1–6; `iroh/src/tls/verifier.rs` L33–72 (key comparison at L68–72). [exp] P3 |
| A2 | The accepting side does **not** authorize clients. Any key that completes the handshake is served; deciding who may connect is the application's job. | [code] `verifier.rs` L125–138 ("we don't check the client certificate"). [exp] P2 |
| A3 | Two enforcement hooks exist: `after_handshake` (sees the remote id and ALPN, can reject) and `before_connect` (can abort an outgoing dial before any packet is sent). | [code] `iroh/src/endpoint/hooks.rs` L69–107 ("aborted before any packets are sent", L74–75). [exp] P4, P5 |
| A4 | A relay-only mode exists: `Builder::clear_ip_transports()` removes direct IP paths. | [code] `iroh/src/endpoint.rs` L508–514; used as "disable direct" in tests, L2618 |
| A5 | `Endpoint::addr()` includes local interface IP addresses as soon as the endpoint is bound. A ticket built naively from it carries those IPs. | [code] `endpoint.rs` L1203–1217. [exp] P1 |
| A6 | The default address lookup (pkarr via n0's DNS) publishes **only the relay URL**, not IPs, unless the app changes the filter. Client-side Mainline-DHT publishing is a separate crate. Whether a pkarr relay forwards records into the DHT on the client's behalf is the relay's choice (pkarr.rs L17–20); n0's production DNS server config was not audited for it. | [code] `iroh/src/address_lookup/pkarr.rs` L17–25, L40–41 |
| A7 | A relay forwards datagrams addressed by destination endpoint id, so a relay operator can see which ids talk to which. n0's public-relay page states operators observe source and destination IP addresses, connection times and data volume, and that public relays are for development and hobby use only. Content stays end-to-end encrypted. | [code] `iroh-relay/src/protos/relay.rs` L185–190; [doc] iroh public relays page |
| A8 | UPnP/PCP/NAT-PMP port mapping is **on by default** (default cargo feature and default config). | [code] `iroh/Cargo.toml` L150; `endpoint.rs` L792–797; `PortmapperConfig` in `iroh/src/portmapper.rs` L20–39 |
| A9 | 0-RTT data is replayable and must never trigger non-idempotent operations. | [code] `iroh/src/endpoint/connection.rs` L524–525, L613–614. [spec] RFC 8446 §8 |
| A10 | iroh-gossip: `delivered_from` is the neighbour that forwarded a message, **not its author**; the protocol handler accepts every connection (no access control); default max message size is 4096 bytes; crate is pre-1.0 (0.101.0). | [code] iroh-gossip `src/api.rs` L363–372; `src/net.rs` L129–135; `src/proto.rs` L69 |
| A11 | Keys are Ed25519; `SecretKey::generate()` draws from `rand::random()`; `SecretKey::sign` / `PublicKey::verify` are available, so envelope signing needs no new crypto dependency. | [code] `iroh-base/src/key.rs` L134, L318–328 |
| A12 | A self-hosted relay supports access control (allowlist/denylist by endpoint id, or a shared bearer token). | [doc] `iroh-relay/README.md` L41–84 |

**Consequence that drives the whole design** [inference]: iroh gives us *authenticated, encrypted
pipes*. It does not give us *membership*. Everything about who is at the table, and what each of
them may say, is ours.

## 3. Actors and trust boundaries

**Actors**

- **T1 — invited friend.** Known person; may prank, may have a compromised device.
- **T2 — stranger at a public table.** Discord-community games, streamers' games.
- **T3 — modified build.** Charnik is FOSS; any peer may run a build that sends anything the wire
  allows. A peer cannot prove which build it runs: any proof a client sends, a modified client can
  replay, and hardware attestation is platform-locked, needs the platform vendor's servers and
  excludes self-built copies [inference]. **Every entry below assumes every peer is T3.**
- **T4 — outsider.** Has a leaked ticket; operates a relay; observes the network; or is another app
  on the same phone.
- **T5 — our own code.** A webview XSS, a plugin, or a plain bug that tries to send data the protocol
  does not define, or to talk to someone who is not at the table.

**Boundaries** (each arrow is a place validation must happen):

```
peer bytes ──▶ iroh endpoint ──▶ [B1] admission (after_handshake: is this key at this table?)
                                   │
                                   ▼
                            [B2] decoder (Rust: size, shape, version, signature, seq, role)
                                   │  typed, validated domain events only
                                   ▼
                            [B3] Tauri event ──▶ webview store ──▶ [B4] apply (actions, bounds,
                                                                         consent) ──▶ Storage
webview ──▶ [B5] Tauri command (typed, narrow) ──▶ Rust encoder ──▶ [B6] egress (before_connect,
                                                                         field allowlist) ──▶ peer
```

## 4. Threat catalog

Entry shape: **who** can do it · **how it shows up in Charnik** · **impact** · **evidence** ·
**mitigation** · **residual risk**.

### P — Pairing and invitations

**P1 — A leaked ticket lets an uninvited person join.**
Who: T4 (screenshot of a Discord message, chat logs, a bot in the channel). How: the ticket contains
everything needed to reach the GM; under A2 the GM's endpoint will serve them. Impact: a stranger
sees the party's sheets and can send messages. Evidence: A2, [exp] P2.
Mitigation: **MUST** — admission is enforced in `after_handshake` against a per-table allowlist
(A3, [exp] P4); a key not on it never reaches the protocol. **MUST** — an unknown key may only send
a *join request* carrying the invite secret, and the GM approves each request by hand. **MUST** —
the invite secret expires (time-boxed) and is single-use per seat. **SHOULD** — the GM can revoke an
invite and re-issue.
Residual: in the window between leak and approval, the GM must notice an unexpected requester. P4/I1
make that easier.

**P2 — Guessing or brute-forcing the invite secret.**
Who: T4. Impact: as P1. Mitigation: **MUST** — at least 128 bits from a CSPRNG (A11 uses `rand`;
the same source is fine) [inference: 2^128 is not enumerable; the real control is that guessing also
needs the GM's endpoint id and a live session]. **MUST** — compare in constant time (CWE-208) and
rate-limit join attempts per remote key (D1). Residual: negligible.

**P3 — Replaying an old invite, or reusing a ticket after being removed.**
Who: T1/T2 who was kicked; T4 with an old screenshot. Mitigation: **MUST** — single-use secrets
(P1); **MUST** — removal deletes the key from the allowlist, so the remembered-peer path (P9) also
closes. **MUST** — a join request is never carried in 0-RTT data (A9). Residual: none beyond P10.

**P4 — Fake GM: an attacker hands out their own ticket.**
Who: T2/T4 posting "here is tonight's table" in a community channel. How: the player joins a table
the attacker controls; the attacker's app collects the player's snapshot and sends requests. Impact:
information disclosure (A4 below), griefing proposals (A1). Evidence: social engineering; no
technical control fully stops it [inference].
Mitigation: **MUST** — the join screen shows the table name *and* the GM's key fingerprint before
anything is sent. **SHOULD** — a short authentication string (SAS) both screens show and the
players compare out of band (aloud at the table or on a call), in the spirit of Signal's safety
numbers, which users compare or scan [doc], and ZRTP's SAS ([spec] RFC 6189). The SAS **MUST** be
derived from fresh per-session values exchanged commit-before-reveal: ZRTP's hash commitment exists
because without it a man-in-the-middle can try many key values until both short strings match
([spec] RFC 6189 §4.4.1.1). Static endpoint keys alone are not enough, since an attacker can grind
fresh keys offline against a short string [inference]. **MUST** — nothing is
shared on join until the player confirms what is shared (A4).
Residual: a user who skips every check can be fooled. The damage is bounded by A1/A4.

**P5 — Ticket swapped in transit.**
Who: T4 with a compromised chat account. How: the player receives a ticket with the attacker's key;
the attacker can sit in the middle by joining the real table under its own key. Evidence: A1 binds
the connection to whatever key the ticket names, so the swap itself is undetectable by crypto
[inference]. Mitigation: the SAS from P4 detects it — but only with the commit-before-reveal
construction P4 requires; then the attacker gets one guess per session at making both ends show the
same string ([spec] RFC 6189 §4.4.1.1), and it holds only if users actually compare. **MUST** — the GM sees each member's fingerprint (I1),
so an extra, unexplained member is visible.
Residual: depends on users comparing.

**P6 — The ticket leaks IP addresses.**
Who: anyone who sees the ticket. How: a ticket built from `Endpoint::addr()` carries local interface
IPs (A5, [exp] P1 shows a non-loopback address), and public addresses once discovered
[inference: from A5's docstring, which says the remaining fields depend on connectivity].
Mitigation: **MUST** — tickets for internet play contain the endpoint id, relay URL(s), table id and
invite secret only — no IPs. **MAY** — a "same room" ticket variant that includes LAN addresses,
labelled as such. Residual: none in the ticket; IPs still reach peers on direct paths (V1).

**P7 — Deep links (`charnik://…`).**
Who: T4, including another app on the same phone. How: (a) a link that auto-joins or auto-shares;
(b) on mobile, several apps can register the same private-use scheme, so a malicious app may receive
the link and steal the ticket ([spec] RFC 8252 §8.1); (c) a malformed link exercises our parser.
Tauri notes a deep link can also be faked via a command-line argument [doc Tauri deep-linking].
Relevant weakness: CWE-939.
Mitigation: **MUST** — a deep link only ever opens a confirmation screen; it never joins, sends or
writes by itself. **MUST** — parse the link in Rust with the same strict decoder as network input
(M2–M4). **MUST** — P1's controls make a stolen ticket insufficient on its own. **MAY**, mobile only —
verified https links (Android App Links, iOS Universal Links), which require hosting `.well-known`
files; on desktop Tauri offers custom schemes only, delivered as a command-line argument on Linux and
Windows [doc Tauri deep-linking].
Residual: a stolen-and-approved ticket is P1's residual.

**P8 — Join-request spam.**
Who: T4 with a leaked ticket. Impact: the GM's screen fills with prompts mid-session. Mitigation:
**MUST** — rate-limit requests per key and globally (D1); **SHOULD** — collapse repeats from one key;
**SHOULD** — "stop accepting requests" toggle; expired tickets reject before any UI. Residual: an
attacker with many keys (Sybil — Douceur 2002 [lit]) can still create noise until the GM closes
requests.

**P9 — Tampering with remembered peers.**
How: after the first approval, apps remember each other's keys so later sessions reconnect without
a ticket (trust on first use). If that list lives in the data folder — which the user syncs, backs
up and shares — anyone who can edit the folder can add a key. `security.md` §2 answers the same problem for the data-dir pointer by keeping it in
app config, which it describes as Rust-owned [doc `docs/internals/security.md`].

**That premise does not hold today, and the table link must not inherit it.** The webview's
capability grants `fs:allow-appconfig-read-recursive` with `$APPCONFIG/**` in scope, and
`fs:allow-appdata-write-recursive` over `$APPDATA/**` ([code] `src-tauri/capabilities/default.json`).
Tauri resolves `app_config_dir` and `app_data_dir` to the same directory on Windows
(`{FOLDERID_RoamingAppData}`) and macOS (`~/Library/Application Support`), only differing on Linux
[doc docs.rs `tauri::path::PathResolver`]. So page script can read anything in app config on every
platform, and on Windows and macOS can also write the pointer file
(`<appConfig>/config.json`, [code] `src-tauri/src/lib.rs` L30–39) [inference from the two
sources; confirm on a device, §5]. Plugin consent lives in `localStorage`, which page script also
controls ([code] `src/lib/effects/plugin-host.ts` L236–248 via `src/lib/util/persist.ts` L10–28).
Mitigation: **MUST** — table keys, remembered peers and allowlists live where the webview has no
capability at all: either a directory no fs scope covers, or the OS keychain (K1). **MUST** — narrow the existing capabilities so such a directory exists. Removing
`fs:allow-appconfig-read-recursive` alone is not enough: `fs:default` (also granted) includes
`read-app-specific-dirs-recursive`, full recursive read of the app folders [doc Tauri file-system
plugin], and the capability's own `fs:scope` lists `$APPCONFIG`. So: replace `fs:default` with
explicit permissions, drop `$APPCONFIG` from the scope, and scope the app-data write to a subfolder. This also repairs the data-dir pointer guarantee in `security.md` §2,
independent of the table link. Residual: an attacker with full user-level access to the machine is
out of scope (they own everything anyway).

**P10 — Removal does not un-share.**
How: a removed member keeps whatever they already received. This is inherent to sending data to
another device [inference]. Mitigation: **MUST** — say so in the UI when removing; **SHOULD** —
removal rotates the table key so the removed member cannot recognise the table's endpoint later.
Group key schemes with post-compromise security exist (MLS, [spec] RFC 9420) but solve a larger
problem than a ≤10-person table; out of scope for v1 [inference].

### I — Identity and authorization

**I1 — Display-name spoofing.**
Who: T2/T3. How: a peer calls itself "Вафель" with a Latin "a" in place of Cyrillic "а", or embeds a
bidirectional override so the name renders reversed. [exp] E8c: zod `string().max(32)` accepts
U+202E; [exp] E8d: look-alike strings are different strings. Class: Trojan Source, CVE-2021-42574
[lit]; mixed-script confusables, Unicode UTS #39 [spec].
Mitigation: **MUST** — identity in the UI is the key fingerprint (a short word/emoji rendering of
the key), with the name as a label the GM may override locally. **MUST** — strip bidi controls
(U+202A–U+202E, U+2066–U+2069) and other format characters from names. **SHOULD** — flag
mixed-script names (UTS #39). Residual: users who ignore fingerprints (P4).

**I2 — Forging a message through a forwarding peer.**
How: under gossip, a message arrives from a neighbour who is not its author (A10). Any member could
inject "GM says: take 30 damage". Under a star topology with the GM as hub, the GM forwards player
broadcasts (rolls) and could alter them.
Mitigation: **MUST** — every envelope is signed by its author's table key (A11) over the full
envelope, and verified in Rust before anything else looks at it. **SHOULD** — v1 uses direct
connections in a star around the GM rather than iroh-gossip: gossip is pre-1.0, has no access control
(A10), and its default 4 KiB message cap is below a character snapshot [inference: snapshot size not
yet measured — measure before deciding]. Residual: none for forgery; a hub can still *drop* messages
(D-class).

**I3 — A player sends GM-only messages.**
Mitigation: **MUST** — the role is bound to the key in the table's Rust state; the decoder rejects a
message type the sender's role may not send, before it becomes an event. The webview never decides
authorization. Residual: none.

**I4 — Cross-table confusion.**
How: a message signed for table A is replayed into table B, where the same people play. Mitigation:
**MUST** — the table id is inside the signed bytes; **MUST** — keys are per table (also V4).

**I5 — Signature reuse across contexts.**
How: if the endpoint's secret key signs envelopes, a signature produced for one purpose could be
presented in another [inference]. Mitigation: **MUST** — sign `"charnik/table/v1" || len || envelope`
(domain separation), never raw payloads; or use a separate signing key per table.

### M — Protocol and parsing (boundary B2)

**M1 — Parser differentials between Rust and JavaScript.**
How: the same bytes mean different things to two parsers. [exp] R1a/R1b/E1: serde rejects a
duplicate field in a struct, but a `HashMap` and `JSON.parse` both keep the *last* value
(`{"hp":10,"hp":-999}` → `-999`). [exp] R5a/E3b: `1e400` is an error in serde_json and `Infinity`
in `JSON.parse`. RFC 8259 §4 only says object names SHOULD be unique [spec]. Bishop Fox surveyed 49
parsers in 10 languages and found risky divergences in every language (duplicate-key precedence,
number handling, permissive parsing) [lit].
Mitigation: **MUST** — the webview never parses peer bytes. Rust decodes into typed structs, then
*re-serializes* what it validated and emits that to the webview. One parser decides; the other only
ever sees canonical output. Residual: none if held.

**M2 — Unknown types, fields and versions.**
[exp] R2a: by default serde silently ignores unknown fields; R2b: `deny_unknown_fields` rejects
them. [exp] R3a: a closed `#[serde(tag = "type")]` enum rejects an unknown variant
(`"WriteFile"`). [exp] E2k: zod `strictObject` rejects unknown keys; [exp] E2j: plain `object` strips them.
RFC 9413 documents why tolerant ("be liberal in what you accept") parsing harms protocol security
over time [spec].
Mitigation: **MUST** — closed enums for message types, `deny_unknown_fields` on every struct,
reject unknown protocol versions. **MUST** — the protocol version is also in the ALPN
(`charnik/table/1`), so an incompatible major version fails at the handshake.

**M3 — Numbers out of range.**
[exp] R3b–R3d: a `u16` field rejects 70000, -5 and 5.5. [exp] E3c/E3d: zod `number()` rejects
`Infinity`; `int()` rejects values beyond 2^53. [exp] E3e: `int()` accepts `-0`.
Mitigation: **MUST** — every numeric field is the narrowest Rust integer type with an explicit domain
bound (damage ≤ a protocol cap, condition ids from the shipped list). **SHOULD** — normalise `-0`.

**M4 — Resource exhaustion while decoding.**
[exp] R4: serde_json stops at nesting depth 128 by default. [exp] E4: V8's `JSON.parse` parsed 5
million nested arrays without error. [exp] E4z: a recursive zod schema **threw** `RangeError` at
depth 10 000 — an exception, not a `safeParse` failure, so a caller relying on `success: false`
crashes instead. [exp] E5: zod `string()` with no `max` accepted a 50 MiB string. Charnik's character
schema has unbounded strings today (e.g. [code] `src/lib/character/schema.ts` L179 `notes`, a
`build` field that a share scope could include) — harmless for local files, not for network input. Weakness class: CWE-770.
Mitigation: **MUST** — a hard size cap per message *before* parsing (frame length check in Rust);
per-field length caps; caps on array/record sizes; no recursive types in the wire schema. **MUST** —
the TS-side zod schemas for network events get explicit `max()`s and no recursion (defence in depth
behind M1).

**M5 — Replay and reordering.**
How: a captured or re-sent valid message ("heal 10") is applied twice. Encryption does not stop an
authenticated peer from resending its own old messages, and A9 makes 0-RTT data replayable by the
network. Weakness: CWE-294. Mitigation: **MUST** — every envelope carries a session id and a per-
sender monotonic sequence number inside the signed bytes; the receiver rejects ≤ last seen.
**MUST** — no 0-RTT for anything that changes state (A9). **SHOULD** — each proposal has a unique id,
and accept/reject is idempotent per id.

**M6 — Version downgrade.**
How: a peer claims an old protocol version to reach an older, weaker code path. Mitigation: **MUST**
— a minimum supported version that only goes up; versions below it are rejected, not adapted
(M2).

**M7 — Prototype pollution in the JS layer.**
[exp] E2a–E2e: `JSON.parse` creates an *own* `__proto__` property; spreading the object is
harmless, but `Object.assign({}, parsed)` gives the target the attacker's prototype. [exp] E2f–E2i:
zod 4.6.2 `record()` dropped the `__proto__` key. Weakness: CWE-1321.
Mitigation: **MUST** — M1 (the webview only receives Rust-canonicalised data); **MUST** — never merge
raw peer objects into app state with `Object.assign` or deep-merge helpers; build new objects from
validated fields.

**M8 — Text encoding.**
[exp] R7/R7b: serde_json rejects an unpaired surrogate escape and invalid UTF-8 bytes. [exp] E8e:
NFC and NFD forms of "é" are different strings. Mitigation: **SHOULD** — normalise identifiers and
names to NFC before comparing or displaying; never compare raw.

### W — Rendering peer content in the webview (boundaries B3/B4)

**W1 — XSS through peer-supplied text.**
How: notes, names, chat — any free text a peer controls. Charnik renders content prose with `{@html}` over
`marked` + DOMPurify ([code] `src/lib/content/markdown.ts`). [exp] E7: `marked` passes raw HTML
through untouched, so DOMPurify is the only barrier. [exp] E6: with its default config DOMPurify
removed `<script>`, `onerror`, `javascript:` and `file:` links, `<iframe>`, `<meta>`, `<base>` — but
kept `<form action="https://…">` with inputs and buttons, inline `style` attributes, and remote
`<img src>`. DOMPurify keeps shipping fixes: eleven advisories were published between 19 May and 3 August 2026.
Most concern non-default modes (`IN_PLACE`, hooks, `setConfig`), which Charnik does not use, but the
one rated High (CVSS 8.2, GHSA-87xg-pxx2-7hvx, fixed in 3.4.5) bypassed the default `sanitize()`
string path [lit GitHub advisories]. Charnik's 3.4.15 includes that fix; the point is that the default
path is not immune.
Mitigation: **MUST** — v1 renders all peer text as *plain text* through Svelte's escaping text
interpolation, never `{@html}`. **SHOULD**, if formatting is wanted later: a dedicated DOMPurify
profile for peer content with an explicit small `ALLOWED_TAGS`, no `style`, no `form`, no `img`.
**MUST** — keep DOMPurify current (Dependabot is configured: `.github/dependabot.yml`).

**W2 — A `<form>` navigates the app window to an attacker's page.** *(also affects content packs
today)*
How: [exp] E6 shows DOMPurify keeps `<form action="https://attacker…">`. CSP `form-action` and
`base-uri` do **not** fall back to `default-src` — the fallback list covers fetch directives only [spec CSP3 §6.8.3; §6.3.1, §6.4.1] — and Charnik's CSP sets
neither ([code] `src-tauri/tauri.conf.json` `app.security.csp`). Charnik's link guard is a click
listener for links ([code] `src/routes/+layout.svelte` L156–171; [doc] `security.md` §5), which a
form submission does not go through: the handler only acts on `closest('a[href]')` [code]. A remote page loaded in the window gets no IPC by default [doc Tauri capabilities], so
the impact is a convincing phishing page *inside the Charnik window*, plus loss of app state.
Mitigation: **MUST** — add `form-action 'none'; base-uri 'none'` to the CSP. **MUST** — block
navigation to anything but the app's own origin in Rust with `WebviewWindowBuilder::on_navigation`
(returning `false` cancels) [doc docs.rs tauri]. **SHOULD** — `FORBID_TAGS: ['form']` in the
existing DOMPurify calls. Residual: [device] — whether each platform webview (WebView2, WebKitGTK,
WKWebView, Android WebView) actually submits such a form; verify per §5 before calling this closed.

**W3 — UI redressing with inline styles.**
How: [exp] E6 keeps `style="position:fixed;inset:0"`, so peer text can draw a full-window overlay
that imitates a Charnik dialog ("re-enter …", "accept GM request"). Weakness: CWE-1021. Mitigation:
W1's plain-text rule; if HTML is ever allowed, forbid the `style` attribute for peer content.
**MUST** — consent prompts for network actions are rendered in a fixed app-owned layer that peer
content cannot reach [inference: with plain-text rendering this is automatic].

**W4 — Tracking pixels and remote loads.**
How: [exp] E6 keeps remote `<img src>`; loading it would tell the attacker the viewer's IP and that
the message was opened. `img-src` *does* fall back to `default-src` [spec CSP3 §6.8.3], and Charnik's
`default-src 'self'` blocks it today. Mitigation: **MUST** — never add remote sources to the CSP;
**SHOULD** — a test that asserts the CSP string (none exists today — searched `src` and `tests` for
CSP tests, found none [code]).

**W5 — Malicious images from peers.**
How: a portrait sent over the network is decoded by the platform's image decoder. Charnik decodes
picked photos in the webview with `createImageBitmap` ([code] `src/lib/character/photo.ts`), so a
network photo would reach the same decoder *before* re-encoding. Image decoders are a proven attack
surface: libwebp's CVE-2023-4863 (CVSS 8.8) affected Chrome, Firefox and Edge and was exploited in
the wild (listed in CISA KEV) [lit NVD].
Mitigation: **MUST** — no images over the network in v1. **SHOULD**, later: decode and re-encode in
Rust with a memory-safe decoder before the webview ever sees the bytes, with dimension and byte caps
[inference: choose and verify a specific crate's decoders at that time].

**W6 — What a successful XSS would buy.**
Not a separate attack — the blast radius that makes W1–W5 matter. Script in the webview can call
every permission in `src-tauri/capabilities/default.json` ([code]): read/write/remove in the data
folder and `$APPDATA`; read all of `$APPCONFIG` (via both `fs:allow-appconfig-read-recursive` and `fs:default`) (and, on Windows and macOS, write it — P9); open any
`http(s)`, `mailto:` or `tel:` URL in the OS ([doc Tauri opener]: `opener:default` includes
`allow-default-urls`), open paths and reveal items; the `process` and `updater` defaults; HTTP
requests through `plugin-http` to `https://api.github.com/repos/*` and
`https://raw.githubusercontent.com/*` — the CSP does not govern plugin IPC, so this is a network
channel the CSP does not close [inference: the scope limits URLs; whether methods such as POST are
limited was not verified]; and — once the table link exists — every table command. Mitigation: **MUST** — table commands are narrow (B5): send a *typed* proposal to a *member
id from Rust state*; no "send bytes", no "dial address". **MUST** — destructive table actions (leave,
remove member, change sharing) re-confirm in a native dialog. **MAY** — Tauri's isolation pattern,
which intercepts IPC in a sandboxed iframe before it reaches the core [doc Tauri isolation] (notes
Windows caveats: inlined scripts, no ES modules).

### A — Application semantics (boundary B4)

**A1 — Griefing through GM requests.**
Who: a T3 "GM" or a fake one (P4). How: requests to set HP to 0, add every condition, spam rolls.
Mitigation: **MUST** — the request vocabulary is a closed list with bounds (damage/heal amounts
capped, conditions from the shipped list, no free-form writes). **MUST** — network requests may only
touch `play`, never `build` or `ui` ([code] `src/lib/character/schema.ts` defines the split).
**MUST** — auto-accept is off by default and per table. **MUST** — every applied request is
journaled with an undo; the existing snapshot rings ([doc] `docs/internals/characters.md`) remain
the backstop. Residual: an accepted request can be wrong; undo covers it.

**A2 — A player's app lies about its character.**
Who: T3. How: a modified build reports any stats it likes; the GM's app can recompute from the
reported `build`, but the `build` itself can be fake. Evidence: inherent — nobody can verify another
device's computation [inference]. Mitigation: **MUST** — label the GM's view as "as reported by the
player"; **non-goal** — anti-cheat. Residual: accepted.

**A3 — Rigged dice.**
How: a roll reported by a modified build is a claim. Mitigation: **MAY** — commit-reveal joint rolls
(both sides commit to a random value, then reveal; neither can bias the result alone — Blum, "Coin
flipping by telephone" [lit]); the known residual is that a party can refuse to reveal. Default v1:
rolls are labelled as player-reported.

**A4 — Over-sharing.**
How: a snapshot carries more than the player meant. `notes` is a field of `build` ([code]
`src/lib/character/schema.ts` L108 opens `buildSchema`, L179 is `notes`), so "share the build"
shares the notes unless they are excluded; the portrait and the roll log are siblings that could be
swept in. `textOverrides` (the player's own words over the content) is a `ui` field (L293 opens
`uiSchema`, L315). Mitigation: **MUST** — an explicit share scope per table, field by field, previewed
before the first send; `notes` excluded unless the player opts in; `ui` and anything outside
`build`/`play` never leave; **MUST** — never send paths,
settings, logs or keys (E5).

**A5 — Storing what peers send.**
How: if the GM's app saved a received character under `characters/<slug>/` the way local characters
are saved ([code] `src/lib/character/repository.ts` L96–98), a peer could collide with or overwrite
a local character. Locally created ids are safe: `uniqueCharacterId` appends a random suffix and
checks the folder does not exist ([code] `repository.ts` L324–332), `slugify` is ASCII-only so
`"../../etc"` becomes `"etc"` ([exp] E8b), and `sandboxRelative` rejects `..` ([code]
`src/lib/storage/path.ts`). The risk is trusting a *peer-supplied* `id`: a character's `id` is a slug
([code] `schema.ts` L31–33), so a peer can send the id of an existing local character, and a Cyrillic
name would slugify to `""` ([exp] E8a) if re-derived.
Mitigation: **MUST** — peer data never enters `characters/`; it lives in memory, or in a separate
cache keyed by `(table id, member key, a cache-local id we generate)` — never by a peer-chosen id or
name. **MUST** — a
byte quota for that cache.

### D — Denial of service

**D1 — Message floods.** Mitigation: **MUST** — per-peer and global rate limits in Rust before
decoding (`governor` is the established crate: GCRA, ~82M downloads [doc crates.io]); bounded queues
that drop, never grow; a peer that keeps exceeding is disconnected.

**D2 — Connection floods.** How: under A2 an attacker can complete handshakes; the `after_handshake`
reject happens after the cryptographic cost is paid ([exp] P4b: the uninvited client's `connect`
succeeds and the rejection arrives on first read). Mitigation: **SHOULD** — the endpoint only exists
while a table session is open (E7), shrinking the window; iroh ships an `IncomingFilter` example
that forces QUIC address validation before the expensive handshake for direct connections — relay
connections are accepted without it, so it does nothing against a flood arriving via a relay [code
`iroh/examples/incoming-filter.rs` L1–16]. Residual: a determined flood against a known, online endpoint
can degrade a session; accepted for a hobby table [inference].

**D3 — UI floods.** Toasts, join prompts, proposals. **MUST** — coalesce and cap per peer; never one
modal per network event.

**D4 — Storage growth.** **MUST** — caps on any persisted log of network events.

### E — Egress and unregulated traffic (boundaries B5/B6)

**E1 — The webview talking to the network directly.**
`connect-src` falls back to `default-src` [spec CSP3 §6.8.3], so Charnik's `default-src 'self'`
blocks `fetch`/WebSocket to other origins today. The CSP does not govern Tauri plugin IPC, so the
webview still reaches GitHub through `plugin-http` (W6). Mitigation: **MUST** — keep the CSP; the
table link lives in Rust and the CSP is not relaxed (the same choice `security.md` §7 made for pack
downloads). **SHOULD** — review whether the webview needs the `http` capability at all, or whether
pack fetching can be a narrow Rust command.

**E2 — Our Rust code dialing someone it should not.**
Mitigation: **MUST** — a `before_connect` hook allows dials only to members of currently joined
tables ([exp] P5: the dial fails locally; [code] `hooks.rs` L74–75: before any packet is sent). **MUST** — the
webview cannot pass an `EndpointAddr`; commands take ids that Rust resolves from its own state.

**E3 — Plugins.** Community plugins run in QuickJS with no network, DOM or Tauri access ([doc]
`security.md` §4). **MUST** — the plugin host API never gains a table-link function; **SHOULD** — a
test that asserts the host API surface.

**E4 — The opener as an exfiltration channel.** Already true today: script in the webview can open
any http(s) URL with data in the query string (W6). Mitigation: **SHOULD** — links that originate in
peer content go through a Rust-side check with a confirmation showing the full URL.

**E5 — Sending more than the protocol defines.** Mitigation: **MUST** — the encoder serialises only
the fields of typed Rust structs; there is no "raw payload" variant. **MUST** — logs never contain
keys, invite secrets or payloads (CWE-532).

**E6 — Router port mapping.** iroh asks the user's router for a port mapping by default (A8).
Mitigation: **SHOULD** — disable (`PortmapperConfig::Disabled`, [code] `endpoint.rs` L792–797, `portmapper.rs` L20–39)
unless the user opts in; relay fallback covers the connectivity loss [inference: measure the effect on
direct-connection rate in §5].

**E7 — Activity when nobody asked.** Mitigation: **MUST** — no endpoint is bound at app start; it
exists only while the user has a table session open, and closes with it. Networking stays off by
default. This keeps the table link from adding background traffic; it does not make the app offline —
the desktop app already checks for updates on every launch ([code] `src/routes/+layout.svelte` L186;
endpoint in `src-tauri/tauri.conf.json`).

### V — Privacy

**V1 — Peers learn your IP on a direct path.** Inherent to direct P2P; WebRTC's IP-handling
requirements exist for the same reason [spec RFC 8828]. Mitigation: **MUST** — a per-table
"relay only" switch (A4); **SHOULD** — default to relay-only for tables marked public. Residual: the
relay operator sees the IP instead (V2).

**V2 — The relay operator sees metadata** (which keys talk, when, how much; A7). Mitigation:
**SHOULD** — per-table keys (V4) so metadata does not link across tables; **SHOULD** — custom relay
list; self-hosted relays can restrict access (A12).

**V3 — Discovery publishing.** By default only the relay URL is published under the key (A6), which
still reveals that the key is online and its home relay. Mitigation: **SHOULD** — per-table keys;
**MUST NOT** — widen the publish filter to include IPs; Mainline-DHT publishing (separate crate, A6)
is a deliberate choice with its own review, since DHT records are public [inference].

**V4 — One key everywhere links your tables.** Mitigation: **MUST** — a fresh key per table.

### K — Key management

**K1 — Where keys live.** **MUST** — a location no webview capability reaches (P9: today's app
config does not qualify), never the data folder. **MAY** — the OS keychain via `keyring` (4.2.0, maintained [doc crates.io]); mobile support
is unverified [device].

**K2 — Keys leaking through backups and sync.** Follows from K1: the data folder is the part the
user is told they own and may share ([doc] `AGENTS.md` "The data belongs to the user").

**K3 — Loss and rotation.** Per-table keys are disposable: losing one means re-inviting, nothing
more.

### O — Operations

**O1 — There is no kill switch.** With no server, a vulnerable protocol version cannot be turned off
remotely [inference]. Mitigation: **MUST** — M6's minimum version, raised with each security fix and
shipped through the existing signed updater; networking stays opt-in.

**O2 — No vulnerability disclosure channel.** The repo has no `SECURITY.md` ([code] checked root,
`.github/`, `docs/`). **MUST** before release — add one and enable GitHub private vulnerability
reporting.

**O3 — Testing the boundary.** **MUST** — fuzz the Rust decoder (`cargo-fuzz`); property-test the TS
event schemas with `fast-check` (already a dev dependency [code] `package.json`).

**O4 — The written threat model is now false.** `security.md` opens with "no HTTP server … removes
the whole network attack surface", and `AGENTS.md` says the app "talks to the filesystem and nothing
else" ([doc]). **MUST** — rewrite both deliberately before the first line of table-link code.

## 5. Open questions — needs real devices

1. **W2:** on each webview, does a sanitized `<form action="https://…">` submit and navigate? Does
   `form-action 'none'` stop it? Does `on_navigation` fire? Procedure: a debug build with a content
   row containing the form, click submit, observe.
2. **V1/A4:** relay-only sessions across two real networks (home Wi-Fi + mobile hotspot). Latency and
   reliability.
3. **E6:** direct-connection rate with port mapping off vs on, same two networks.
4. **K1:** `keyring` on Android/iOS, or the platform keystore path for Tauri mobile.
5. **I2:** measure a real character snapshot's size against the 4 KiB gossip default.
6. n0 public relay rate limits are undocumented ([doc] "rate-limited to prevent abuse"), and the page
   scopes them to development and hobby use; measure a session's traffic to see whether it matters.
7. **P9:** on Windows and macOS, confirm that page script can write `<appConfig>/config.json` through
   the app-data write capability, and on every platform that it can read app config. Procedure: a
   `/dev/` probe that calls `@tauri-apps/plugin-fs` `writeTextFile` with `BaseDirectory.AppData` on
   `config.json` and reports whether the Rust pointer reader then sees the new value.

## 6. Release checklist (all MUST items, in order)

1. O4 — rewrite the threat model in `security.md` and the principle in `AGENTS.md`.
2. Fixes that do not wait for the table link, because they apply to today's app:
   - W2 — CSP `form-action 'none'; base-uri 'none'` + `on_navigation` guard (content packs);
   - P9 — narrow the fs capabilities (`fs:default`, the app-config read, `$APPCONFIG` in scope, the
     app-data write) so app config is not webview-readable or -writable (the
     data-dir pointer guarantee in `security.md` §2).
3. B1 — per-table allowlist in `after_handshake`; join requests with single-use, expiring 128-bit
   secrets; manual GM approval (P1–P3, P8).
4. B2 — Rust decoder: frame cap, closed enums, `deny_unknown_fields`, bounded fields, signature
   with domain separation, session + sequence, role check, minimum version (I2–I5, M1–M8).
5. B3 — webview receives only Rust-canonicalised events; plain-text rendering of peer content
   (M1, W1, W3).
6. B4 — closed, bounded GM request vocabulary; `play` only; auto-accept off; journal + undo (A1);
   share-scope preview (A4); peer data outside `characters/` (A5).
7. B5/B6 — narrow typed commands; `before_connect` allowlist; field-allowlisted encoder; no secrets
   in logs (W6, E2, E5).
8. Privacy — tickets without IPs (P6), relay-only switch (V1), per-table keys (V4), keys where no
   webview capability reaches, after narrowing today's fs capabilities (K1, P9), endpoint only during
   sessions (E7).
9. Ops — `SECURITY.md` (O2), minimum-version policy (O1), fuzzing (O3).

## Appendix A — experiments

All three were run on 2026-10-04 in a Linux sandbox. Outputs are quoted verbatim (trimmed only where
marked).

### A.1 JavaScript (Node 22.22.0; zod 4.6.2, dompurify 3.4.15 + jsdom, marked 18.0.12)

```js
import { z } from 'zod';
import createDOMPurify from 'dompurify';
import { marked } from 'marked';
import { JSDOM } from 'jsdom';

const out = (k, v) => console.log(`${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`);
out('E1 JSON.parse duplicate keys', JSON.parse('{"hp":10,"hp":-999}'));
const p = JSON.parse('{"__proto__":{"polluted":true},"a":1}');
out('E2a own __proto__ key after JSON.parse', Object.prototype.hasOwnProperty.call(p, '__proto__'));
out('E2b prototype of parsed object is Object.prototype', Object.getPrototypeOf(p) === Object.prototype);
out('E2c spread: inherits polluted?', { ...p }.polluted === true);
out('E2d Object.assign: inherits polluted?', Object.assign({}, p).polluted === true);
out('E2e global Object.prototype polluted after assign?', {}.polluted === true);
const rec = z.record(z.string(), z.record(z.string(), z.string()));
const r = rec.safeParse(JSON.parse('{"__proto__":{"x":"1"},"ok":{"y":"2"}}'));
// E2f–E2i: success, own __proto__ key, prototype changed, keys
const o = z.object({ a: z.number() }).safeParse(JSON.parse('{"a":1,"__proto__":{"b":2},"extra":3}'));
// E2j: o.data ; E2k: z.strictObject({ a: z.number() }) on {"a":1,"extra":3}
// E3a–E3e: JSON.parse('9007199254740993'), JSON.parse('1e400'), z.number() on Infinity,
//          z.number().int() on 2**53+2, z.number().int() on -0
// E4: JSON.parse of '['.repeat(n)+']'.repeat(n) for n in 1e3..5e6;
// E4z: z.lazy(() => z.array(deep)).safeParse(...) for n in 1e3, 1e4
// E5: z.string().safeParse('x'.repeat(50 * 1024 * 1024))
// E6: DOMPurify(new JSDOM('').window).sanitize(case) for each case below
// E7: marked.parse('hi <img src=x onerror=alert(1)>')
// E8: Charnik's slugify on 'Вафель' and '../../etc'; z.string().min(1).max(32) on 'Leo‮olle‬';
//     'Lаda' (Cyrillic а) === 'Lada'; 'é' NFC === NFD
```

Output:

```
E1 JSON.parse duplicate keys: {"hp":-999}
E2a own __proto__ key after JSON.parse: true
E2b prototype of parsed object is Object.prototype: true
E2c spread: inherits polluted?: false
E2d Object.assign: inherits polluted?: true
E2e global Object.prototype polluted after assign?: false
E2f zod record result success: true
E2g zod record output has own __proto__ key: false
E2h zod record output prototype changed: false
E2i zod record keys: ["ok"]
E2j zod object (default) output: {"a":1}
E2k zod strictObject unknown key accepted: false
E3a 2^53+1 survives JSON.parse: exact
E3b 1e400 parses to: Infinity
E3c zod number accepts Infinity: false
E3d zod int accepts 2^53+2: false
E3e zod int accepts -0: true
E4 deepest array nesting parsed OK: 5000000
E4z zod recursive schema depth 1000: ok
E4z zod recursive schema depth 10000: THROWS RangeError: Maximum call stack size exceeded
E5 zod z.string() accepts 50 MiB string: true
E6 DOMPurify script: ok
E6 DOMPurify onerror: <img src="x">
E6 DOMPurify jsHref: <a>x</a>
E6 DOMPurify fileHref: <a>x</a>
E6 DOMPurify remoteImg: <img src="https://attacker.example/t.png">
E6 DOMPurify dataImg: <img src="data:image/png;base64,AAAA">
E6 DOMPurify form: <form action="https://attacker.example"><input name="a"><button>go</button></form>
E6 DOMPurify style: <p style="position:fixed;inset:0">overlay</p>
E6 DOMPurify svgJs: <svg><a><text>x</text></a></svg>
E6 DOMPurify iframe:
E6 DOMPurify meta:
E6 DOMPurify base:
E6 DOMPurify clobber: <img><form></form>
E6 DOMPurify targetBlank: <a href="https://example.com">x</a>
E7 marked raw html: <p>hi <img src=x onerror=alert(1)></p>
E8a slugify("Вафель"): ""
E8b slugify("../../etc"): "etc"
E8c zod string keeps bidi override U+202E: true
E8d Cyrillic "а" vs Latin "a" equal?: false
E8e NFC vs NFD equal?: false
```

E3a is uninformative and nothing relies on it: the literal it compares against is rounded to the
same double, so "exact" only shows both sides rounded identically. M3 bounds every integer instead.

### A.2 Rust (rustc/cargo 1.97.0; serde 1.0.229, serde_json 1.0.151)

```rust
#[derive(Deserialize)] struct Hp { hp: i64 }
#[derive(Deserialize)] #[serde(deny_unknown_fields)] struct Strict { hp: i64 }
#[derive(Deserialize)] #[serde(tag = "type")] enum Msg { Damage { amount: u16 }, Heal { amount: u16 } }
// R1: {"hp":10,"hp":-999} into Hp / HashMap<String,i64> / Value
// R2: {"hp":1,"evil":2} into Hp / Strict
// R3: {"type":"WriteFile",...}, Damage 70000, Heal -5, Heal 5.5 into Msg
// R4: nested arrays at depth 100, 127, 128, 129, 10000 into Value
// R5: "1e400" into f64; 2^64 into u64.  R6: duplicate key into BTreeMap
// R7: "\ud800" into String; bytes b"\"\xff\"" into String
```

Output:

```
R1a struct duplicate field: ERR duplicate field `hp` at line 1 column 13
R1b HashMap duplicate key: OK {"hp": -999}
R1c serde_json::Value duplicate key: OK Object {"hp": Number(-999)}
R2a struct unknown field (default): OK Hp { hp: 1 }
R2b struct unknown field (deny_unknown_fields): ERR unknown field `evil`, expected `hp` at line 1 column 14
R3a unknown message type: ERR unknown variant `WriteFile`, expected `Damage` or `Heal` at line 1 column 19
R3b amount overflow u16: ERR invalid value: integer `70000`, expected u16
R3c negative into u16: ERR invalid value: integer `-5`, expected u16
R3d float into u16: ERR invalid type: floating point `5.5`, expected u16
R4 nesting depth 100: OK "parsed"
R4 nesting depth 127: OK "parsed"
R4 nesting depth 128: ERR recursion limit exceeded at line 1 column 128
R4 nesting depth 129: ERR recursion limit exceeded at line 1 column 128
R4 nesting depth 10000: ERR recursion limit exceeded at line 1 column 128
R5a 1e400 into f64: ERR number out of range at line 1 column 5
R5b 2^64 into u64: ERR invalid type: floating point `1.8446744073709552e+19`, expected u64 at line 1 column 20
R6 BTreeMap duplicate key: OK {"a": 2}
R7 lone surrogate escape into String: ERR unexpected end of hex escape at line 1 column 8
R7b invalid UTF-8 bytes: ERR invalid unicode code point at line 1 column 3
```

### A.3 iroh probe (example built inside the iroh workspace at the pinned commit)

Dials go over loopback (servers bind all interfaces, which is why P1 sees the sandbox's interface
address), `presets::Minimal`, `RelayMode::Disabled`, no address lookup. Endpoints: an open
server; a server with an `after_handshake` allowlist; clients with fresh keys; a client with a
`before_connect` hook that allows nothing. Steps:

- **P1** print `Endpoint::addr()` of a freshly bound endpoint;
- **P2** a client with a never-seen key echoes against the open server;
- **P3** dial the open server's real socket under a *different* endpoint id;
- **P4a/P4b** invited vs uninvited key against the allowlisted server;
- **P5** the fenced client dials the open server.

The allowlist hook is the whole of the admission logic:

```rust
impl EndpointHooks for Allowlist {
    async fn after_handshake<'a>(&'a self, conn: &'a Connection) -> AfterHandshakeOutcome {
        if self.0.contains(&conn.remote_id()) {
            AfterHandshakeOutcome::accept()
        } else {
            AfterHandshakeOutcome::Reject { error_code: 403u32.into(), reason: b"not invited".to_vec() }
        }
    }
}
```

Output (`192.0.2.2` is the sandbox's interface address):

```
P1 Endpoint::addr() IP entries (1): [192.0.2.2:52717]
P1 PASS: addr() carries non-loopback interface IPs
P2 PASS: unknown client key accepted and served (echo="hello")
P3 PASS: wrong endpoint id rejected: connect: the cryptographic handshake failed: error 48: invalid peer certificate: UnknownIssuer
P4a PASS: invited key served (echo="hello")
P4b PASS: uninvited key rejected: read: read error: connection lost
P5 PASS: outgoing dial blocked by hook: connect: Connection was rejected locally
```

## Appendix B — sources

Standards

- RFC 7250 — Raw Public Keys in TLS/DTLS — https://www.rfc-editor.org/rfc/rfc7250
- RFC 8259 §4 — JSON objects — https://www.rfc-editor.org/rfc/rfc8259#section-4
- RFC 8252 §8.1 — private-use URI schemes can be claimed by several apps —
  https://www.rfc-editor.org/rfc/rfc8252#section-8.1
- RFC 8446 §8 — TLS 1.3, 0-RTT and anti-replay — https://www.rfc-editor.org/rfc/rfc8446#section-8
- RFC 8828 — WebRTC IP address handling — https://www.rfc-editor.org/rfc/rfc8828
- RFC 6189 §4.4.1.1 — ZRTP hash commitment and the SAS — https://www.rfc-editor.org/rfc/rfc6189#section-4.4.1.1
- RFC 9413 — Maintaining Robust Protocols — https://www.rfc-editor.org/rfc/rfc9413
- RFC 9420 — Messaging Layer Security — https://www.rfc-editor.org/rfc/rfc9420
- W3C CSP Level 3 (§6.1 fetch directives, §6.3.1 base-uri, §6.4.1 form-action, §6.8.3 fallback list) —
  https://www.w3.org/TR/CSP3/
- Unicode UTS #39 — Unicode Security Mechanisms — https://www.unicode.org/reports/tr39/

Vendor documentation

- Tauri — capabilities (remote URLs get no IPC by default) — https://v2.tauri.app/security/capabilities/
- Tauri — isolation pattern — https://v2.tauri.app/concept/inter-process-communication/isolation/
- Tauri — deep linking — https://v2.tauri.app/plugin/deep-linking/
- Tauri — opener plugin default permissions — https://v2.tauri.app/plugin/opener/
- tauri `WebviewWindowBuilder::on_navigation` —
  https://docs.rs/tauri/latest/tauri/webview/struct.WebviewWindowBuilder.html
- iroh public relays policy — https://docs.iroh.computer/iroh-services/relays/public
- tauri `PathResolver` (app config vs app data directories) —
  https://docs.rs/tauri/latest/tauri/path/struct.PathResolver.html
- Signal — safety numbers — https://signal.org/blog/safety-number-updates/
- crates.io — governor — https://crates.io/crates/governor ; keyring — https://crates.io/crates/keyring

Research, advisories, weakness catalogues

- J. Miller (Bishop Fox), "An Exploration of JSON Interoperability Vulnerabilities", 2021 —
  https://bishopfox.com/blog/json-interoperability-vulnerabilities
- DOMPurify security advisories — https://github.com/cure53/DOMPurify/security/advisories ; the
  default-mode High: https://github.com/cure53/DOMPurify/security/advisories/GHSA-87xg-pxx2-7hvx
- CVE-2023-4863 (libwebp) — https://nvd.nist.gov/vuln/detail/CVE-2023-4863
- CVE-2021-42574 (Trojan Source) — https://nvd.nist.gov/vuln/detail/CVE-2021-42574
- J. R. Douceur, "The Sybil Attack", IPTPS 2002
- M. Blum, "Coin Flipping by Telephone", CRYPTO 1981
- MITRE CWE: 208, 294, 532, 770, 939, 1021, 1321 — https://cwe.mitre.org/

Code (pinned commits above)

- iroh — https://github.com/n0-computer/iroh/tree/b4c8fc68ef21b78781741fab8c6c86a1043d0f97
- iroh-gossip — https://github.com/n0-computer/iroh-gossip/tree/2885dd9f1120e46aca5acbcd7f212e4c64e278b9
