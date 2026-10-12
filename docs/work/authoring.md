# Authoring from the UI — open work

> Tracker. The compendium editor, homebrew, drafts and translation — the surfaces that make
> "everything is doable from the UI" true. How they work is
> [`../internals/content.md`](../internals/content.md) ▸ Authoring from the UI; the ORDER is
> [`plan.md`](../plan.md) ▸ Implementation order.

- [ ] **REMOVED-FILE-TRANSLATION · a whole file an update removes takes its translations unsaid and
  uncopied.** `keepLocalTranslations` runs over the files an update WRITES, so a file the remote
  dropped — deleted only behind "apply, including deletions" — is neither copied into
  `content-backups/` nor named as translated; its only copy is `<pack>.prev`, which the next apply
  replaces. What it needs: the translated row ids of a file with no incoming side (a helper beside
  `carryLocaleCells`), the copy aside in the same run, and those rows on the panel's translated line
  at describe time, since a removed file is known before any byte is fetched. About 30 lines.
- [ ] **ITEM-AT-THE-TABLE · make a custom item from where you are holding it — its own design session.**
  A big goal, not a gap in the homebrew editor. That path authors a CONTENT ROW: you leave play, open
  the compendium, pick a type, fill a schema-driven form, and the row joins the graph for every
  character. This one is the other moment — the GM hands you something mid-session and you want it in
  your inventory now, named, weighed, and swinging. The two differ in where the act starts, what it is
  scoped to, and how much form a player will tolerate mid-fight, so it is a session of its own before
  it is code.
  **What the session has to answer, not the agent:** is the thing a homebrew row written from a
  shorter form, or a per-character item that never enters the graph? Does an existing row seed it
  ("like a Longsword, but…")? What is the minimum a row must say before it is allowed to exist? And
  what does it cost at a REAL table — the reason to build it is the loot that has no SRD row, so the
  measure is how fast a player gets from "the GM said" to "it is on my sheet".
  Nothing is blocked on code: `inventoryEntry` already carries a player's own answer (`base`), the
  homebrew write path already exists end to end, and `resolveItem` already merges an authored row
  over a mundane one.
