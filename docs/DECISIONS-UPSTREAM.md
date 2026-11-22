# WOTR Remaster · журнал решений

Этот файл содержит только решения WOTR Remaster. Импортированные ScriptCat regression fixtures структурно обезличены и не определяют продукт; единственная точная запись происхождения исходного snapshot находится в `tools/script-cat/UPSTREAM.md`.

## WOTR-D-001 · Один репозиторий и ScriptCat как транспорт

**Дата:** 2026-11-20 · **Статус:** принято.

Код продукта, процессные документы, транспорт ScriptCat и upstream pin живут в `Creative36711/open-bfme`. Отдельный orchestration-репозиторий не создаётся. Командный процесс реализуется через зоны, карточки, независимый аудит, исполнимые оракулы и append-only evidence.

**Откат:** ScriptCat можно выключить, не меняя продукт; перенос управления в другой репозиторий требует нового решения.

## WOTR-D-002 · Отдельное deterministic core

**Дата:** 2026-11-20 · **Статус:** принято.

Стратегическое ядро называется `WotrRemaster` и не зависит от Godot presentation. Retail-faithful OpenBFME `LivingWorldLogic` не является скрытым source of truth нового продукта. Допустимо переиспользовать проверенные tactical DTO/capture pieces через adapter.

**Откат:** удалить route/modules до появления принятых WOTR saves; архитектурная замена после этого требует migration plan.

## WOTR-D-003 · Godot 2.5D + OpenBFME tactical runtime

**Дата:** 2026-11-20 · **Статус:** принято.

Godot реализует 2.5D hex map, HUD и Campaign Pack editor. OpenBFME Godot Nightly запускает тактические бои и предоставляет retail asset runtime. Переход и возврат выполняются нативным versioned `BattleRequest`/`BattleResult`, а не отдельным процессом с потерей состояния.

## WOTR-D-004 · WEGO, sandbox-first и последовательность сложности

**Дата:** 2026-11-20 · **Статус:** принято.

Базовая модель команд — WEGO. Первый продуктовый профиль — sandbox-first; narrative/hybrid добавляется данными после устойчивого ядра. MVP использует простой AI, создающий обычные команды. Advanced AI и multiplayer отложены до фазы 8.

## WOTR-D-005 · Retail и Campaign Packs

**Дата:** 2026-11-20 · **Статус:** принято.

Первый tactical profile — Vanilla RotWK 2.01. Retail BFME2/RotWK читается напрямую и не копируется в продукт. Campaign Packs обязаны поддерживать retail references, licensed custom assets и deterministic mod-aware overrides. BIG transfer — только байт-в-байт с hash; bulk начинается после canary.

## WOTR-D-006 · Фазы 1–8

**Дата:** 2026-11-20 · **Статус:** принято.

Публичный план состоит из фаз 1–8 в `docs/PHASES.md`; каждая содержит минимум одну миссию. Первая миссия `WOTR-1.1` доказывает map → movement → tactical battle → full result → map/save.

## WOTR-D-007 · OpenBFME baseline

**Дата:** 2026-11-20 · **Статус:** принято.

Первый pin — `Open-BFME/openbfme-godot` tag `v0.4.12-nightly.261118100`, commit `4a8d82727c2664c381b7b1c07344881760c4765b`, GPL-3.0. Upstream обновляется только отдельной карточкой с range/conflict report и полным WOTR gate.

## WOTR-D-008 · ScriptCat provenance and local release

**Дата:** 2026-11-20 · **Статус:** принято.

Последний полный historical tree перед удалением Arena-транспорта — commit `fe8ec9368fc2f5cb9a78a5cdbc47b66e30c07cf6`, parent удаления `eecb68739dbb66a83a6cd9a3d0dbec9650a78ade`. Upstream ScriptCat version — 1.16.1. Точное repository provenance сохранено только в `tools/script-cat/UPSTREAM.md`. WOTR-specific prompt/profile/portability adaptation выпускается как 1.16.2, сохраняя MIT license; regression fixtures не являются product authority.

