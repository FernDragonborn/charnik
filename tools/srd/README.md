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
  curl -fsSL -o "$f${f:+.md}" "https://raw.githubusercontent.com/downfallx/dnd-5e-srd-markdown/master/$f.md"
done
# 2. convert
node tools/srd/convert-spells.mjs   # → content/srd/spells_srd.csv (339 spells, L0–9)
# 3. validate: every row must pass its schema
pnpm vitest run src/lib/content/schemas.test.ts
```

## Status

- [x] **spells** — `convert-spells.mjs`, 339 rows from SRD 5.2.1, schema-validated.
- [ ] feats, species, backgrounds, classes, class_features, items, conditions, effects
      (still the hand-seeded placeholders from commit 759e017 — **SUSPECT, must be
      reconverted from source**).
- [ ] 5e (SRD 5.1 / Tabyltop) pass for the `5e`-tagged rows.

Structured columns (resolution, save_ability, damage…) are PARSED from the source prose;
where the text is ambiguous the column is left blank, never guessed. The verbatim
description always lives in `text_en`.
