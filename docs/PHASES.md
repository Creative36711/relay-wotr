# War Of The Ring: Remaster · фазы 1–8

Редакция 1.2 · 2026-11-20 · владелец: Warden.

Источник статуса исполнения — база Notion «Миссии»; этот файл фиксирует продуктовую последовательность и опубликованную редакцию. Фаза — рамка результата, миссия — принимаемая работа внутри неё. В каждой фазе есть минимум одна миссия.

## Общие гейты

Любая фаза закрывается только когда:

1. все обязательные миссии приняты Warden;
2. независимые аудиторы воспроизвели оракул на принятом SHA;
3. save/schema migration и deterministic hash не имеют незакрытой регрессии;
4. retail-dependent критерии проверены в Arena на реальных BFME2 1.06 + RotWK 2.01 данных;
5. заявленный Cost gate соответствует `docs/agents/cost-gates.md`; full build/Drive hydration не запускаются для несвязанных карточек;
6. обязательные локали `en`, `ru`, `zh-Hans`, `ja`, `pt-BR`, `de`, `fr`, `ko` имеют coverage report, а локаль не меняет canonical hash;
7. документация, Campaign Pack schema и upstream pin соответствуют коду.

## Фаза 0 · Baseline decisions (решения приняты; history sanitation открыта)

Приняты ADR-001…004: Godot-native boundary; перенос legacy world через one-way importer без legacy runtime; tactical capacity по opposed sides с fallback/autoresolve; custom maps как лицензированные content-addressed overlays; eight-locale baseline; адаптация существующего launcher/one-archive pipeline с отдельной WOTR identity; tiered build/retail cost policy; Upstream Integrator как Executor. Полный legacy dataset и `__wotr_maps.big` остаются заблокированы license/provenance gate. Retail history всё ещё содержит запрещённые объекты: cleanup выполняется отдельно как destructive owner-approved repository operation, не блокирует проектирование, но public release workflow остаётся заблокирован до fresh-clone all-ref audit rc 0.

## Фаза 1 · Technical walking skeleton

**Цель:** доказать вертикальный путь отдельного ядра через реальный tactical runtime.

### WOTR-1.1 · Контракты и детерминированный walking skeleton

`Campaign Pack → карта → WEGO move → conflict → BattleRequest → OpenBFME tactical map → BattleResult → campaign state → save/load`.

Выход: маленький synthetic Campaign Pack, отдельный `WotrRemaster` core, canonical state/hash/save, Godot map interaction, native adapter и один полный retail round-trip в Arena. Tactical profile: Vanilla RotWK 2.01. Подробное ТЗ: `docs/missions/WOTR-1.1.md`.

### WOTR-1.2 · Player entry and portable playtest package

Зависит от принятой WOTR-1.1, но снятие этой зависимости само по себе не запускает подготовку: для старта WOTR-1.2 требуется отдельное будущее решение. Существующий OpenBFME launcher и one-archive pipeline адаптируются как WOTR product flavor: один распаковываемый архив на заявленную платформу, WOTR identity/route, отдельные update data/settings/saves, retail detection, offline start, signed updates и fail-closed package audit. Стратегия и tactical runtime остаются одним native game process; новый updater не создаётся. После отдельного решения о подготовке первой карточкой должна стать B0-репетиция оракула. Подробное ТЗ: `docs/missions/WOTR-1.2.md`.

Выход: первый внутренний playtest, который обычный тестер запускает через **Play WOTR Remaster** без checkout, build tools, environment variables или developer CLI. Public release остаётся заблокирован history/license/signing gates; непроверенная платформа не называется поддерживаемой.

## Фаза 2 · Campaign Pack и редактор

**Цель:** сделать стратегический мир полностью data-driven и редактируемым.

### WOTR-2.1 · Campaign Pack v1 и editor loop

