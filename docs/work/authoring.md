# Authoring from the UI — open work

> Tracker. The compendium editor, homebrew, drafts and translation — the surfaces that make
> "everything is doable from the UI" true. The ORDER is [`plan.md`](../plan.md) ▸ Implementation order.

- [x] **HOMEBREW-LINKED · homebrew content from the UI, including the linked half.** Every listed
  type authors through one editable-article form (mirrors the compendium article; schema-driven
  fields → validated row → atomic BOM/CRLF write into `content/homebrew/<type>_hb.csv` in user
  storage; merged into the graph as an extra content root; the new row opens in the compendium). A
  spell and a monster edit through that same generic form, a homebrew row deletes from the editor,
  and a `resource` / `resource_option` is listed and authored like any other type
  (`docs/internals/content.md` ▸ a type that has a NAME is listed).

  **The linked half is the article's own section** (`LinkedRows`, over the pure `linked-tables.ts`):
  a class, a subclass, a species and a resource each say almost nothing on their own row — their
  mechanical content lives in a second table — so the article lists the rows joined to it and offers
  to write one more, with the join columns already filled. A foreign key is an id nobody can guess,
  which is the whole reason the generic "switch type, click add, type `subclass_id` by hand" path did
  not count as authoring it.

  **Four links, not one:** `class`→`class_feature` (only the rows no subclass claims, or a class
  article would list every subclass's too), `subclass`→`class_feature` (carrying the parent's
  `class_id`, since a feature needs both ids), `species`→`species_option`, `resource`→
  `resource_option`. Adding a fifth is a row in `LINKED_TABLES`. The list is also how a linked row is
  REACHED to be edited or deleted — those live on its own article, so both directions exist.

  **One real bug fell out of it:** the compendium looked the saved row up under `selectedType`, which
  the deep-link effect restores from the URL the moment the graph reloads — so a save made while an
  entry was open found nothing and silently opened no row. The form now hands its own type back.

## The compendium-editor refactor set

A coordinated set: split the wiki detail into components, type the loader properly, and harden
the lint gate. The WikiDetail decomposition + RollButton shipped (see WD-1 below; live shapes in
`docs/surface.md`). Ordering + open decisions below.

- [x] **WD-1 · Split `WikiDetail`.** Read + translate parity only; `editor` mode stayed a stub.
  **The note this carried is CHECKED and closed (2026-08-22):** the Cast action does show on spells.
  `WikiDetail` renders the `actions` snippet once under the head, outside the per-type branch, so it
  is type-independent — the generic-branch-only version it warned about is already gone.
- [x] **WD-2 · Extract `RollButton`** — the shared roll affordance.
- [x] **TYPE-2 · Typed `LoadedRow`.** A discriminated union on `type`, threaded through
  `graph.list<T>` and `featuresForClass`. Reading a display name goes through `rowName(row)` —
  `content.md` says why. `data` stays `Record<string, unknown>` for the generic column walks
  (homebrew, translation coverage) that have no static type to want.