## WOTR-D-009 · Legacy WOTR boundary

**Дата:** 2026-11-20 · **Статус:** заменено WOTR-D-012.

Механики из `Creative36711/wotr` не импортируются автоматически. Любой перенос начинается с отдельного обсуждения состава, лицензии, compatibility и migration; до решения репозиторий используется только как возможный future reference. Аудит и решение WOTR-D-012 завершили это обсуждение, сохранив запрет runtime dependency и license gate.

## WOTR-D-010 · Upstream Integrator — Executor specialization

**Дата:** 2026-11-20 · **Статус:** принято.

`Upstream Integrator` классифицируется как узкий `Executor`: он реализует конечный pinned sync и сдаёт проверяемый результат, но не содержит постоянно работающий transport. Функция `Maintainer` зарезервирована исключительно за `Transport Maintainer`, который чинит ScriptCat/relay. Upstream Integrator не принимает собственный sync; независимый audit сохраняется.

## WOTR-D-011 · Tiered build и retail cost gates

**Дата:** 2026-11-20 · **Статус:** принято.

Каждая карточка до выдачи объявляет `build: none|focused|full` и `retail: none|reuse|hydrate`. Итерация начинается static/focused проверками. Full engine build обязателен для engine/ABI/upstream/final handoff; retail — только для archive/map/start/tactical round-trip, upstream, release и final mission boundaries. Drive hydration требует явного разрешения, metadata/canary/space checks и reuse verified `.retail`. Нормативная матрица: `docs/agents/cost-gates.md`.

## WOTR-D-012 · Legacy world importer, tactical sides и custom maps

**Дата:** 2026-11-20 · **Статус:** принято · **ADR:** `docs/architecture/ADR-002-LEGACY-WORLD-IMPORT-AND-TACTICAL-CAPACITY.md`.

World/locations/regions/ownership/content из `Creative36711/wotr@fd12e3a3a52ad485f95af3ff559610fd2778570b` переносятся versioned one-way importer со stable IDs, canonical output и provenance/loss report; React/Tauri/Win32/OCR runtime не переносится. Публикация полного dataset и `__wotr_maps.big` ждёт подтверждённой лицензии. Tactical capacity считается по противоборствующим sides, союзники делят start; overflow выбирает первый совместимый declared fallback map либо canonical autoresolve. Новые карты поставляются как лицензированные content-addressed Campaign Pack overlays с starts/profile/hash/provenance.

## WOTR-D-013 · Eight-locale product baseline

**Дата:** 2026-11-20 · **Статус:** принято · **ADR:** `docs/architecture/ADR-003-PRODUCT-LOCALES.md`.

Обязательные product locales: `en`, `ru`, `zh-Hans`, `ja`, `pt-BR`, `de`, `fr`, `ko`. Английский — source/per-message fallback; production support требует 100% coverage, native-language/cultural review, rendering/font/input evidence и locale-invariant canonical hash. Добавляется Executor-specialization `Localization & Cultural QA Engineer`; независимую проверку выполняет UX & Modding Auditor.

## WOTR-D-014 · ScriptCat 1.16.3 process/profile refresh

**Дата:** 2026-11-20 · **Статус:** принято.

Без изменения transport protocol ScriptCat обновляется с 1.16.2 до 1.16.3: embedded regulation 1.1, точная роль Upstream Integrator, declared build/retail Cost gate, eight-locale i18n block и bootstrap profile с обязательным чтением cost policy. Source/version/bundle меняются вместе и проходят полный transport gate.

## WOTR-D-015 · Hybrid Godot UI art pipeline

**Дата:** 2026-11-20 · **Статус:** принято · **Контракт:** `docs/tooling/ART-PIPELINE.md`.

Runtime UI строится из Godot `Control`/`Container`/`Theme`: layout, input, focus, states и локализованный текст не запекаются в картинки. SVG применяется для точной геометрии, иконок и masks; материальные рамки, фактуры, портреты и атмосферный art создаются как raster assets, а растяжимые панели интегрируются через 9-slice. Native alpha предпочтителен; закреплённый `cutout-chromakey` используется как воспроизводимый fallback для строгого `#00FF00`.

