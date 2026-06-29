# Existing D&D character generators — problems & lessons

Research collected for Charnik. Goal: know what to avoid and what to copy.

## D&D Beyond
- **Forces rules updates** with no toggle to stay on old rules → breaks existing
  character sheets.
- **Bad PDF / print export** — uses the stock 5e sheet, info doesn't fit; printing
  is widely complained about.
- **Features box is a mess** — info listed but no detail visible; must click each
  feature to see anything.
- **Weak class-feature resource tracking** — users fall back to the notes field as a
  hack to work around the limitation.
- **Level-up isn't guided** — doesn't cleanly walk you through new HP / spells /
  abilities; level info can conflict across places.
- Proprietary, paywalled content, account-locked, online-only.

## Aurora Builder
- Powerful **XML homebrew system**, shareable content packs — a good model.
- BUT **active development postponed indefinitely**; official repo archived
  (community "Aurora Legacy" fork keeps 2014 content alive only).
- **Rules-fidelity gaps**: race/subrace-granted spells don't appear in the spell
  list; prepared/known/ritual/concentration & consumable tracking is manual and
  error-prone.
- **Cross-device desync**; exported sheets show stale entries.
- Desktop-only; effectively no 2024 (5.5e) support.

## Roll20 builder
- **Custom rules barely supported** (no modularity) — even a simple variant like
  proficiency dice is hacky. Homebrew is painful.

## 5e.tools
- Excellent data/reference and a great **statgen UX** (our reference for point-buy).
- But heavy; not aimed at being a clean **self-hosted personal character manager**;
  the data model is complex.

## FightClub 5e / Game Master 5e (XML compendium ecosystem)
- Validates the **files-on-disk, user-editable, mergeable** direction: plain text
  files, per-source, build your own offline compendium.
- Lesson: **XML is verbose** → **CSV is friendlier for non-technical editors.**

---

## Themes / lessons for Charnik
1. Own your data in plain, transparent, user-editable files (our CSV core).
2. **Don't force rule changes** — let the user pick the system per character
   (5e ↔ 5.5e), switchable live.
3. **First-class homebrew**, not a bolted-on afterthought; add content from the UI.
4. Work **offline / self-hosted**; no account required.
5. **Show feature detail inline**; make resource tracking real, not a notes hack.
6. **Good print/PDF export** from the start.
7. Keep it **maintainable** (one language, minimal deps) so it doesn't stall like
   Aurora.

---

## Sources
- D&D Beyond — character builder dropping 2014 rules support:
  <https://www.dndbeyond.com/forums/d-d-beyond-general/d-d-beyond-feedback/203954-psa-the-character-builder-sheet-will-no-longer>
- D&D Beyond — printing sheets is horrible:
  <https://www.dndbeyond.com/forums/d-d-beyond-general/d-d-beyond-feedback/161207-printing-dnd-beyond-characters-sheets-is-horrible>
- Aurora Builder — FAQ: <https://aurorabuilder.com/faq/>
- Aurora `elements` — race/subrace spells not in sheet:
  <https://github.com/aurorabuilder/elements/issues/30>
- Is Aurora a good 5e creator? (Quora):
  <https://www.quora.com/Is-Aurora-a-good-D-D-5E-character-creator-If-not-why>
- Aurora alternatives / status (AlternativeTo):
  <https://alternativeto.net/software/aurora-builder/>
- FightClub5eXML (compendium format, offline build):
  <https://github.com/kinkofer/FightClub5eXML>
- Encumbrance/carrying capacity 5e vs 5.5e (Blog of Heroes):
  <https://hill-kleerup.org/blog/heroes/2025/06/dd-5e-5-5e-rules-encumbrance-and-carrying-capacity.html>
- SRD 5.2.1 (CC-BY-4.0): <https://www.dndbeyond.com/srd>
- "Publish your own creations" (CC release announcement):
  <https://www.dndbeyond.com/posts/1949-you-can-now-publish-your-own-creations-using-the>
