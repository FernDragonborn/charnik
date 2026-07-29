# Аудит 2026-07-29 — воркліст

Формат: `ID [статус] — file:line — що зламано. Фікс: …`. Гейти на момент аудиту зелені
(lint / 872 тести / jscpd). `[ ]` відкрито · `[~]` частково · `[x]` зроблено+перевірено.

## 🐞 Баги

- **BUG-1 [x]** — `combat/attacks.ts:32` — regex `([+\-−])\s*(\d+)(?!d)` бектрекав на
  багатоцифрових die-count: `"2d6+10d4"`→мод `+1` (мав бути 0). **Фікс:** `(?!\d*d)` +
  тест `2d6+10d4`. (A7 в AUDIT.md звав це «FIXED» — було неповно.)

- **BUG-2 [x]** — `combat/+page.svelte:54` автосейв deep-track лише `c.play`; без сейву
  мутували `togglePin` (`state.svelte.ts:125` `ui.spellsPinned`), `togglePrepared` (:666
  `build.spells[].prepared`), layout-колбек (:83 `ui.panelColumns`). Втрата даних на
  рестарті. **Фікс:** автосейв-ефект тепер deep-track `c.play`+`c.ui`+`c.build`. (= хибний
  `[x]` D3 в AUDIT.md, тепер реально закрито.)

- **BUG-3 [x]** — `effects/apply.ts:406` — `Computed` не носив свій `Clamp`, тож
  `applyEffects` re-folds без клампа бази: `deriveSpeed {min:0}` (`derive-stats.ts:198`) →
  від'ємна швидкість від `flat_bonus:speed-40`; `maxHp {min:1}` (`derive.ts:374,419`) → ≤0.
  Навіть порожній список ефектів давав інше значення, ніж клампнута база — порушувало
  інваріант «`{value,trace,notes}` ідентичний on/off/deleted». **Фікс:** `Computed.clamp`
  (опційне поле, `computed()` його зберігає), `applyEffects` re-folds під `base.clamp` + тест.

- **BUG-4 [x]** — `repository.ts:309` `appendLog` read-modify-write, fire-and-forget з
  `combat/state.svelte.ts:171`. Два швидкі роли читали той самий `prev` → другий затирав
  перший. **Фікс:** per-slug promise-chain (`appendChains` Map) серіалізує read→write; тест
  на 20 конкурентних апендів. (O(файл)-читання лишив — черга вже прибирає гонку; кеш tail =
  зайвий стан, ризик drift із зовн. правками файлу.)

## 🏛️ Архітектура

- **ARCH-1 [ ]** — i18n не покриває combat/build: `en.json` не має цих секцій, увесь
  CombatVM хардкод EN (тости, лейбли, `combat/constants.ts`); svelte-i18n у ~16/160 файлів.
  Найбільший розрив з «i18n is data-driven».

- **ARCH-2 [ ]** — `content/sources.svelte.ts:15` колізії/сорси в localStorage (`charnik:sources`),
  не в `collisions.json`. Не переноситься з data-папкою, гине при чистці webview. **Фікс:**
  файл у dataDir через Storage, АБО оновити інваріант у CLAUDE.md. (= B6 `[~]`.)

- **ARCH-3 [x]** — `routes/+page.svelte:51` `{@html $_('demo.body')}` без санітайзу; каталоги
  user-droppable = untrusted (PLAN.md:1101). **Фікс:** `sanitizeHtml()` (DOMPurify) у
  `content/markdown.ts` — спільний seam, викликається в `db-body`. `<b>` лишається, скрипти/on* зрізає.

- **ARCH-4 [ ]** — розмір-токени не енфорсяться: stylelint ловить лише кольори, ~958 `Npx` у
  .svelte. **Фікс:** stylelint-правило на числові px (allowlist 1px) + міграція на
  `--space-*`/`--font-size-*`.

## 🧹 Смели

- **SMELL-1 [ ]** — CSS-дублікати гаряча точка: jscpd CSS 4.5% рядків / 9.1% токенів (TS
  0.14%). Панелі комбату повторюють блоки → хостити в `styles/components.css` (grep імен
  перед хойстом — css-hoist-name-collision).