Visual card сначала фиксирует style brief, named asset list, consuming scenes, provenance и budget `0–10 images` в пределах текущей Arena quota. Генерация и обработка источников принадлежат Scope Technical Artist, scene structure/integration — Godot World Engineer, независимый открытый render — UX & Modding Auditor. Неиспользованные варианты, generated text, full-screen hitbox images и official/retail artwork не коммитятся.

**Откат:** generated skin и Theme resources можно удалить/заменить без изменения команд, canonical state или save; Godot structural UI остаётся функциональным.

## WOTR-D-016 · Adapted launcher and early player package

**Дата:** 2026-11-20 · **Статус:** принято · **ADR:** `docs/architecture/ADR-004-PLAYER-ENTRY-AND-DISTRIBUTION.md`.

WOTR Remaster адаптирует существующие `launcher/**` и one-archive release tools, но не распространяет pinned upstream launcher binary без изменений и не создаёт второй updater. Пакет содержит WOTR launcher и один native game build, внутри которого strategy и OpenBFME tactical переходят нативно. Product/update/signing identity, user data, settings, logs и saves изолированы от upstream OpenBFME. Поддерживаемый путь: один архив → unpack → WOTR launcher → retail detection/selection → **Play WOTR Remaster**, без checkout, build tools, environment variables или developer CLI; bundled version стартует offline.

`WOTR-1.2` сохраняется как черновик будущей миссии, которая должна доказать fresh-profile package route, но сейчас не имеет рабочих карточек. Принятие `WOTR-1.1` только снимает зависимость и не создаёт B0 автоматически: подготовка `WOTR-1.2` начинается лишь по отдельному будущему решению. После такого решения первой карточкой ассистент создаёт B0-репетицию в `Ready`; остальные карточки режет Coordinator только после `Accepted` B0. Internal playtest не разрешает public release до all-ref retail-history, license/provenance, signing и platform gates.

## WOTR-D-017 · ScriptCat 1.16.4 full WOTR source scrub

**Дата:** 2026-11-20 · **Статус:** принято.

ScriptCat обновляется до 1.16.4 без изменения transport protocol 1.11. Runtime profile, prompts и embedded regulation получают WOTR regulation 1.2. Прежние project/card names, repositories и product-specific labels удаляются не только из operational prompts, но также из source comments, contracts, tests и sanitized structural regression fixtures. Точные upstream repository/tree данные остаются только в `tools/script-cat/UPSTREAM.md` как явно неоперационная provenance-запись.

Portability guard больше не исключает tests/regression/browser/upstream-fixtures: он сканирует всё дерево ScriptCat и текущие operational docs, разрешая прежний repository identifier только в двух byte-for-byte закреплённых provenance-строках `UPSTREAM.md`. Regression semantics сохраняются под нейтральными `CASE-*`/fixture identifiers. Source/version/generated bundle меняются вместе; полный `npm run verify:scriptcat` и release evidence обязательны.

## WOTR-D-018 · Разбор остановки различает отказ выдачи и петлю перевыдач

**Дата:** 2026-11-21 · **Статус:** принято.

Вид паузы `redispatch` общий у двух причин, а адресат был один. Петлю перевыдач разматывают приёмка и арбитр (D-053): там карточку действительно переоформили, и решение — в постановке. Отказ предполётной проверки выдачи чинит транспорт: 2026-11-21 WOTR-1.1 B0 трижды вернулась Координатору с «карточка изменилась перед выдачей (пути Scope не входят в зону ни одной активной роли: §9.1–§9.13, §10..§13)», хотя между чтениями карточку не трогали. `dispatchTask` проверяет её дважды: первый осмотр получает «Зону записи» адресата и потому пропускает прозаическую зону (D-092), перечтение перед созданием журнала вызывало `taskPreflight` без третьего аргумента и пропуск терял силу. Транспортный дефект уезжал в «Обратную связь» с советом поправить постановку, а совет петлю не размыкал: следующий план получал тот же отказ.

