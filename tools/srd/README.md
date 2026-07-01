# SRD converters — `content/srd/*.csv` are GENERATED, never hand-written

**Hard rule:** content data is never authored from memory. Every row in `content/srd/`
is parsed from an official **CC-BY-4.0 SRD** source by a script here. If a value is wrong,
fix the parser or the source mapping — do not edit the CSV by hand.

## Sources (CC-BY-4.0, SRD-only)

| System | SRD | Output root | Source repo | Local (gitignored) |
|--------|-----|-------------|-------------|--------------------|
| 5.5e (2024) | SRD 5.2.1 | `content/srd-2024/` | [downfallx/dnd-5e-srd-markdown](https://github.com/downfallx/dnd-5e-srd-markdown) | `tools/srd-src/2024/` |
| 5e (2014) | SRD 5.1 | `content/srd-2014/` | [Tabyltop/CC-SRD](https://github.com/Tabyltop/CC-SRD) | `tools/srd-src/2014/` |

**Two edition roots, edition-specific `source`.** SRD 5.1 and 5.2.1 are different documents,
so their rows carry distinct `source` tags (`SRD 5.1` vs `SRD 5.2.1`) → the same slug never
collides on `source:id` across editions (`SRD 5.1:fireball` ≠ `SRD 5.2.1:fireball`). Each
root has its own `_pack.json`. Both carry canonical WotC CC-BY-4.0 attribution.
**Rejected:** BTMorton/dnd-5e-srd (OGL 1.0a, not CC-BY; SRD 5.0); normalized JSON
compilations like 5e-bits (OGL provenance) — incompatible with our CC-BY-only rule.

System tagging: rows tagged by the SRD they came from (`5.5e` for 5.2.1, `5e` for 5.1).
Never claim both unless verified identical — 2024 diverges from 2014.

**Best 5.1 source per type** (Tabyltop ships `.html` / `.txt` / coordinate-`.json` +
`Monsters-*.json`): prose types parse from the **HTML** (semantic `<h4 id>` entries,
`<p><b>Label:</b>value</p>` fields); monsters map from the **pre-structured Monsters JSON**.
The coordinate JSON (PDF dump) is avoided.

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
| subclasses (1 per class) | 12 | `convert-classes.mjs` |

**SRD 5.2.1 content is complete** — every type generated from source, no hand-authored
rows remain. Monster/feature headline stats are structured columns; full text stays
verbatim in `text_en`. Subclass features live in `class_features` with `subclass_id` set
(232 = 174 base + 58 subclass).

To also fetch monsters: add `monsters-A-Z animals` to the fetch loop, then
`node tools/srd/convert-monsters.mjs`.

- [ ] **effects** — the runtime "+" quick-effect catalog is an APP concern, not a raw SRD
      type, so it is intentionally NOT seeded here (the hand-seeded placeholder was removed).
      Build it deliberately later (derive apply-condition presets from conditions, etc.).
- [ ] **5e (SRD 5.1)** pass for `5e`-tagged rows (currently 5.5e only).

Structured columns (resolution, damage, ac, rarity…) are PARSED from the source; where the
text is ambiguous the column is left blank, never guessed. Verbatim text lives in `text_en`.
Within-file id collisions are auto-suffixed (`-2`); e.g. "Spell Scroll" is both gear and a
magic item in SRD 5.2.1.