- **SMELL-2 [~]** — `combat/+page.svelte:71` `deriveHealth.set(c.build.name,…)`. Оцінено:
  стор — single-open (не Map), `characterName` — суто display-лейбл (`ContentHealth.svelte:121`);
  тезки реально НЕ колізять, а `c.id`-поле ніхто не читає → dead flexibility (YAGNI). Лишено.
- **SMELL-3 [x]** — `compendium/[...entry]/+page.svelte:52-58` ручний localStorage → тепер
  `readStored`/`writeStored` з `util/persist`.
- **SMELL-4 [x]** — `combat/state.svelte.ts:668` `s.spell.endsWith(':'+r.id)` → `idOf(s.spell)
  === r.id` (парсить id-сегмент рефа) — самоочевидно й стабільно до зміни `type:source:id`.
- **SMELL-5 [x]** — послідовне I/O: `loader` тепер read-ahead (`Promise.all` на body-реди,
  акумуляція лишається послідовною → детермінізм merge/dedup незмінний); `listCharacters`
  повністю паралельний (сортується по імені в кінці, порядок неважливий).
- **SMELL-6 [x]** — `combat/state.svelte.ts:457-469` death save через трей лише ролив, не
  застосовував наслідок (пипи/nat20→1HP), бо tray-контракт не має result-callback. **Фікс:**
  death save завжди інстант + авто-apply (трей-гілку прибрано — нема що кастомізувати: d20-vs-10,
  adv/ефекти вже фолдяться через `fx`). Ручні пипи лишились для корекцій.

## 🏷️ Неймінг

- **NAME-1 [x]** — rename-pass зроблено: типи `Atk/SpRow/SpGroup` → `Attack/SpellRow/SpellGroup`;
  VM `cmTarget/cmSign/cmAmount` → `customModTarget/Sign/Amount`; усі криптик-поля `SpellRow`:
  `spe→summary`, `res→resolution`, `resLabel→resolutionLabel`, `tm→levelTag`, `ct→castTimeIcon`,
  `dmg→damagePool`, `conc→concentration`, `prep→prepState` (+ `economy.ctSlot` параметр).
  Ультра-локалки `fx/r/at` лишено навмисно (конвенційні loop/param-вари; rename кожного `r` по
  шаблонах = багато churn / ризик за копійки ясності).

## 📝 D1 exception-коментарі

- **[x]** переписані exception-коментарі `CombatVM` (`state.svelte.ts:66-77`) і `BuildVM`
  (`build/state.svelte.ts:92-104`): завищують небезпеку («extracting any means moving reactive
  state»). Реально bind:-surface — 7-9 і 3 скаляри; найбільший виносний шматок (spell/cast-слайс
  ~200р) має 0 bound-стану, виноситься через доведений тут subsystem-патерн (tray/economy/resources).
  Переписати на «deferred, not worth churn; якщо різати — spell/cast + HP слайси». `deriveSheet`
  (`derive.ts:271-275`) виняток обґрунтований — не чіпати.

## ✅ Статус AUDIT.md

**D3 — єдиний хибно закритий `[x]`** (persist-половина пінів не працює = BUG-2); знижено до
`[~]`. Решта `[x]` перевірена повним grep-проходом — реально зроблена, включно з G1–G5.
Нюанси: B4/A14 закриті чесно, нові баги поверх = BUG-3/BUG-4; A7 `[~]` під-твердження
parseDamage неповне = BUG-1.

**Не пере-аудитити (перевірено чисте):** no eval/any/ts-ignore; rules-core не імпортує
effects; Tauri-імпорти лише в дозволених місцях; path sandbox (S1); atomic temp→rename +
BOM/CRLF; loader dup `source:id` (B22); fold-порядок детермінований.

**Пріоритет:** BUG-2, BUG-3 (втрата даних / зламаний інваріант) → BUG-1, BUG-4 (точкові) →
ARCH-1 (стратегічний борг).

---

## 📋 Відкриті пункти з decisions-pending.md (звірено 2026-07-29 vs AUDIT + код)

Рішення прийняті (§0.5), лишилась ІМПЛЕМЕНТАЦІЯ. Документ синхронізовано (sync-банер угорі
DECISIONS-PENDING + фікс хибного D3). Реально ще не зроблене:

**Spellcasting**
- **B25 / RV4** — сабклас-кастери (EK/AT): слоти/DC/cap є, спел-список порожній
  (`buildSpellAccess` індексує лише `class`-рядки). Фікс: subclass→list seam.
- **A17-rem** — pact-слоти не пипами / pure-warlock каст не слот-гейтиться; upcast-picker
  (зараз авто-найнижчий); ritual-source нюанс.

**Play-state**
- **B2** — hit-dice spend/restore UI (death-saves + exhaustion вже є). Тягне **D19**
  (`exhaustion max(6)` хардкод→дані), **L2R-16** (`RAGE_CONDITION_ID` хардкод).

**Attack/damage as data**
- **D9-tail** — magic-weapon +X зроблено; `parseDamage` string round-trip відкритий.
- **D6 / D10** — механіка з прози (`healDice`/`durationToRounds`/`castingIcon`/`effectHint`)
  → у колонки.

**Content**
- **E4** — хвіст порожніх `effects`-колонок feature-рядків (conditions/grapple/rage/rollables/
  exhaustion закодовано).

**Великі фічі (рішення A є, не збудовано)**
- **D16** — модель «player choice» (half-feats, Magic Initiate picks).
- **B7** — lb→kg + рендер carrying-capacity + optional-toggle (чекає N1 inventory UI).
- **B8** — drop-in локалі з dataDir + sweep хардкод-EN (= ARCH-1).

**Storage / robustness**
- **B6** — source/collision-конфіг localStorage→файл dataDir (= ARCH-2).
- **B11** — розмір-кап `Storage.read()` (`size` у `FileEntry`).
- **B24** — гранульований per-file reparse вотчера.
- (**D3** = BUG-2 вище; **B4** зроблено, але гонка = BUG-4.)

**CSS / структура** (не блокери)
- **D1** (спліт VM-ів + `derive.ts`), **C2** (css name-collisions), **C3** (css dup-кластери),
  **ARCH-4** (stylelint px-гард — нова знахідка).

**Дрібне:** F6 (`errText` inline), F8 (focus-trap/backdrop діалогу), D19-rem
(`RollEffects.flat` контракт у тип), B17/B18 residual (baked EN label / `name_en` +
`Contribution.note`).

**Відкладене за стратегією:** B23 + T4/T5 (integration-tier/coverage → pre-release);
PLG-4/6/7-D/8/9-rem + PLG-T1/T2; EFX-TAIL (`treat_as`/Elven Accuracy/Extra Attack);
piece-3 `resource_options.csv` schema.

---

## 🏛️ Архітектурні рішення / must-adhere

> Витягнуто з `AUDIT.md` + `decisions-pending.md` ПЕРЕД їх видаленням — це унікальні
> обмеження (не воркліст), яких немає в CLAUDE.md/PLAN.md/EFFECTS.md або які їх переглядають.
> «Ідеальний дім» у дужках: ці нотатки варто перенести туди, бо цей файл теж тимчасовий.

**1. Strict/Free — гранулярність ПЕР-БЛОК, стан зберігається ПЕР-ПЕРСОНАЖ** (DECIDE-0). Кожен
персонаж має власну мапу `{блок → strict/free}` у character JSON — стан кожного блоку для кожного
персонажа окремий; default strict; БЕЗ верхнього «set-all» toggle. **Відхилено:** єдиний флаг на
весь персонаж (нинішній `ui.strict`) і глобальний-на-застосунок. **PLAN.md рядок 1457 каже «per
character» у сенсі «один флаг на персонажа» — застаріло, DECIDE-0 переглянув на пер-блок.** Strict =
движок енфорсить RAW (manual HP-max не глушить `hp_max`-ефекти, слоти/pact енфорсяться, броня-без-
проф блокує каст, cap-и); Free = ручні оверрайди/кастом-ефекти/хоумбрю можуть перевищувати RAW,
видимо позначені. Build-side `ui.strict` (єдиний флаг) мігрує на пер-блок мапу в JSON.
→ **дім: CLAUDE.md + PLAN.md (виправити 1457).**