ScriptCat 1.16.5 правит обе половины. Перечтение вызывается с той же зоной, что и первый осмотр, и отказывается от неё отдельно названной причиной (`повторная предполётная проверка: …`); по этому слову `classifyPause` поднимает класс `transport` и маршрут Maintainer'у, не трогая отказ первого осмотра (`предварительная проверка: …`) — он остаётся дефектом постановки и решением приёмки. Признак передаётся машиной в `heal.defect`, поэтому попадает в ключ инцидента и в бриф разбора, а пределы `C.healMaintainerMax` со стопом Мастеру сохраняются: разбор не может стать новым кругом. Transport protocol 1.11, маркеры, профили и бюджеты не меняются; `@version` и `SCRIPT_VERSION` подняты синхронно (D-027), `docs/regulation-digest.md` и оракулы `§8`/`§9` ТЗ не тронуты. Пробы закрепляют оба адреса (`heal-core-smoke`) и симметрию вызовов гейта в собранном бандле (`relay-mission-match-smoke`); проба на shipped-коде воспроизводит ложный отказ и показывает, что после правки два чтения согласны.

**Откат:** адресат возврата (`warden` для `redispatch`) остаётся прежним поведением, если удалить пробу `healDispatchDefectMatch`; правку симметрии `taskPreflight` откатывать не нужно — она возвращает перечтению смысл первого осмотра.

## WOTR-D-019 · Осиротевшая строка «Обратной связи» возвращается в очередь, адресат не теряется

**Дата:** 2026-11-21 · **Статус:** принято.

Цикл шёл, а вопрос висел. 11.21 в WOTR-1.1 строка «остановка без автоматического пути» (`41f6f0cf-5705-8139-b90b-c69c24308819`) оставалась в «Ждёт» с пустым «Ответом», пока восемь Ready-карточек раздавались одна за другой: разбор очереди ответов (`src/27-review-answers.js`) крутился, до приёмки ход не доходил, и журнал о строке не помнил ничего. Это не «асинхронно, ответ придёт потом»: передача адресату — обязательная работа транспорта, а не ожидание следующего промпта.

Причин четыре, и все они собственные для транспорта. `handWaitingRow` ставил отметку `cfn-q-handoff:<id>` до подтверждения доставки, а `refreshQuestions` исключал строку этой отметкой пожизненно; очередь ответа при этом чище `dropAnswer`, а слот ожидания снимает уборка фантомов — строка оставалась без ходячего следа и без повтора. `need` («нужен ответ «X»») обнулялся для вопроса без `gate` в `queueAnswer` и терялся при чтении строки из базы, поэтому вопрос, подписанный Transport Maintainer'у, уходил Reviewer'у или никому. `startAnswer` возвращал `false` на неготовом адресате и у обычного вопроса, а голова очереди одна (`answerPending()`), так что за такой строкой не двигалась ни одна другая. И молчание: долгое ожидание свободного слота в журнале не называлось никак.

ScriptCat 1.16.6 закрывает все четыре. «Передано» проверяется по живому следу из четырёх записей (`answerHandoffLive`: очередь приёмки, ход ответа или возврата в `cfn-expect`, неотправленное задание в `cfn-pending`, квитанция возврата), а не по одной отметке; отметка старше окна `C.questionCheckMs` и следа нет — строка передаётся заново. Повторы считает `cfn-q-rehandoff:<id>`, после `C.answerRehandoffMax` это уже не «очередь подождёт», а потерянная доставка: пауза вида `answer-orphan`, которую таблица классов (`src/40-heal-core.js`) ведёт транспорту и Transport Maintainer'у, цикл на ней не стоит. Адресат читается из строки и из очереди независимо от `gate` — `gate` решает, держать ли ход, а не кому отвечать; строгость D-083 сохранена там, где она и была: маркерный вопрос роли без `gate` по-прежнему не имеет адресата (`parseQuestion` не тронут) и в строку Notion адресат без `gate` не пишется. Неготовый адресат держит ход только у `gate`-вопроса; обычный уходит приёмке, и подмена названа в журнале (`answer-need-fallback`), а голова очереди не запирается. Ожидание свободного слота дольше окна называется (`answer-starved`) с указанием роли и вида занятого хода. Счётчик повторных передач обнуляется при закрытии строки ответом, чтобы следующий инцидент начинался с нуля.

