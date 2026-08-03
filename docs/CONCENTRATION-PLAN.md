# CONCENTRATION-PLAN.md

Робочі нотатки по таймеру/контракту концентрації. Для себе — щільно, з file:line.
Винесено з [[UPCAST-PLAN.md]] (duration-апкаст плагіниться сюди), бо це чіпає concentration-
систему НЕЗАЛЕЖНО від апкасту. Оновлювати при зміні рішення (§8.6 conventions).

## Статус

DESIGN. Не кодимо. Рішення = **Model C** (carrier-ефект володіє таймером, концентрація = ref на
нього). Резюме-вказівник: почати з §2 (модель) + §4 (єдина зміна коду).

## 0. Що є в коді зараз (перевірено 2026-08-03)

- `play.concentration` = **ref-рядок | null** (`schema.ts:129`-район), snakeRef на завантаженні
  (`repository.ts:61`). Дериватив-лейбл `conc` (`state.svelte.ts:429-434`); guard-вари
  `is_concentrating` (`derive-context.ts:84`), `isConcentrating` (`derive-plugins.ts:72`).
- Ставиться на касті conc-спела: `play.concentration = r.ref` (`state.svelte.ts:757`); попередня
  replace → `removeLinkedEffect(prior)` (`:756`).
- `applySpellEffect` (`state.svelte.ts:638`): ЯКЩО спел має токени (`!tokens.length` рання, `:642`)
  → лінкований ефект `source=r.ref` з `durationRounds = durationToRounds(spell.duration)` (`:644`).
- Згасання: `expireTimedEffects` (`economy.svelte.ts:80-92`): expired ефект, чий
  `source === play.concentration` → `concentration = null` (`:90`). Коментар (`:77-78`): «cast-linked
  effect that expires also ends its concentration (the spell's duration IS the concentration's, RAW)».
  **Це вже Model C для token-carrying спелів** — таймер живе на ефекті, концентрація на нього дивиться.
- `isEffectExpired(e, round)` = `e.durationRounds != null && round >= (e.startedRound ?? 0) +
  e.durationRounds` (`effects-view.ts:215`).
- Тік: `endTurn` → `round+=1` → `expireTimedEffects` (`economy.svelte.ts:101-102`); поза боєм
  `passTime` → `round+=rounds` → `expireTimedEffects` (`:112-113`). ОДНА функція (B19).
- Довгий відпочинок → концентрація безумовно null (`combat.test.ts:220-226`); тап індикатора →
  `clearConcentration` (`state.svelte.ts:442-447`): `removeLinkedEffect` + null.
- Duration-UI: `newEffectDuration` (`state.svelte.ts:896-898`, default 10, 0=indefinite) = довжина
  для НАСТУПНОГО доданого ефекту; стрес-контрол `CombatMenus.svelte:89-98`. Тобто довжина живе на
  ефекті як реальне поле `durationRounds`, і UI її крутить.
- `durationToRounds` (`effects-view.ts:220`): regex `(\d+)\s*(round|minute|hour|day)`,
  «Concentration, up to 1 hour» → 600; null для Instantaneous / Until dispelled / Special.
- **CON-сейву від урону НЕМА** в коді (grep порожній). `TESTING.md:73` «prompt-on-damage (pure
  decision fn)» — ПЛАНОВАНЕ, окремий сиблінг (§6).

## 1. Дві діри поточної моделі

1. **Token-less conc-спели без таймера.** applySpellEffect повертає рано, якщо токенів нема
   (`:642`) → carrier-ефекту нема → нічого не згасає → концентрація тримається **до довгого
   відпочинку**. (Чистий контроль-спел без self-buff токена.)
2. **Upcast-cap нема куди писати.** Duration береться з `durationToRounds(база)` — апкаст (Hunter's
   Mark 24h) туди не тече.

## 2. Рішення: Model C — carrier-ефект володіє таймером, концентрація = ref на нього

Поточна модель ВЖЕ така для token-carrying спелів. Робимо її **uniform**:
- `play.concentration` **лишається `string | null`** (ref). **Нуль міграції, `schemaVersion` не чіпаємо.**
- Таймер живе на **carrier-ефекті** в `play.effects` (`source=ref`, `durationRounds`+`startedRound`).
- **Завжди створювати carrier для conc-спела, навіть token-less** (порожній `effects: []`, лише
  таймер+source). Це закриває дірку 1.
- Duration-UI редагує **реальне поле `durationRounds`** carrier-а → природньо міняє тривалість
  концентрації (це те саме поле — **редагування «довжини ефекту» = редагування концентрації**,
  без проксі). Показ теж чесний.

**Чому C, не «концентрація володіє окремим годинником» (відкинута Model A):** A потребувала б
спец-проксі на показ І редагування duration-UI для conc-лінкованих ефектів (у них не було б власного
поля) + новий concentration-timer expiry-шлях. C реюзає наявні expiry + duration-UI, додає ~1 рядок.
Ціна C: концептуально концентрація = «ref на свій timer-ефект», не окремий стан. Прийнятно.

## 3. Мапа кінцівок концентрації

| кінцівка | тригер | статус |
| --- | --- | --- |
| таймер | carrier expired (`round >= startedRound+durationRounds`) → `source===conc` → null | **є** (`economy.svelte.ts:90`), стане uniform |
| replace | новий conc-спел | є (`state.svelte.ts:756`) |
| manual drop | тап індикатора | є (`clearConcentration`) |
| long rest | відпочинок | є (`combat.test.ts:226`) |
| incapacitated / 0 hp | стан | ⚠ перевірити чи є |
| CON-сейв від урону | отримання урону | **НЕМА** — сиблінг-item (§6) |

## 4. Єдина зміна коду

`applySpellEffect` (`state.svelte.ts:638-642`): **прибрати ранній `return` при `!tokens.length` ДЛЯ
conc-спелів** — завжди створювати carrier (з durationRounds), навіть коли токенів нема. Тоді:
- token-less conc-спел отримує carrier → таймер працює (дірка 1);
- усе інше — expiry (`economy.svelte.ts:90`), duration-UI, `hasTimedEffects` (`state.svelte.ts:134`),
  `removeLinkedEffect` — **вже готове**, нуль змін.

Дисплей: порожній carrier (0 токенів) має рендеритись у панелі як **маркер «Концентрація: X»**, не як
пустий баф. Єдина UI-доробка.

## 5. Міграція

**Нема.** `play.concentration` лишається ref-рядком; таймер на ефекті. Старі сейви mid-concentration
без carrier-а (token-less) — просто без таймера до re-cast (поводяться як зараз). Прийнятний edge.

## 6. Перетини

- **Duration-апкаст** ([[UPCAST-PLAN.md]]): conc-cap пише `carrier.durationRounds` (через
  `eval(upcast duration, slot)` замість `durationToRounds(база)`); таймований НЕ-conc ефект — свій
  `durationRounds`. Цей план — передумова.
- **CON-сейв від урону** — СИБЛІНГ, не тут. `TESTING.md:73`. Принцип play-tracker «surfaces, never
  forces» → подія урону = НАГАДУВАННЯ кинути сейв (DC max(10, ⌊dmg/2⌋)), не авто-скидання. Дірка
  існувала до апкасту.
- **rounds→людське форматер** — спільний із duration-апкаст-чіпом; ОДНЕ місце.

## 7. Відкладено / перевірити
- incapacitated/0-hp → кінець концентрації: перевірити чи вже є, інакше додати.
- Форматер порогів (раунди/хв/год/дні) — тривіальне, при кодуванні.
- Порожній-carrier рендер як concentration-маркер — UI-доробка (§4).
