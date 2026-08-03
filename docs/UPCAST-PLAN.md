# UPCAST-PLAN.md

Робочі нотатки по структурованому апкасту спелів. Для себе — щільно, з file:line.
Прив'язка: `docs/PLAN.md` L10 / L9 (slots), UBUG «manual upcast picker» (~L1006-1008),
`AUDIT-29-07.md` A17-rem. Оновлювати цей файл, коли рішення міняється (§8.6 conventions).

## Статус

**SLICE 1 (damage/heal лінійний) — ЗАКОДЖЕНО + закомічено 2026-08-03.** 951 тестів зелені.
Що зроблено (LOCKED §8 реалізовано для damage/heal-гілки):
- Движок: `per_slot(amount[, step])` цукор + `slot`/`spell_level` cast-ефемерні вари +
  `withCastSlot` ctx-обгортка (`effects/expression-*.ts`, `context.ts`). B1/B2 закриті.
- Модуль `effects/upcast.ts`: `parseUpcast`/`evalUpcast`/`combinePools`; combine per-kind
  (delta для damage/heal/hp_max/temp_hp, absolute для count/area/duration); `inf`-guard (N3);
  degrade на битій формулі (H11). SpellRow несе `upcast`+`damageFlat` (N2).
- Каст: `deriveSheet` віддає `castCtx` (post-derive знімок; undefined коли auto-effects off → N6);
  VM `upcastDamageDelta` фолдить delta у `spellDamagePart` + save/auto-гілку; провенанс = «(slot N)»
  лейбл (B8 v1); слот = auto-найнижчий `slotToSpend` (пікера ЩЕ нема — див. нижче).
- Дані: колонка `upcast` в ОБИДВІ spells.csv + 9 курованих спелів (both editions), звірено з
  прозою; healers дістали `damage`-колонку. Restamp'нуто.

**Лишилось у slice 1:** слот-ПІКЕР (D13, зараз лише auto-upcast найнижчого) — headline-UX,
UI-важкий (енумерація валідних слотів + вибір). Далі §319 slice 2+ (count/area/duration чіпи,
hp_max/temp_hp, концентрація, кантрип-уніфікація, roller-цикл).

**healDice ВИДАЛЕНО** (юзер: «не має бути парсингу тексту спелу»): усі 5 auto-healers (cure/healing_word/
prayer_of_healing/mass_*) тепер несуть базу в `damage`-колонці + `heal:per_slot(...)`; `castingDice` читає
ЛИШЕ структуровану колонку, нуль скрейпу прози.

**Відкладені хвости (свідомо):** повний backfill решти лінійних damage-спелів; B8 багатший трейс
(зараз лише лейбл-суфікс); castCtx `spellcasting_mod` = primary caster, не spell-каст-клас (SRD не читає).

Резюме-вказівник для повернення: код у `effects/upcast.ts` + `routes/combat/state.svelte.ts`
(`upcastDamageDelta`); почати з пікера АБО slice 2.

## 0. Що є в коді зараз (база, від якої відштовхуємось)

- `higher_level` — **текстова** колонка (`schemas.ts:319`), semi-structured проза. Нічого
  механічного. Локалізовані сиблінги `higher_level_uk` (PROSE_BASES `schemas.ts:509`).
- Кантрип-скейл — ЄДИНЕ, що реально скейлиться: `cantripDieMultiplier(charLevel)` регекс-
  множить кістки на кроках 5/11/17 (`spells.ts:267-273`). Це НЕ апкаст (від рівня персонажа,
  не від слоту).
- `forcedUpcast` (`spells.ts:225`, `character/spellcasting.ts:281`) — прапорець пакт-слотів
  варлока (завжди макс. рівень); лише виключає пул із по-рівневого показу. Кісток НЕ рахує.
- `castingDice` (`spells.ts:267`) повертає dice-**рядок**; `damagePool`=parseDicePool,
  `damageType`=parseDamageParts (`spells.ts:301-302`). Роллер котить `damagePool`.
- База хілу НЕ в даних — регекс-скрейп із EN-прози: `healDice` (`spells.ts:57-61`),
  `/(?:equal to|regains?|restores?)[^.]*?(\d+d\d+)/i`. Крихко (див. B-cleanup нижче).