Transport protocol 1.11, маркеры, профили, бюджеты и `docs/regulation-digest.md` не менялись; `@version` и `SCRIPT_VERSION` подняты синхронно (D-027). Порядок тика `src/28-cycle.js` сохранён намеренно: очередь ответа не обгоняет живую выдачу, потому что слот ожидания один на все роли, — выправлено только молчание вокруг этого правила. Проба `tools/script-cat/tests/relay-answer-orphan-smoke.mjs` красная на 1.16.5 и зелёная на 1.16.6: таблица решений проверена на живом коде бандла, ветки `handoffNeedsRequeue` прогнаны на шести состояниях хранилища, а ожидания `relay-direct-answer-smoke`, `relay-adr-handoff-smoke` и `docs-smoke` переведены на новое правило адресата.

**Откат:** удаление строки `handoffNeedsRequeue(row.id)` в фильтре `adopted` вместе с видом `answer-orphan` возвращает прежнее пожизненное исключение; `need` в `queueAnswer` и `questionFromRow` и `answer-need-fallback` в `startAnswer` независимы от неё и могут быть откатаны по отдельности — вместе с пробой, которая их закрепляет.

## WOTR-D-020 · Расширение зоны карточки легализует запись в реестре; незакоммиченная работа не submitted

**Дата:** 2026-11-21 · **Статус:** принято.

Повод: карточка WOTR-1.1 · K3 (Tactical bridge) сдана с правками вне своей зоны. Отчёт заявляет registration wiring в `engine/CMakeLists.txt` и `engine/cmake/Wotr1.cmake` «по разрешению владельца», тогда как поле «Scope» карточки и таблица зон ТЗ §9 дают этой роли только `engine/src/GameLogic/WotrRemaster/Bridge/**` и `engine/tests/WotrRemaster/Bridge/**`. Расхождение видно на PR-ревью, поэтому его обязан закрывать реестр до ревью, а не ревьюер поверх него.

Правило в четыре части. (1) Расширить зону карточки может только владелец — ответом в карточке, и только до внесения правки; разрешение постфактум зону не легализует. (2) Легализация = новое значение поля «Scope» в реестре + запись в журнале решений; оракул `§8` и текст инвариантов не переписываются никогда (WOTR-D-001: зоны, карточки, независимый аудит), а инвариант «writes only inside Кому zone» читается относительно Scope после правки. (3) Работа без commit+push не является `Submitted`: состояние ставится только вместе с веткой на origin, иначе приёмка меряет то, что нельзя пересобрать. (4) Ни кэш сборки, ни восстановленные артефакты (`engine/build`, `godot/bin`, `.retail`) доказательством приёмки не считаются: доказательство — команды, rc, вывод и SHA на финальном SHA (cost-gates §7).