- [x] **DRAFT-CACHE · Persist in-progress edits (translate / add / editor) so a closed form restores.**
  DONE (parts 1–2, commits `6178ce3`/`48cb105`): `$lib/drafts/store` (self-contained files, no manifest,
  content-versioned, discard-on-mismatch, +6 tests) + translate wired (prefill/debounced-save/clear,
  e2e-verified) + add wired (per-GUID, resume newest-of-type on mount, clear on save).
  DONE (part 3, commit `1bfa62e`): the pending-drafts **surface** — `DraftsPane` (full-width list, 4th
  "Drafts" picker entry, unlimited pickable add-drafts) + `OrphanDialog` (N-of-M step-through, 2-pane
  reassign picker + preview + conflict view) + compendium/translate wiring + store `findOrphanDrafts`/
  `repointDraft`/`draftEffectiveId` (+10 tests). Verified live.
  DONE (part 4, commit `2868f5c`): **editor** draft wiring — landed with Editor mode (below).
  DONE (part 5, commit `83996d7`): **warn-on-schema-discard** — `SchemaDiscardDialog` (house template,
  single-pane notice) fires on compendium load when the cache holds drafts from another
  `CONTENT_SCHEMA_VERSION`; store `findStaleDrafts`/`discardDrafts`. Verified live.
  **DRAFT-CACHE is COMPLETE — no open tails.**
  **The surface** (mocks: `design-preview/drafts-surface.html`, `orphan-popup.html`):
  - **Drafts list = full-width pane that replaces the editing block** (compendium right column, where
    WikiDetail/EditContentForm render) — opened via a **4th "Drafts" entry** in the "✎ Edit compendium"
    picker, with a live count badge. Lists **every** draft (all types+kinds), grouped ⚑Needs-attention /
    Translations / New entries; each row = kind icon + title + target (locale for translate) + age +
    Resume/Delete. This makes add-drafts **unlimited + individually pickable** (supersedes resume-newest
    -of-type). A draft must be **openable no matter what** (incl. orphans) so modified fields are never
    lost.
  - **Orphan dialog** = the house attention-dialog template (docs/internals/ui.md ▸ Shared controls and dialogs): centered
    modal, ⚑ badge header + **"N of M" step-through** (one orphan at a time), 2-pane body (left = your
    draft prose read-only; right = **searchable reassign picker across ALL sources** + live preview of the
    highlighted target), footer = Delete · Skip · Keep-as-new · Reassign. Orphans are discovered **when the
    cache is read** and a `target` id resolves to no content row.
  - **Reassign = re-point, then resume** (NOT write-through): the draft is re-targeted to the chosen entry
    and opens in Translate/Editor prefilled; nothing is written to content until the user hits Save.
  - **Reassign CONFLICT:** if the chosen target **already has a draft** for the same key, the user must
    choose **which of the two survives** — and must be able to **open either draft to inspect its modified
    fields first** (no silent overwrite, no lost work). The loser can be kept-as-new rather than hard-
    deleted where possible.
  - Editor wiring lands with Editor mode. Warn-on-schema-discard notice = same dialog template.
  Original spec:
  A form's last unsaved state is cached to disk and silently re-fills the form when reopened (for any
  reason — nav away, reload, crash). Over the `Storage` seam; reuses the character autosave debounce.
  - **All drafts live in a `drafts/` folder on disk, one self-contained JSON per draft — NO manifest /
    index file** (a lost manifest must never break the set; discover by scanning `drafts/` + reading
    each, same principle as removing `_pack.json` and content's self-describing `#content-` headers).
    Each file carries its own identity so nothing external is needed:
    ```jsonc
    { "schemaVersion": CONTENT_SCHEMA_VERSION, "kind": "translate|add|editor",
      "target": { "type","source","id","locale?" } | { "addGuid","type" },
      "sourceHash": "xxh64:…", "savedAt": "…", "data": { …the row/prose model… } }
    ```
    Identity lives IN the file (`target`), so the **filename is just a safe unique name** — a hash of
    `kind+target` for translate/editor (re-editing the same row+locale overwrites its one file, no
    dupes) or the add GUID (`crypto.randomUUID`, per AGENTS.md ▸ Taste). This sidesteps the
    Windows filename hazard (raw `effectiveId` = `type:source:id` has illegal `:` + spaces).
  - **Versioning follows the general schema — NO separate draft schema.** `data` is a content row (or a
    prose subset), so it carries `CONTENT_SCHEMA_VERSION` via the existing `Versioned`/`migrate`
    convention (`src/lib/schema/version.ts`). But drafts are ephemeral WIP, so on a version mismatch →
    **discard, don't migrate** (`<` current or `>` current → drop). **BACKLOG: warn the user on a schema
    change that unsaved draft data will be / was dropped** (a notice, not silent) — losing WIP silently
    is surprising.
  - Lifecycle: prefill on open → debounced save on change (`untrack` so the write doesn't re-fire) →
    **clear (delete the file) on successful save** (write content first, then delete the draft).
  - **Orphan draft** (a draft file whose `target` resolves to no content row — row deleted, or an
    add-GUID): a pop-up dialog offers **reassign to an existing entry** (picker) / **keep as a new
    entry** / **delete the draft**. Add a small **"pending drafts" surface** (in the Edit-compendium
    picker) so orphan add-GUID drafts are reachable — auto-restore-on-open never reaches them otherwise.
  - Staleness: `sourceHash` differs from the row's current `#content-hash` → keep but flag "source
    changed since your draft."
  - Demo/read-only: caching is harmless but saving is blocked, so skip caching there.
- [x] **LOC-CHECK · Flag partial/mis-filled translations.** A loader WARN issue, never a throw —
  the same channel as a bad row. A fully-untranslated row stays silent: EN fallback is the contract.
- [x] **LOC-STATUS · Tracked per-locale localization status.** `loc_status_<loc>` column, an open
  enum (`not_started|machine|started|reviewed`) whose members drive the marker + control
  automatically — add a member and it appears (`content/schemas.ts`).
**Sequencing:** **TYPE-2 → LINT-1 → WD-1 → WD-2.** Type the foundation
first so every new component (the heads) is born typed and LINT-1's type-checked rules land on
clean code; the view split follows. **TYPE-2 and LINT-1 are both closed (2026-08-21); WD-1 → WD-2 are
what remains of the sequence.**

**Editor mode — DONE (commit `2868f5c`; two-panel `5550e9c`).** The "Editor" mode-picker entry (active
once an entry is selected) opens a **two-panel BEFORE | AFTER** view (commit `5550e9c`, as agreed):
the current rendered article (read-only `WikiDetail`, "Current") beside the editable form ("Your edit"),
mirroring Translate's source|target. The "after" pane REUSES `EditContentForm` (an `editRow` prop)
rather than bespoke editable heads — so every `fieldsFor` widget + zod validation is shared with Add. Save = `upsertHomebrewRow` (replace
same-id row, preserve columns beyond the schema so localized prose survives). A **read-only shipped
SRD row FORKS to homebrew** (same id, `source=Homebrew`); a homebrew row edits its own file. The SRD
file stays untouched (survives a future SRD update, keeps CC-BY attribution).
**Override = SORT, not hide:** a homebrew row floats ABOVE the SRD
original in every compendium group (`grouping.compareRows`/`homebrewFirst`, stable so shipped order is
otherwise untouched — 0px on the SRD-only set). Both coexist (honours the source-namespaced-identity
invariant); the full keep-one/keep-all UI stays a later `collisions.json` feature.
Also landed with it: homebrew writes now **stamp a `#content-*` header** (source/license/id/schema/
updated-at/hash — the DATA-VER "in-app authoring stamp") so app files never trip the metadata-check /
hash-drift dialogs (default homebrew license = `Custom`); and the **license** is threaded onto rows +
the detail source-line (was a hardcoded `CC-BY-4.0`).

---

- [ ] **OWN-WORDS · a player rewrites any description in their own words.** Playtest: flavour text is
  the table's, not the book's, and a player wants to say it their way — anywhere a description is
  shown, it can be tapped and replaced, with a small control to put the original back. It is a CACHE
  over the content, never an edit of it: the CSV is untouched, which is what separates this from the
  homebrew editor that already exists beside it.
  **Settled with the maintainer:** a row is per-CHARACTER by default and carries a toggle that
  promotes it to the whole install, so two characters can read the same item differently. Two stores,
  each where its scope belongs — the per-character rows in `character.json` (so a character still
  travels with everything it needs), the promoted ones in an `overrides.json` beside the settings; the
  toggle moves a row between them.
  **The expensive half is search.** A player who rewrote a description and then cannot find their own
  words has been given nothing, so the override has to reach the index the palette and the compendium
  filter read — which is the part to design before the storage.
  Keyed by `type:source:id`, never by name, so a pack update does not orphan the override
  (`../internals/content.md`).
  **In the current batch**, alongside the rest of the playtest items.