- Движок виразів (`src/lib/effects/`, готовий, 733 тести): `step(idx, t->v…)` (значення
  number|dice|inf, `expression-evaluator.ts:270-289`), `floor/ceil/round/min/max/clamp/abs/
  sign` (`:246-267`), dice, `if()`, `var()`. inf=`:106-110`. Контекст-вари `context.ts`:
  `level`=**build.level (рівень ПЕРСОНАЖА!)** `:83`, `class_level.X`, `spellcasting_mod`.
  **`slot`-вара НЕМА.**
- Множинні ефект-токени в одній клітинці = розділені `;` (наявна конвенція); `:` —
  структурний усередині токена; typed-damage під-слот уже є: `flat_bonus:damage:fire+1d6`
  (`helpers.test.ts:212`). `hp_max` — повноцінна ціль ефектів (`derive-targets.ts:24`),
  Aid `flat_bonus:hp_max+5` тече крізь seam (`derive.ts:483`, тест `derive.test.ts:482-485`).

## 1. Data-факти (SRD 2014, 319 спелів, 90 з `higher_level`)

- **68** — лінійне «+X за кожен слот вище базового» (Fireball, Cure Wounds, Magic Missile…).
- **~19** — дискретні пороги/стрибки (Magic Weapon +2/+3, Geas, Dominate*, Hunter's Mark,
  per-two-levels: Flame Blade/Animate Dead). ← `step()` їх бере, НЕ виключати.
- **3** — таблиці опцій виклику (Conjure Animals/Fey/Woodland). ← не-скаляр, проза.
- Мульти-інстансні на базі (рівні 1-9): рівно 3 — Magic Missile, Scorching Ray,
  Chain Lightning — і ВСІ троє скейлять свою кількість. Немає levelled-спела, що мульти-
  інстансний на базі, але качає іншу дименсію → **база інстансів не безхатня, поля не треба**.
  Eldritch Blast — виняток, але кантрип (скейл від char_level, окрема система).
- **Мульти-дименсійний апкаст РЕАЛЬНИЙ** (веб-пошук + мандат «весь PHB + популярний гомбрю»):
  Web (duration + damage), Zone of Truth (area + duration), гомбрю робить це вільно.
  → схема МУСИТЬ тримати N дименсій на спел, інакше запікаємо обмежуюче припущення.

## 2. Фінальна схема

**Одна колонка `upcast` у `spells.csv`. Токен = `kind:formula`, кілька через `;`.**

```
Fireball       damage:per_slot(1d6)                 ← ДЕЛЬТА (база 8d6 з damage-колонки); combine=база+дельта
Web            duration:...; damage:per_slot(1d4)
Zone of Truth  area:per_slot(10); duration:per_slot(300)
Scorching Ray  count:slot+1                          ← count=АБСОЛЮТ (kind перейменовано з projectiles, §8)
Geas           duration:step(slot, 5->30, 9->inf)
Ice Storm      damage:bludgeoning:per_slot(1d8)      ← typed-damage під-слот (мульти-тип)
```
> ⚠ Раніше приклад Fireball писався `damage:8d6+per_slot(1d6)` (база в формулі). LOCKED §8 = **дельта**
> (формула НЕ повторює базу), тому реалізовано `damage:per_slot(1d6)`. Приклад виправлено (sync §8.6).

- Реюз наявної грамматики: `;`-split (`splitGuard`/токен-парсер), `:`-структурний,
  typed-damage під-слот. НЕ JSON-in-cell (заборонено CLAUDE.md) — дозволена `;`-мульти-клітинка.
- Спел живе в ОДНОМУ рядку одного файлу → людино-редаговане, нуль FK-синхронізації.
- `upcast_kind` окремою колонкою — **відкинуто** (kind тепер префікс токена, бо мульти-дименсія).

### Відкинуті альтернативи (щоб не вертатись)
- **Окрема таблиця `spell_upcast.csv`** (kind+formula per row) — відкинуто: FK-синхронізація
  вручну + спел у двох файлах = вбиває «звичайна людина редагує CSV».
- **Дві колонки `upcast`+`upcast_kind` на рядку спела** — відкинуто: одна дименсія на спел,
  а мульти-дименсія реальна (Web/ZoT). Структурно не тримає 2 дименсії.
- **Власний міні-парсер на дві форми (dice/count)** — відкинуто: реюз-порушення, движок
  виразів уже все вміє (`step`/`floor`/`inf`/dice). Не будувати гіршу підмножину.