Почему K3 не забракована, а принята условно: правка вне зоны была необходима (glob'ов в системе сборки нет, `engine/CMakeLists.txt:741 add_executable(openbfme_tests …)` перечисляет тестовые файлы явно — новый каталог тестов регистрируется только правкой вне `Bridge/**`), разрешение запрошено до внесения и записано в лог ран, класс стоимости не изменён (карточка выдана с `build: full`, `retail: hydrate`, cost-gates §1 не нарушен), оракул не тронут. Брак означал бы выбросить 2 ч 46 м верифицируемой работы ради процедуры, а молчаливая легализация оставила бы расхождение живым. Детали разбора и условия принятия — `docs/evidence/WOTR-1-1/K3-review.md`.

Попутно решение закрепляет три факта, без которых оно вырождается в разрешение «на слово»: `WotrRemaster` не упоминается ни в одном CMake-файле `main`, поэтому тесты K2 не собираются ни одной целью и инвариант «existing focused OpenBFME tactical/WOTR tests remain green» машиной не проверялся ни у K2, ни у K3; `engine/cmake/Bridge1.cmake` — лейн BRIDGE-1 про розничные мосты (`WALK_ON_TOP_OF_WALL`) из vendored-импорта `e0cd899`, к тактическому мосту отношения не имеет и имя занято; список файлов своего лейна держать в отдельном `engine/cmake/<lane>.cmake`, потому что `tools/arena/sync_upstream.sh` делает three-way merge `old/ours/new` — новый downstream-only include синхронизацию переживает, а правка vendored-файла становится конфликтом на каждом импорте.

**Откат:** удаление этой строки возвращает прежнее чтение (зона карточки = Scope на момент выдачи, споры решаются на ревью); правка поля «Scope» у K3 отмене не подлежит, её внёс владелец через реестр, и она остаётся валидной независимо от судьбы этого правила. Часть (3) откатывается независимо: если снять требование «ветка на origin», карточка снова может быть `Submitted` с незакоммиченным деревом — вместе с риском потерять всю работу при возврате общего клона к HEAD, что и случилось с черновиком другой роли 11.21.

## WOTR-D-021 · Предупреждение о лимите инструментов не останавливает цикл

**Дата:** 2026-11-21 · **Статус:** принято.

Arena отвечает «the agent reached the tool-call limit for this turn — send a message to continue where it left off.» Это граница хода, а не отказ: транспорт продолжал тот же ход корректно (IDs, карточка, PR и терминальные поля прежние), но `30-tool-limit` сверял число продолжений с `C.toolLimitContinueMax` = 2 и на третьем лимите ставил паузу `tool_limit_paused` с вызовом Мастера. Практический смысл этой паузы — выбросить уже сделанную половину работы: ход прерывался не из-за поломки, а из-за счётчика, заведённого как защита от петли.

Выпуск 1.16.7 убирает счётчик-предел из обеих веток (рабочий ход и пилотный). Останавливать ход продолжают только настоящие отказы: отсутствие прогресса (`tool_limit_no_progress` — после продолжения нет ни одного нового содержательного сообщения, только повторный лимит: продолжать бессмысленно), несобранный или недоставленный continuation и живая карточка Reviewer, для которой шаблон продолжения не определён (там по-прежнему Мастер, карточка и IDs не меняются). Темп задаёт агент, а не цикл: продолжение возможно только при новом статусном сообщении (`lastToolLimitMessageId`), при незакрытом маркером ходе, когда страница не занята (`busySettled()`); `toolLimitContinuations` остаётся в журнале и в логе как число попыток, чтобы разбор видел цену хода.

**Откат:** вернуть `toolLimitContinueMax: 2` в `src/01-config.js` и блок `if (done >= C.toolLimitContinueMax) { journalToolLimit(...); pause(...); return true; }` перед проверкой прогресса в `continueToolLimitTurn`, а в `continuePilotToolLimit` — строку `if (done >= C.toolLimitContinueMax) return stop(...)`; проба `tool-limit-continuation-integration.mjs` красная без них и зелёная с ними, потому что третий лимит снова даёт паузу. Правки `docs/agents/troubleshooting.md` и `docs/scriptcat-update.md` откатываются вместе с кодом; остальные смыслы (дедупликация, watermark, карточка не откатывается в Ready) не затронуты.

## WOTR-D-022 · Зоны сборки и evidence: `tools/arena/**`, `engine/cmake/<lane>.cmake` и отчёт карточки в репозитории

**Дата:** 2026-11-21 · **Статус:** принято.

Разбор K3 (WOTR-D-020) упёрся не в дисциплину исполнителя, а в дыру таблицы зон ТЗ §9: `engine/CMakeLists.txt`, `engine/cmake/*.cmake` и `tools/arena/**` не имели строки владельца ни для одной роли, а `docs/evidence/WOTR-1-1/**` был отдан только аудитам A1–A3. Путь «Report SHA» `reports/…`, которым отчитался K3, в репозитории не существует вовсе: `git ls-files reports` возвращает 0 файлов, а `reports/` не упомянут ни в `docs/REGULATION.md`, ни в одном файле `docs/missions/*.md` (по 0 совпадений), то есть отчёт оказался текстом в рабочем дереве сандбокса. Формально это значит, что регистрация нового каталога тестов, правка окружения Arena и репозиторный якорь отчёта карточки были невозможны легально — при том что без них карточка непроверяема. Регламент предписывает исправлять такую строку решению приёмки, а не исполнителю; оно записано здесь.

Три новых правила таблицы. (1) `tools/arena/**` целиком принадлежит Upstream Integrator (K1) — вместе с `sync_upstream.sh`, `bootstrap.sh`, `build_engine.sh`, `smoke_godot.sh`: это одна семья скриптов воспроизведения среды сборки, и правка `--tests`/`--clean` в них меняет ровно тот гейт, по которому принимают все карточки, поэтому держать её надо у роли, уже отвечающей за границу upstream. (2) Регистрация файлов лейна живёт в `engine/cmake/<lane>.cmake` этого лейна, а `engine/CMakeLists.txt` любой роли доступен ровно в объёме одной строки `include(cmake/<lane>.cmake)`: vendored-файлы (`engine/cmake/Wotr1.cmake`, `engine/cmake/Bridge1.cmake` и подобные) приходят из импорта `e0cd899`, `tools/arena/sync_upstream.sh` делает three-way merge `old/ours/new`, и правка vendored-списка превращается в конфликт на каждом импорте. (3) Отчёт карточки коммитится в `docs/evidence/WOTR-1-1/<карточка>/**` исполнителем этой карточки (K1–K5 добавлены в их строки зон), и то же поле «Report SHA» в реестре обязано называть этот путь: артефакт, живущий только в дереве сандбокса или только в Drive, доказательством приёмки не считается (cost-gates §7).

Тем же решением в тот же ход обновлены поля «Зона записи» в реестре ролей (`docs/REGULATION.md` таблицу зон не дублирует): Upstream Integrator, Tactical Bridge Engineer, Strategic Core Engineer, Godot World Engineer и Localization & Cultural QA Engineer получили строки своей карточки вместе с `docs/evidence/WOTR-1-1/<карточка>/**`. Без этого транспорт (`preflight.mjs`, zone-проверка) продолжил бы отклонять пути, легальные после этой правки, — ровно как он отклонял правку K3 до WOTR-D-020. Строки аудитов A1–A3 не менялись.

**Откат:** три пункта независимы. (1) откатывается возвратом узора `tools/arena/sync_upstream.sh` вместо `tools/arena/**`; (2) — удалением абзаца про `include()`-строку, что вернёт конфликты vendored-списков при синхронизации; (3) — возвратом `docs/evidence/WOTR-1-1/**` только аудиторским строкам, после чего отчёты карточек снова не имеют репозиторного якоря и приёмка меряет лог рана.

## WOTR-D-023 · Транспорт обязан объяснять свой простой: удержание вопроса ограничено, очередь не зависит от миссии и допуска вкладки

**Дата:** 2026-11-22 · **Статус:** принято.

Мастер вёл цикл вручную («Шаг») и получил зависшую строку в базе «Обратная связь»: «остановка без автоматического пути» (`41f6f0cf-5705-8139-b90b-c69c24308819`) стояла «Ждёт» с пустым «Ответом», `cfn-answer-queue` была пуста, панель продолжала показывать счётчик, а журнал — молчать. Разбор по коду бандла 1.16.7 (`tools/script-cat/src/`) дал не одну, а три независимые причины, и каждая из них глушила передачу сама по себе. (1) `24-feedback.appendQuestionBody` держал строку в `cfn-question-bodies` бессрочно: пока тело не записано, строка намеренно не уходит приёмке (иначе адресат читает обрезанный заголовок вместо полного материала), но у ожидания не было ни срока, ни предела попыток, а `sameText`-сравнения не существовало — `Notion 503`, обрезанный ответ или ручная правка абзаца в теле навечно исключали строку и из `adopted`, и из `due`. (2) `flushQuestionBodies` не ловил исключение внутри петли: одна битая строка обрывала весь проход, и очередь остальных вопросов в этом цикле не обрабатывалась. (3) вся ветка передачи лежала внутри `if (active)` — активной миссии, полученной через `12-notion.activeMission()`, которая бросает при двух активных миссиях и при сбое Notion; миссия нужна, чтобы отфильтровать чужие строки и закрыть просроченные, а не как условие самой доставки. Отдельно: `29-boot` глушил `refreshQuestions`/`refreshDecisions` при `!projectApproved() || projectHeld()`, а `watchQuestions`/`watchDecisions` снимались по тому же флагу, и ни там, ни там ничего не писалось в журнал; панель отвечала на «Шаг» одной строкой «Проект ещё не разрешён к работе» и при повреждённом профиле, и при удержании вкладки, тогда как настоящая причина (снятый при любой смене доступов допуск — `07-connections-ui.js`, ветка `saveButton.onclick`) требовала другой кнопки.

Решение в четыре части. (1) Удержание незаписанного тела ограничено: `C.questionBodyHoldMs` (не короче `questionCheckMs`) и `C.questionBodyMaxTries`; `questionBodyEntry` переносит `at`/`tries` между попытками (дополнение вопроса не обнуляет срок), сравнение записанного текста нормализует переводы строк, а после края строка отпускается приёмке по тому, что лежит в базе, и отпускание пишется в журнал ошибкой, а не `dbg`. (2) Каждая строка в проходе изолирована: исключение одной не прерывает обход остальных. (3) Активная миссия читается в `try/catch`; при её отсутствии или сбое приёмка получает все открытые строки без фильтра по миссии, а `closeExpired` остаётся под условием (закрывать без миссии нечем) — долг транспорта не может быть условным, и объяснение «ответ придёт следующим промптом» после этого запрещено: передавать обязан скрипт. (4) Сторожа вопросов и ADR больше не снимаются допуском вкладки, `armFeedbackWatch()` вызывается из `tick()`, а приглушённый фоновый проход пишет `feedback-pipeline-held` с конкретной причиной; `projectBlockReason()`/`projectBlockedText()` — единый источник формулировки для «Шага», «Продолжить» и журнала, и он различает повреждённый профиль, вкладку без выбранного проекта и снятый допуск (в том числе прямо называет правку «Подключений» как причину).

Проба `tools/script-cat/tests/relay-feedback-delivery-smoke.mjs` собрана на живом коде бандла (`new Function` из блоков `24-feedback`/`27-review-answers`), а не на поиске подстрок, и красная на 1.16.7 по поведению (проверено подменой `relay.user.js`: «сбой чтения миссии не снимает передачу с очереди»); интеграционная `relay-feedback-integration.mjs` дополнена сценарием «свежее удержание держит → просроченное отпускает» и стоит в конце файла, потому что у мока одноразовые флаги и сквозная дедупликация по префиксу. `verify:scriptcat` на 1.16.8: 179/179 smoke, 22/22 regression, 2/2 tool-limit, `build.mjs --check` и portability-guard зелёные.

**Откат:** вернуть бессрочное удержание можно только вместе с обещанием, что очередь разбирается человеком, — этого обещания в регламенте нет. Технически: удалить `questionBodyHoldMs`/`questionBodyMaxTries` из `src/01-config.js`, вернуть в `24-feedback` `questionBodyPending = (id) => questionBodies().some(...)` без возраста, обёртку `if (active) {` вокруг `adopted`/`due` и `try`-обход без изоляции строк, в `25-legacy-adr`/`24-feedback` — ранние `return` по `projectApproved()`, в `02-profiles-core` — удаление `projectBlockReason`/`projectBlockedText` с возвратом единой строки в `06-pause-panel` и `28-cycle`. Тогда краснеют обе пробы (`relay-feedback-delivery-smoke` по всем четырём поведенческим секциям, `relay-feedback-integration` — на просроченном удержании), что и есть их назначение.
