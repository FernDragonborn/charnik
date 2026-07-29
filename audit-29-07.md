# Аудит 2026-07-29 — воркліст

Формат: `ID [статус] — file:line — що зламано. Фікс: …`. Гейти на момент аудиту зелені
(lint / 872 тести / jscpd). `[ ]` відкрито · `[~]` частково · `[x]` зроблено+перевірено.

## 🐞 Баги

- **BUG-1 [ ]** — `combat/attacks.ts:32` — regex `([+\-−])\s*(\d+)(?!d)` бектрекає на
  багатоцифрових die-count: `"2d6+10d4"`→мод `+1` (має бути null). **Фікс:** `(?!\d*d)`.
  (A7 в AUDIT.md зве це «FIXED» — неповно.)

- **BUG-2 [ ]** — `combat/+page.svelte:54` автосейв deep-track лише `c.play`; без сейву
  мутують `togglePin` (`state.svelte.ts:125` `ui.spellsPinned`), `togglePrepared` (:666
  `build.spells[].prepared`), layout-колбек (:83 `ui.panelColumns`). Втрата даних на
  рестарті. **Фікс:** трекати `c.ui`+`c.build` в автосейв-ефекті або явний save у цих
  трьох. (= хибний `[x]` D3 в AUDIT.md, знижено до `[~]`.)

- **BUG-3 [ ]** — `effects/apply.ts:406` — `Computed` не носить свій `Clamp`, тож
  `applyEffects` re-folds без клампа бази: `deriveSpeed {min:0}` (`derive-stats.ts:198`) →
  від'ємна швидкість від `flat_bonus:speed-40`; `maxHp {min:1}` (`derive.ts:374,419`) → ≤0.
  Навіть порожній список ефектів може дати інше значення, ніж клампнута база — порушує
  інваріант «`{value,trace,notes}` ідентичний on/off/deleted». **Фікс:** носити clamp у
  `Computed` (або параметром) і застосовувати після фолду.

- **BUG-4 [ ]** — `repository.ts:309` `appendLog` read-modify-write, fire-and-forget з
  `combat/state.svelte.ts:171`. Два швидкі роли читають той самий `prev` → другий затирає
  перший. **Фікс:** черга-ланцюжок промісів на слаг (заодно прибирає O(файл) на апенд).

## 🏛️ Архітектура

- **ARCH-1 [ ]** — i18n не покриває combat/build: `en.json` не має цих секцій, увесь
  CombatVM хардкод EN (тости, лейбли, `combat/constants.ts`); svelte-i18n у ~16/160 файлів.
  Найбільший розрив з «i18n is data-driven».

- **ARCH-2 [ ]** — `content/sources.svelte.ts:15` колізії/сорси в localStorage (`charnik:sources`),
  не в `collisions.json`. Не переноситься з data-папкою, гине при чистці webview. **Фікс:**
  файл у dataDir через Storage, АБО оновити інваріант у CLAUDE.md. (= B6 `[~]`.)

- **ARCH-3 [ ]** — `routes/+page.svelte:51` `{@html $_('demo.body')}` без санітайзу; каталоги
  user-droppable = untrusted (PLAN.md:1101). **Фікс:** спільний `sanitizeHtml()` (DOMPurify),
  як у WikiDetail.

- **ARCH-4 [ ]** — розмір-токени не енфорсяться: stylelint ловить лише кольори, ~958 `Npx` у
  .svelte. **Фікс:** stylelint-правило на числові px (allowlist 1px) + міграція на
  `--space-*`/`--font-size-*`.

## 🧹 Смели

- **SMELL-1 [ ]** — CSS-дублікати гаряча точка: jscpd CSS 4.5% рядків / 9.1% токенів (TS
  0.14%). Панелі комбату повторюють блоки → хостити в `styles/components.css` (grep імен
  перед хойстом — css-hoist-name-collision).
- **SMELL-2 [ ]** — `combat/+page.svelte:71` `deriveHealth.set(c.build.name,…)` — тезки
  перезаписуються. Є `c.id`.
- **SMELL-3 [ ]** — `compendium/[...entry]/+page.svelte:52-58` ручний localStorage повз
  `util/persist` (`readStored`/`writeStored`).
- **SMELL-4 [ ]** — `combat/state.svelte.ts:668` `s.spell.endsWith(':'+r.id)` — парс ref
  (`type:source:id`) самоочевидніший, не ламається від зміни формату.
- **SMELL-5 [ ]** — послідовне I/O: `content/loader.ts:455` файли контенту строго послідовно
  (Promise.all дешевий); `repository.ts:261` `listCharacters` послідовно.
- **SMELL-6 [ ]** — `combat/state.svelte.ts:457-469` death save через трей тільки ролить;
  інстант-шлях пише пипи (nat20→1HP). Є ручні пипи, але непослідовно.

## 🏷️ Неймінг

- **NAME-1 [ ]** — комбат-типи повз verbose-naming: `combat/spells.ts:27-45` `SpRow` поля
  `spe/res/tm/ct/prep/conc/dmg`; типи `Atk/SpRow/SpGroup`; VM `cmTarget/cmSign/cmAmount`
  (`state.svelte.ts:188-190`); локалки `fx/r/at`. Запланований rename-pass не зроблений.

## 📝 D1 exception-коментарі

- **[ ]** переписати exception-коментарі `CombatVM` (`state.svelte.ts:66-77`) і `BuildVM`
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