### Синтаксичний цукор (§ hole 2 — сирий `floor((slot-3)/2)*2` = пізда)
```
per_slot(amount)        = amount * (slot - spell_level)
per_slot(amount, step)  = amount * floor((slot - spell_level) / step)
```
Base=власний `spell_level` майже завжди (Animate Dead «above 3rd»=рівень 3, Flame Blade
«above 2nd»=рівень 2). НЕ character-`level`! (див. B2). Читає `slot`+`spell_level` з cast-ctx.

### kind-enum → ТРИ маршрути (не один!)
| kind | що робить число | маршрут |
| --- | --- | --- |
| `damage` `heal` `projectiles` | кістки/інстанси кидка | dice-roller (damagePool / instance-count) |
| `hp_max` `temp_hp` | магнітуда наспавненого ефекту | рантайм-ефект+duration seam, НЕ чіп |
| `targets` `duration` `area` | сам ефект (= опис) | дисплей-чіп |

- `targets` (гравець сам обирає кого) ≠ `projectiles` (кожен = окрема атака+ціль). Різні kind.
- `hp_max` окремо від `temp_hp` (Aid підіймає МАКС hp, False Life — temp). Різна механіка.

### Дельта vs абсолют — обрано ДЕЛЬТА (§ hole 4)
Формула дає **дельту**, combine = `база + дельта` (база з наявної колонки = єдине джерело).
Абсолют відкинуто: повторював би базу з `damage`/`duration`/тексту → два джерела, drift.
Ціна: combine-семантика per-kind. Additive: damage/heal/temp_hp/hp_max/targets/projectiles/
area/duration. Replace (небагато): `step`-тир типу Geas «→назавжди» інгерентно замінює —
ці кілька лишаються absolute-у-формулі (step дає повне значення). Тобто: `per_slot(...)`=дельта,
`step(...)`=абсолют для свого kind. ⚠ перевірити, що combine знає, який токен add, який replace
— можливо, треба маркер, або правило «step→replace, решта→add».

### Виключення (лишаються проза `higher_level`)
- Виклик-таблиці (Conjure*) — апкаст міняє стат-блок істоти, не число.
- Мета-правила (Dispel Magic, Globe of Invulnerability) — скейлиться правило щодо ЧУЖИХ
  спелів, нема стата на аркуші.
- Кантрип-скейл — `upcast` ПОРОЖНІЙ для кантрипів (інакше подвійний скейл із cantripDieMult).

## 3. Передумови (відкриті items, апкаст на них спирається)
- **Upcast picker** (UBUG ~PLAN.md L1006-1008, A17-rem) — UI, що передає обраний slot-рівень.
  Без нього обидві гілки сплять на базовому рівні. Пікер САМ нетривіальний (§ hole B13):
  енумерація валідних слотів крізь мультиклас-таблицю + окремо пакт-слоти.
- **DiceTray multi-instance** (memory dicetray-attack-damage-concept) — per-instance
  attack+damage з призначенням цілі. `projectiles` без нього деградує в чіп «5 променів» +
  ручний кидок (принцип «підказуємо, не робимо за гравця»). Залежність важча: не «кинь 5
  разів», а per-instance ціль (§ hole B14).

## 4. Локація eval (КРИТИЧНО — з hole B1)
Апкаст рахується **в cast-екшені** (`combat/state`, де слот уже відомий і витрачається),
**НЕ в derive.ts**. Будуємо **ефемерний ExprContext = sheet-ctx + {slot, spell_level}** на
момент касту. `slot` НІКОЛИ не входить у персистентний derive-ctx (інакше ламає BUILD/PLAY
розділення — кожна пасивна фіча «бачила» б сміттєвий slot→0).
Eval через **опційний seam-хук** (як `applyEffects`), не прямий імпорт движка в
`combat/spells.ts` — інакше ламає removability (effects off → база+проза, нуль автоскейлу).

## 5. ДІРИ — порядок вирішення (провалити ДО коду)

Блокери (B) ламають інваріанти; діри (H) треба рішення; залежності (D) важчі, ніж здавалось.

### Треба вирішити першими (міняють де живе eval / скільки механізмів)
- **B1 · slot транзієнтний** → eval у cast-екшені, ефемерний ctx, slot не в derive. (§4)
- **B2 · per_slot читав би character-`level`** (`context.ts:83`) → cast-ctx несе `spell_level`,
  `per_slot` рахує `slot - spell_level`. Конкретний баг, не стиль.