Schema/versioning, topology and hex presentation data, factions/regions/armies, ordered primary/fallback map references, content-addressed map components, validation diagnostics, migrations, undo/redo, import/export and reopen-identical hash. Versioned one-way legacy importer проходит clean-room fixture, stable-ID/canonical-output/provenance-loss tests; full legacy content не публикуется до license gate. Vanilla sample pack и licensed custom-map sample проходят один validator.

## Фаза 3 · Strategic MVP

**Цель:** законченный sandbox-first цикл кампании с простым AI.

### WOTR-3.1 · WEGO strategic MVP

Turn planning/resolution, movement, conflicts, economy/recruitment baseline, fog/visibility baseline, simple command-producing AI, autoresolve baseline, campaign victory/defeat and repeatable 20-turn simulation. Conflict setup partitions armies into opposed tactical sides; allies share a start, capacity overflow uses a compatible declared fallback map or canonical autoresolve with explicit reason. Narrative content не является условием MVP.

## Фаза 4 · Isengard–Rohan–Gondor visual slice

**Цель:** одна качественная вертикальная область Средиземья.

### WOTR-4.1 · Трёхфракционный visual slice

2.5D terrain and landmarks, readable hex/region overlays, strategic armies, weather/time presentation, polished HUD, editor workflow and tactical transitions for Isengard, Rohan and Gondor. Importer is exercised on an authorized or clean-room representative slice. Visual/performance budgets and locale screenshots/font coverage are checked on the target profile.

## Фаза 5 · Full Middle-earth

**Цель:** масштабировать проверенный slice до полной карты и основного состава сторон.

### WOTR-5.1 · Middle-earth campaign pack

Полная topology, основные factions, стартовые сценарии, map art/LOD/streaming, regional encounters and balanced strategic data. Legacy-authored dataset enters the distributable pack only with recorded license/provenance authorization; otherwise equivalent clean-room data replaces it. Content validation, locale coverage и deterministic simulation остаются зелёными на полном объёме.

## Фаза 6 · Mods и custom content

**Цель:** публичный, безопасный и воспроизводимый content pipeline.

### WOTR-6.1 · Mod-aware Campaign Packs

Profile inheritance/overrides, dependency and conflict diagnostics, licensed custom tactical maps with declared starts/capacity and content hashes, custom asset provenance/licensing, pack discovery, deterministic overlay order and compatibility matrix. Vanilla RotWK 2.01 не меняется при установке mod pack.

## Фаза 7 · Advanced systems и narrative/hybrid

**Цель:** глубина кампании поверх стабильного ядра.

### WOTR-7.1 · Events, diplomacy and hybrid campaigns

Versioned event system, quests/objectives, diplomacy, heroes and persistent consequences, narrative/hybrid layers, authoring support and replay-safe event decisions. Контент остаётся данными; core не ветвится под один сценарий.

## Фаза 8 · Advanced AI и multiplayer

**Цель:** сложный AI и сетевой strategic режим после зрелого determinism/save.

### WOTR-8.1 · Lockstep strategy, reconnect and advanced AI

Advanced planning AI, deterministic lockstep command stream, desync detection, replay, save/resume/reconnect, host migration policy and mixed strategic/tactical multiplayer compatibility. Ни один сетевой путь не обходит обычную command validation.

## Активность

Активная фаза: **1**. Текущий принимаемый результат: **WOTR-1.1**. `WOTR-1.2` остаётся черновиком без живых карточек в «Запросах», включая B0; её преждевременно созданная B0 архивирована. Сначала Coordinator нарезает реализацию WOTR-1.1, и команда завершает эту миссию. Даже принятие WOTR-1.1 не создаёт новую WOTR-1.2 B0 автоматически: подготовка WOTR-1.2 ждёт отдельного будущего решения. Остальные миссии остаются черновиками до прохождения зависимостей своей фазы и отдельного решения об их подготовке.

Рекомендуемый release milestone после фазы 3 — публичный alpha только при зелёных retail-history, license/provenance, signing и fresh-profile package gates. Это не календарное обещание и не разрешение публикации из ранних фаз.
