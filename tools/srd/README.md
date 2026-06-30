# SRD converters — `content/srd/*.csv` are GENERATED, never hand-written

**Hard rule:** content data is never authored from memory. Every row in `content/srd/`
is parsed from an official **CC-BY-4.0 SRD** source by a script here. If a value is wrong,
fix the parser or the source mapping — do not edit the CSV by hand.

## Sources (CC-BY-4.0, SRD-only)

| System | SRD | Source repo | Local (gitignored) |
|--------|-----|-------------|--------------------|
| 5.5e (2024) | SRD 5.2.1 | [downfallx/dnd-5e-srd-markdown](https://github.com/downfallx/dnd-5e-srd-markdown) | `tools/srd-src/2024/` |
| 5e (2014) | SRD 5.1 | [Tabyltop/CC-SRD](https://github.com/Tabyltop/CC-SRD) | `tools/srd-src/2014/` *(pending)* |

Both carry the canonical WotC CC-BY-4.0 attribution (see `content/ATTRIBUTION.md`).
**Rejected:** BTMorton/dnd-5e-srd (OGL 1.0a, not CC-BY; SRD 5.0) — license incompatible.

System tagging: rows are tagged by the SRD they came from (`5.5e` for 5.2.1, `5e` for 5.1).
Never claim `5e,5.5e` unless verified identical in both — 2024 diverges from 2014.

## Regenerate

```sh
# 1. fetch source (gitignored)
mkdir -p tools/srd-src/2024 && cd tools/srd-src/2024
for f in spells feats classes character-origins equipment magic-items rules-glossary LICENSE; do
  curl -fsSL -o "$f.md" "https://raw.githubusercontent.com/downfallx/dnd-5e-srd-markdown/master/$f.md"
done
cd ../../..
# 2. convert (each asserts its row count against the source)
node tools/srd/convert-spells.mjs   # → spells_srd.csv
node tools/srd/convert.mjs          # → feats, conditions, species, backgrounds
node tools/srd/convert-items.mjs    # → items (weapons/armor/gear/magic)
node tools/srd/convert-classes.mjs  # → classes + class_features
# 3. validate: every row must pass its schema
pnpm vitest run src/lib/content/schemas.test.ts
```

Each converter **asserts its emitted row count against the source** (`assertCount`) so a
parser that drops or double-counts an entry fails loudly instead of shipping a gap.

## Status (5.5e / SRD 5.2.1)

| Type | Rows | Script |
|------|------|--------|
| spells | 339 | `convert-spells.mjs` |
| items (weapons 38 · armor 13 · gear 81 · magic 258) | 390 | `convert-items.mjs` |
| feats | 17 | `convert.mjs` |
| conditions | 15 | `convert.mjs` |
| species | 9 | `convert.mjs` |
| backgrounds | 4 | `convert.mjs` |
| classes | 12 | `convert-classes.mjs` |
| class_features | 174 | `convert-classes.mjs` |
| monsters (monsters-A-Z 235 · animals 95) | 330 | `convert-monsters.mjs` |

All 5.5e SRD content types are now generated from source — **no hand-authored rows remain.**
Monster headline stats (size/type/AC/HP/abilities/CR/senses/…) are structured columns;
traits/actions stay verbatim in `text_en`.

To also fetch monsters: add `monsters-A-Z animals` to the fetch loop, then
`node tools/srd/convert-monsters.mjs`.

- [ ] **effects** — the runtime "+" quick-effect catalog is an APP concern, not a raw SRD
      type, so it is intentionally NOT seeded here (the hand-seeded placeholder was removed).
      Build it deliberately later (derive apply-condition presets from conditions, etc.).
- [ ] **subclasses** — one per class exists in SRD 5.2.1; not seeded (separate content type).
- [ ] **5e (SRD 5.1 / Tabyltop)** pass for `5e`-tagged rows (currently 5.5e only).

Structured columns (resolution, damage, ac, rarity…) are PARSED from the source; where the
text is ambiguous the column is left blank, never guessed. Verbatim text lives in `text_en`.
Within-file id collisions are auto-suffixed (`-2`); e.g. "Spell Scroll" is both gear and a
magic item in SRD 5.2.1.