- **B3 · kind-enum ховає 3 підсистеми.** hp_max/temp_hp — це НЕ кидок: Aid/False Life
  накладають ефект, апкаст скейлить його магнітуду → рантайм-ефект+duration (наявна
  custom-effect система), не чіп/damagePool. Effect-granting спели концептуально не «damage».
  ⚠ можливо, для них апкаст скейлить їхню `effects`-колонку, а не окремий kind. Найглибша діра.

### Свідомий трейд
- **H4 · дельта проти дублювання бази** → обрано дельта (§2). Лишається combine add/replace
  per-kind — доспецифікувати маркер/правило.

### Закриваються реюзом наявного (виписати явно)
- **H5 · мульти-тип дамагу** → typed під-слот `damage:bludgeoning:per_slot(1d8)`
  (грамматика вже є, `helpers.test.ts:212`).
- **B6 · removability seam** → опційний хук, fallback база+проза при effects=off. (§4)
- **H7 · дві системи скейлу** → кантрип-скейл (`cantripDieMultiplier`, регекс 5/11/17) — той
  самий шейп. Або підвести під ту саму формулу keyed на `char_level`, або лишити з
  обґрунтуванням. НЕ вдавати, що дупи нема (don't-dismiss-small-dups).

### Друга хвиля — теж інваріантні
- **B8 · провенанс.** Eval повертає {value,error} без `{source,op,amount}`-трейсу. Апкаст-
  дамаг вискочить голим числом без hover-пояснення «8d6 база +2d6 @slot5» → ламає
  explainability. Треба: вплести апкаст-внесок у трейс (eval емітить внесок АБО cast-екшен
  додає рядок трейсу).
- **B9 · per-system 5e/5.5e.** Named-чокпоінт (`compatibility.md`). Одна `upcast`-клітинка на
  `systems:"5e,5.5e"`-рядку не тримає розбіжність (2024 переписав частину HL + базові значення,
  напр. 2024 Cure Wounds 2d8). `upcast` МУСИТЬ наслідувати ту саму per-system стратегію, що й
  базовий `damage` (per-source рядки чи per-system колонка) — явно, не мовчазно «однаково».

### Реальні діри
- **H10 · юніти + i18n чіпів.** Забув інваріант «завжди метрика в дужках»: area/range чіп =
  «40 ft (12 m)», не «40-фт». Тривалість — локале-формат min/hr/day. Підписи
  (промені/цілі/назавжди) — message-каталоги, не хардкод.
- **H11 · degrade на битій формулі.** Гомбрю пише `projectiles:` на одноінстансному, чи биту
  формулу → має бути ТОЙ САМИЙ fallback, що в effects: битий токен → проза `higher_level` +
  прапорець content-health, ніколи тихо-неправильні кістки.
- **H12 · concentration-duration seam.** Hunter's Mark апкаст піднімає cap концентрації
  (8h→24h). Концентрація — окремий play-субстан (активна робота, git-лог). `duration`-апкаст
  на conc-спелі має годувати трекер концентрації, не лише чіп. Живий seam зараз.

### Залежності важчі, ніж подано (не проблема апкасту, але враховувати)
- **D13 · пікер** — валідні слоти крізь мультиклас + пакт (§3).
- **D14 · projectiles-роллер** — per-instance призначення цілі, не N однакових кидків (§3).

### Третя хвиля (свіжий погляд)
- **N1 · ЗНЯТО (перевірено в коді).** Боявся, що `:` роздільника kind колізіїть із `:` у формулі
  (думав про `? :` тернарник). Тернарника НЕМА: guard = `guard ? token` (splitGuard ріже на 1-му
  `?`, `effect.test.ts:531`), `if()` — кома-форма `if(cond,a,b)` (`expression-evaluator.ts:240`),
  у виразі `:` не буває (оператори: `+-*/(),` `< <= > >= == !=` `->` `d`; `:` тільки L1-слот).
  → `kind:formula` ділиться чисто: splitGuard по `?`, тоді token-parser з'їдає провідні `:`-слоти.
  Реюз наявної дисципліни token-parser, НЕ свій split. Не діра.
- **N2 · Флет (не-dice) хіл/дамаг ламає damagePool.** Heal (6th) «70 hp, +10/слот» = флет число;
  Aid +5; Disintegrate «10d6+40» флет-компонента. `damagePool`=Record<sides,count> лише кістки.
  Флет-дельта (Heal +10/слот) → у **флет-мод компоненту** (`parseDamageParts` її має,
  `helpers.test.ts:511`), не в dice-пул. Combine мусить знати dice vs flat.
- **N3 · `inf` вибухає в `base + delta`.** Geas `duration:step(slot,9->inf)` → `base + inf` =
  арифметика на inf → falls loudly (`expression-evaluator.ts:107-108`). Combine add/replace — не
  «step vs per_slot», а **рантайм-чек на inf** (inf→replace) або replace-маркер на токені.
  Конкретизує H4 конкретним крашем.
- **N4 · Тип у токені = ДЕФОЛТ, не escape-hatch.** Web додає вогонь на спелі БЕЗ базового дамагу
  (нема звідки успадкувати тип); Wall of Thorns качає ДВА типи. Type-inheritance із base `damage`
  ненадійне → токен несе тип завжди, коли база не дає. Реюз typed під-слоту (H5).
- **N5 · Preview vs commit.** Гравець хоче БАЧИТИ «5-й:10d6, 6-й:12d6» ДО касту (вибір слоту).
  Апкаст — **функція від слоту** для preview-тултипа, не лише one-shot обрахунок у commit-екшені.
  Eval потрібен і в read-only preview, не тільки в cast-action.
- **N6 · Апкаст юзає EVALUATOR (чиста L2), не effects-APPLICATION toggle.** Вимикач auto-effects
  вимикає *застосування* модифікаторів; evaluator — окрема чиста утиліта. Апкаст залежить від
  **наявності модуля-evaluator**, не від toggle on/off. Розрізнити (sharpens B6/H7).
- **N7 · Free/innate/ritual каст → default `slot`.** Безслотовий/ритуальний каст → RAW базовий
  рівень, апкаст=0. `slot` мусить бути визначений навіть коли пул не чіпається:
  default `slot = spell_level`, delta 0.
- **N8 · Авторинг-UI.** Не-технар не напише `per_slot(1d6)` руками. CLAUDE.md «everything from UI»
  → `EditContentForm` потребує upcast-білдер (форма→токен). Проза `higher_level` = fallback.
- **N9 · Multiple same-kind токени** (Wall of Thorns 2 типи дамагу) → роутер агрегує, не last-wins.
- **Уточнення (не діра):** апкаст-eval читає **заморожений post-derive знімок** + {slot,
  spell_level}, ПОЗА DAG (аркуш уже похідний на момент касту). Чисто — але не пхати апкаст у
  dependency-graph пізніше.

## 6. Верифікація проти коду (2026-08-03 — перевірено, не з голови)

Каст-потік БАГАТШИЙ, ніж припускав → план суттєво де-ризикнутий. Факти:

- **N7 РОЗВ'ЯЗАНО.** Каст-екшен існує: `CombatVM.cast(r, mods, {ritual})` (`state.svelte.ts`) →
  `reserveSpellSlot` → **`slotToSpend(r.level, pools, spent)`** (чиста rules, `spellcasting.ts:51`)
  → `rollSpellCast`/`applySpellEffect`. `slotToSpend` бере **найнижчий** open-слот ≥ рівня
  (`:61-62`) = авто-найнижчий (A17-rem). **Пікер = override цього авто-вибору.** Обраний слот →
  reserveSpellSlot + eval + roll.
- **§4 ПІДТВЕРДЖЕНО.** Eval живе у **VM cast-методах** (`rollSpellCast`/`applySpellEffect`), НЕ
  derive, НЕ новий екшен. Ефемерний ctx будується тут (слот відомий). Removability (B6): ці методи
  вже у route-шарі, не в core — core не імпортує.
- **N2 ПОМ'ЯКШЕНО.** `spellDamagePart` (`state.svelte.ts:679`) вже повертає
  `DamagePartSpec {dice, mod, bonusDice, mods}` — roll-шар підтримує pool+flat. Гап менший:
  `SpellRow.damagePool` dice-only + база-флет не носиться; `mod` бере лише `dmgFx.flat`. Фікс =
  SpellRow несе база-флет, `spellDamagePart.mod` приймає база+ефект+апкаст-флет. НЕ переробка на
  форму атак.
- **B3 ПІДТВЕРДЖЕНО + seam.** `applySpellEffect` (`state.svelte.ts:638`) вже кладе `tokensOf(spell)`
  рантайм-ефектом з `durationToRounds`. Aid `flat_bonus:hp_max+5` вже стає ефектом при касті.
  hp_max/temp_hp-апкаст = **скейлити магнітуду токена по слоту ПЕРЕД applySpellEffect**. Seam є.
- **Warlock forced upcast** — окремий шлях: `slotToSpend` виключає `forcedUpcast`-пули
  (`spellcasting.ts:58`), пакт негейтиться (L1006-1008). Апкаст-слот варлока = `spellLevel`
  forcedUpcast-пулу (`spellcasting.ts:33`).
- **B8 ПІДТВЕРДЖЕНО.** `EvalResult = {ok,value}|{ok,error}` (`expression-evaluator.ts:47`), 0 трейсу.
- **N6 ПІДТВЕРДЖЕНО.** Effects-auto toggle гейтить шари в derive (`derive.ts:352`, `roll.ts:75`,
  `schema.ts:140`); evaluator окремий. Відкрите: чи апкаст поважає toggle «base only».
- **H12 ПІДТВЕРДЖЕНО, гап БІЛЬШИЙ.** `play.concentration` = лише ref-рядок, **без таймера**.
  duration-апкаст conc-спела нема куди годувати (концентрація не таймиться зараз).
- **N1 ЗНЯТО** (грамматика перевірена: нема `?:`).

Підсумок де-ризику: інфра касту (slotToSpend, DamagePartSpec-roll з mod+bonusDice, applySpellEffect
з duration) вже є. Апкаст-робота = (1) пікер override авто-найнижчого, (2) ефемерний eval у VM,
(3) долити результат у наявні spellDamagePart.mod/dice + магнітуди applySpellEffect.

## 7. Процедурне
- Нова колонка `upcast` у SRD-CSV → zod optional; старі юзер-CSV без неї мають вантажитись
  (English-fallback патерн). `pnpm restamp <file>` після заповнення (content-hash drift).
- Core-тести НЕ імпортують effects-модуль (інваріант) — апкаст-тести живуть на combat/cast
  боці або в effects, не в core-rules.

## 8. LOCKED рішення (2026-08-03 сесія — це джерело правди, §2-§5 = робота-до)

**Схема / грамматика**
- Одна колонка `upcast` у `spells.csv`. Токен = `kind:formula`, кілька через `;`. Розбір = реюз
  `splitGuard` (по `?`) + token-parser slot-дисципліни; НЕ наївний split(':'). У виразі `:` не буває
  (перевірено — нема `?:` ternary, `if()` кома-форма). N1 знято.
- Формула = effect-вираз, індекс `slot` (левелд) АБО `char_level` (кантрип). Eval наявним движком.
- Цукор `per_slot(amount)` = `amount*(slot-spell_level)`; `per_slot(amount, k)` =
  `amount*floor((slot-spell_level)/k)`. Читає `slot`+`spell_level` з ЕФЕМЕРНОГО cast-ctx (НЕ derive).
- `step` — заявляти ПЕРШИЙ тир явно, як Rage (`context.test.ts:262`):
  `step(char_level, 1->1, 5->2, 11->3, 17->4)`. Не покладатись на «нижче порогу → 0».

**kind-enum + combine**
- kind: `damage, heal, hp_max, temp_hp, count, area, duration`. `targets`+`projectiles`→**`count`**
  (мультиплікатив), різницю дає наявна колонка `resolution` (attack→N кидків / save→N сейвів /
  auto→N уронів / none→N застосувань). `count` і `area` ОРТОГОНАЛЬНІ (Meteor Swarm = count×area),
  НЕ виключні; `base_count`/`base_area` — незалежні опц. колонки, без exclusivity-валідації.
- combine per-kind: структурована база (damage/heal/hp_max/temp_hp) → **дельта**, `base+delta`;
  неструктурована й треба total (count, duration) → **абсолют**. `inf` тільки в duration (абсолют)
  → ніколи `base+inf` → N3-краш не існує by construction. typed під-слот для мульти-типу:
  `damage:bludgeoning:per_slot(1d8)`.

**Кантрип уніфікація (фіксить баг)**
- Кантрип-скейл ВХОДИТЬ у формулу (індекс `char_level`). `cantripDieMultiplier` регекс — на пенсію.
- Eldritch Blast = `count` (промені), НЕ die-multiply — фіксить наявний баг (`spells.ts:270` робить
  «1d10»→«2d10» замість 2× кидків).
- Інвокації (Agonizing Blast +cha_mod/beam, Eldritch Spear range) = **ефекти scoped на spell_id,
  per-instance**, НЕ скейл/апкаст. Реюз наявного scope-механізму (`attacks.ts` §A/§B scope-на-
  категорію → розширити на spell_id). Перелічувати фіти НЕ треба — усі вони «scoped ефект на спел».

**Роллер — контракт зафіксовано (impl окремо)**
- `DiceTrayRequest` (+) `instances?: number` (default 1) = N незалежних суб-резолюцій одиниці
  (to-hit + її damage). `count`-цикл = це. Per-instance scoped-ефекти лягають у кожну одиницю.
  Проблем із поточним контрактом більше не бачу. Роллер-переробка = окремий item.

**Каст-інтеграція**
- Eval у VM cast-методах (`rollSpellCast`/`applySpellEffect`), ефемерний ctx {slot, spell_level}.
  Пікер = override авто-найнижчого `slotToSpend`. Warlock: слот = `forcedUpcast`-пул spellLevel
  (пікер без вибору).
- N2: SpellRow несе база-флет; `spellDamagePart.mod` фолдить база+ефект+апкаст-флет (зараз
  `damagePool` dice-only, флет губиться — фікс).
- B3 (hp_max/temp_hp): `applySpellEffect` рахує `base+delta`, переписує amount токена.
- B8 трейс: cast-шар СИНТЕЗУЄ `{source:"Upcast (slot N)", op:add, amount}`, evaluator не чіпаємо.
- N6: апкаст ПОВАЖАЄ effects-auto toggle (off → база+проза). Evaluator окремий від toggle, але як
  політика — поважає.

**Дані — нічого з тракту в прозі**
- База хілу: `healDice` регекс-скрейп → **вбити**, класти в колонку `damage` (resolution=auto),
  +mod додає cast (`state.svelte.ts:726`). Правило: що движок ЧИТАЄ — структуровано, не проза.
- `base_count`/`base_area` структуруємо (показ тоталів). area НЕ парсити з `range`-прози.

**Duration / концентрація**
- Одиниця-КАНОН = **раунди** (`durationRounds`/`startedRound`, як ефекти). НЕ секунди: чужа домену,
  фальшива підраундова точність, зайва міграція; 5e сам каже «about 6s» (навмисно розмито). Години/
  дні/permanent = **форматер `rounds→людське`** (дисплей, не зберігання). inf → indefinite (null).
- Duration-апкаст: таймований не-conc ефект → у effect `durationRounds`; conc-cap (Hunter's Mark
  24h) → у `concentration.durationRounds`. (conc-cap БІЛЬШЕ не «display-only».)
- **Концентрація-таймер винесено → [[CONCENTRATION-PLAN.md]]** (Model C: carrier-ефект володіє
  таймером, концентрація = ref; нуль міграції; єдина зміна = завжди створювати carrier навіть
  token-less). Duration-UI редагує carrier.durationRounds → природньо міняє концентрацію. Це
  ПЕРЕДУМОВА duration-апкасту й окремий item — апкаст пише `carrier.durationRounds`.

**Відкладено (scoping, не будуємо на v1)**
- Multi-instance роллер-цикл (контракт зафіксовано, impl — окремий roller-item). Доти `count`
  деградує в чіп «N×» + ручний кидок.
- Preview-тултип «5-й:10d6, 6-й:12d6» (v1 = пікер + оновлення на вибір).
- Guided authoring-білдер (v1 = текстове поле `upcast`, як effects-токени). Проза `higher_level`
  = fallback для не-скалярних (виклик-таблиці, мета-правила).

**Секвенція (MVP-слайс)**
1. ✅ **ЗРОБЛЕНО (окрім пікера)** — Схема `upcast` + zod optional + damage/heal лінійний (лягло в
   `spellDamagePart.mod/dice` + save/auto-гілку). Пікер слоту — ЛИШИВСЯ (зараз auto-найнижчий).
2. count/area-чіпи (display) → effect-granting (hp_max/temp_hp крізь applySpellEffect).
3. Concentration-годинник-контракт (rounds-канон, string→object, ефект-як-залежний) + duration-
   апкаст. **Nб: це чіпає concentration-систему — може бути ОКРЕМИЙ item, апкаст у нього плагіниться.**
4. Кантрип-уніфікація + EB-count фікс (ретайр cantripDieMultiplier).
5. Roller-цикл + invocations scoped-на-spell (окремі великі items, після ядра).
