# Orphans catalogue

Symbols/files with **no importer** per `knip` (run: `pnpm dlx knip`). **Nothing here is deleted** —
the app has half-finished features, so an orphan may be *pending wiring*, not dead. This is a
triage list; classify, then act deliberately.

Legend: 🟢 false-positive / internal-only (keep; maybe drop the `export`) · 🟡 unfinished feature
(keep — wire it up) · 🔴 likely dead (safe to remove after a quick confirm) · ❓ verify (unsure).

## Files (9)
- 🟢 `tools/srd/*.mjs` (convert*, `lib.mjs`) — CLI scripts run via `node`/package scripts, not
  imported. Tell knip they're entry points (`knip.json`) → these disappear.
- 🔴 `src/lib/index.ts` — the empty SvelteKit `$lib` stub (only a comment). Removable.

## Dependencies (2)
- 🟡 `@tauri-apps/plugin-dialog` — added the dep + capability but the JS file-picker is **not wired
  yet** (planned for import/export + choosing a portable data dir). Unfinished, keep.
- 🟢 `@tauri-apps/cli` — used via `pnpm tauri build/dev`, not imported. False-positive.

## Exports — values (34)
Internal-only (used within their own file via a registry/loop → just drop the `export`): 🟢
`speciesSchema`, `speciesOptionSchema`, `classSchema`, `classFeatureSchema`, `subclassSchema`,
`backgroundSchema`, `featSchema`, `spellSchema`, `itemSchema`, `languageSchema`, `conditionSchema`,
`effectSchema`, `monsterSchema`, `spellSlotsSchema`, `classCastingSchema`, `spellListsSchema`
(all built into `CONTENT_TYPES`), `HOMEBREW_SOURCE`, `CONTENT_ROOTS`, `LOOKUP_TYPES`, `EFFECT_KINDS`,
`SKILL_PROFICIENCY`, `CONTENT_SCHEMA_VERSION` — referenced in-file but not imported elsewhere.

Likely dead (superseded during the roll/effects rework — confirm no consumer, then remove): 🔴
`parseDice`, `healDice`, `effectHint` (`combat/helpers.ts` — the roll path now parses inline; note
we USE `effectTag`, not `effectHint`), `castingIcon` (❓ may still feed `spellRow` — verify),
`fold` (`rules/pipeline.ts` — unused reducer), `boostComplete` (`build/rules.ts` — unused boost check).

Unfinished feature (wire it up, don't delete): 🟡
`reloadContent` (`content/store.svelte.ts` — live content reload / file-watch not wired to UI),
`isLoading` (`i18n/index.ts` — locale-loading flag, no spinner consumer yet),
`localesOf` / `buildNameDocs` / `buildTextDocs` (`content/search.ts` — ❓ search index builders; the
palette calls `makeNameIndex/makeTextIndex/searchContent` — verify these three aren't the old API),
`CHARACTER_MIGRATIONS` (`character/repository.ts` — migration registry, empty until a v2 schema).

## Exports — types (34)
Mostly the **public API surface** — zod-inferred content types (`Species`, `SpeciesOption`,
`CharClass`, `ClassFeature`, `Background`, `Feat`, `Spell`, `Item`, `Condition`, `Language`, `Effect`,
`Monster`, `Subclass`, `SpellSlots`, `ClassCasting`, `SpellLists`, `System`), character types
(`CharacterBuild`, `CharacterPlay`, `CharacterUi`, `EffectInstance`, `AbilityBlock`,
`SkillProficiency`), and module interfaces (`SpellcastingClass`, `AbilityScore`, `MonsterModel`,
`FieldKind`, `PackManifest`, `ContentIssue`, `ListOptions`, `AccessVia`, `AccessEntry`, `EffectKind`,
`Op`). 🟢 Harmless — exported for completeness/consumers-to-be. Low priority: drop `export` on the
ones with no plausible external consumer; keep the content/character types as API surface.

## Next
1. Add `knip.json` (tool scripts + `@tauri-apps/cli` as entries) so knip only reports REAL orphans,
   then make it a CI check.
2. Confirm the 🔴 set has zero consumers (grep) → remove in a cleanup commit.
3. Wire or explicitly defer each 🟡.