**2. resource_options.csv (piece-3, ще НЕ збудовано)** — дизайн лише в decisions-pending §0.5.
Колонки `resource_id, id, name_*, cost, action, action_type`. `cost` = L2-вираз над ІСНУЮЧИМИ
змінними + спец-kind `x` (гравець вводить 1..remaining — Lay on Hands). `action` = обмежений словник
≈ ІСНУЮЧІ ефекти (`apply_condition` ЛИШЕ self як Rage — на TARGET у нас моделі нема, Stunning Strike =
`note:`+DC; roll/heal; `note:` описове). `resource_id` лінкує id `grant_resource`-токена («ki») —
ПЛОСКИЙ namespace (не source-namespaced); identity рядка = `(resource_id, id)` через collision-UI.
Комбат-екшн опції (Flurry, Stunning Strike) → в ACTIONS-блок з cost-чіпом, НЕ під resource-пипи (пипи =
чисті лічильники). «largest max wins» (`apply.ts:268`) RAW-correct для multiclass Channel Divinity.
Валідувати проти Ki/Channel Divinity/Metamagic/Wild Shape. `isRowActive` діє й на цю таблицю (B5/B15).
→ **дім: PLAN.md (spellcasting/resources).**

**3. Умисні НЕ-дублікати — НЕ мерджити** (AUDIT §F; surface.mjs досі флагає як suspects, а кожна
сесія робить «Reuse before you write» → ризик хибного злиття):
- `EFFECT_KINDS` (`content/schemas` vs `effects/token-parser`) — SEPARATE навмисно: content-валідація
  не залежить від removable effects-модуля; стереже drift-тест у `effects.test.ts`, не спільний імпорт.
- `formatModifier` (`rules/dice`) vs `signed` (`util/format`) — той самий body, але `dice.ts` = pure
  core, не тягне util у гарячий roll-path; єдина прийнята копія.
- `displayNamesByLocale`/translate name-reads vs `localizedName` — РІЗНЕ: search = індекс по ВСІХ
  локалях без фолбеку; translate = `?? ''` (порожнє = «не перекладено», НЕ EN-фолбек). Мердж зламає обидва.
- `cap`/`label` LABELS-maps (`content/detail`,`homebrew`,`grouping`) — спільний лише title-case fallback
  (`titleCase`); самі LABELS-мапи різні, лишаються окремими.
→ **дім: CLAUDE.md «Reuse before you write» або код-коментар біля кожного.**

**4. НЕ тайтити loose `z.record` keys** (G3, WON'T-DO). `abilityBoosts`/`spellSlotsSpent`/`hitDiceSpent`/
`resourcesSpent`/`panelColumns` = partial maps; `z.record(z.string())` + `noUncheckedIndexedAccess`
(`V | undefined`) — ЧЕСНА типізація. Брендинг ключа зробив би тип НЕправдивим (каже defined, рантайм
absent) + міграція заради near-zero виграшу. Не «виправляти» назад. → **дім: код-коментар/memory.**

**5. Effects-engine maintenance-пастки** (decisions-pending §5.0):
- `deriveSheet` ЧИСТА — НІКОЛИ не мутувати `character` всередині derive; клампи/персист лише у VM-ах
  (напр. `clampCurrentHp` у combat `$effect`). CLAUDE.md каже «core pure» загально — це конкретика.
- **B13-trap:** новий kind/target треба додати У ТРЬОХ місцях — derive `isTargetSupported` (closed-vocab
  set) + `effectTag` (лейбл панелі) + `lintEffectTokens` (reachability), інакше токен фолдиться в нікуди
  або рендериться сирим рядком.
- SPEC4: absent whitelisted var → 0; unknown token → INERT NOTE (ніколи не dropped/throw).
- Naming seam: сирий рядок = «token» (`parseToken`), об'єкт = «effect» (`ParsedEffect`); порівнювати
  kind-и через `EFFECT_KIND`-консти, не сирі рядки.
→ **дім: EFFECTS.md.**

**Порада:** цей файл теж тимчасовий — пункти 1, 3, 5 варто перенести в CLAUDE.md/EFFECTS.md/PLAN.md
(постійні доми), а не лишати тут. Скажи — перенесу.
