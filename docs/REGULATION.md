# Регламент команды War Of The Ring: Remaster

Версия 1.3 · 2026-11-22 · владелец: Мастер · хранитель: Warden.

Это полный источник процессных правил. Notion-копия: [«Регламент команды WOTR Remaster»](https://app.notion.com/p/WOTR-Remaster-41e6f0cf57058178ac91c320891b1d7b). Краткий вход для каждого хода лежит в `docs/regulation-digest.md` и вшивается в ScriptCat
(`Creative36711/relay-wotr`: этот же файл копируется туда, сборка читает свою копию, — правка
регламента обязывает синхронизировать `docs/regulation-digest.md` и `docs/REGULATION.md` в
репозитории транспорта и пересобрать бандл). Номер краткой и полной копий обязан совпадать; краткая копия не может разрешать запрещённое полной.

## 1. Продукт и границы

**War Of The Ring: Remaster** — отдельная стратегическая игра с нативным переходом в тактические бои OpenBFME.

| Слой | Ответственность | Основная зона |
|---|---|---|
| `WotrRemaster` core | детерминированное состояние кампании, WEGO-команды, правила, хеш, save/load | `engine/src/GameLogic/WotrRemaster/**` |
| Tactical adapter | `BattleRequest` → OpenBFME battle → полный `BattleResult` | WOTR adapter и узкие точки OpenBFME, заданные карточкой |
| Godot world | 2.5D hex map, камера, ввод, HUD, визуализация состояния | `godot/wotr_remaster/world/**` |
| Campaign editor | Campaign Pack, схемы, миграции, validation, undo/redo | `godot/wotr_remaster/editor/**`, campaign schemas |
| OpenBFME tactical runtime | бой по правилам RotWK/BFME2, retail loader, Godot presentation | синхронизируемый код OpenBFME |
| Player launcher/package | WOTR identity, retail discovery, signed update, one-archive start | адаптируемые `launcher/**`, `tools/release/**` |
| Retail data | BFME2 1.06 и RotWK 2.01 пользователя | read-only вне Git-изменений продукта |
| Agent transport | вся техническая часть ScriptCat: исходники и сборка бандла, Drive-gateway, механика профиля, тесты, CI и релизная обвязка, зеркало операционных документов | `Creative36711/relay-wotr`: всё дерево репозитория (в этом репозитории копий транспорта нет) |
| Процесс | фазы, миссии, решения, evidence, регламент, роли и зоны, CI и гейты этого репозитория | `docs/**`, `.github/**`, `tools/precommit.py`, `tools/release/pr_audit.py`, `tools/release/pr_pytest.py`, `tools/release/public_workflows.py` и тесты этих файлов; остальной `tools/release/**` — карточка его владельцу |

Продукт и его процесс живут в одном репозитории `Creative36711/open-bfme`. Отдельный orchestration-репозиторий не создаётся;
`Creative36711/relay-wotr` — не второй orchestration-слой, а технический дом единственного транспорта (ScriptCat), и операционные
решения он не хранит. Границы обеспечиваются Scope, зонами ролей, гейтами и независимым аудитом, а не скрытием частей дерева.

## 2. Архитектурные инварианты

1. **Отдельное ядро.** Новый стратегический runtime называется `WotrRemaster`; retail-faithful `LivingWorldLogic` не становится скрытым стратегическим ядром Remaster. Его tactical contracts и проверенные bridge-компоненты можно использовать через явный adapter.
2. **Детерминизм.** Один seed + один Campaign Pack + один упорядоченный поток команд дают одинаковые canonical bytes и state hash на всех поддерживаемых платформах.
3. **Чистая симуляция.** В стратегических правилах запрещены wall clock, Godot nodes, UI state, locale, filesystem iteration order, unordered traversal и неназванный RNG.
4. **WEGO.** Игроки планируют команды, затем система валидирует и применяет их в детерминированном порядке. Последовательный режим допускается как UI над тем же command pipeline.
5. **Нативный battle round-trip.** Тактический бой запускается типизированным `BattleRequest`; возвращается полный `BattleResult`, включая победителя, выживших, опыт/ранг, героев, persistent upgrades/sciences, подкрепления, разрушенные стратегические постройки и метаданные результата.
6. **Godot — presentation/editor.** Стратегические правила не реализуются в GDScript ради удобства UI; Godot вызывает ядро через стабильную границу.
7. **Retail read-only.** OpenBFME читает оригинальные установки напрямую. Retail BIG передаётся и проверяется байт-в-байт; распакованная папка не подменяет архив.
8. **Campaign Packs.** Vanilla RotWK 2.01 — первый профиль. Формат обязан поддерживать retail references, custom assets с provenance и mod-aware overrides без копирования нелицензированных retail assets.
9. **Sandbox-first.** Сначала — системная песочница и editor; narrative/hybrid расширяется позднее через данные и события, а не через ветвление ядра.
10. **Поздние системы.** Глубокий AI и multiplayer — фаза 8. MVP использует простой AI, который отдаёт обычные команды и не обходит правила.
11. **Legacy import, не runtime.** Мир и контент `Creative36711/wotr` переносятся versioned one-way importer со stable IDs и provenance report. React/Tauri/Win32/OCR и внешний retail process не становятся runtime-зависимостью. Публикация полного dataset и `__wotr_maps.big` запрещена до подтверждения лицензии.
12. **Tactical capacity.** Вместимость считается по противоборствующим tactical sides: союзные армии делят start. Если сторон больше, чем проверенных starts, выбирается первый совместимый declared fallback map, иначе выполняется deterministic autoresolve; участника нельзя молча отбросить.
13. **Custom maps.** Карты, которых нет в RotWK 2.01, поставляются как лицензированные content-addressed Campaign Pack overlays с metadata/starts/profile, SHA-256 и provenance, а не как private loose path.
14. **Локали.** Обязательный product baseline: `en`, `ru`, `zh-Hans`, `ja`, `pt-BR`, `de`, `fr`, `ko`. Locale и display strings не меняют simulation/save/network hash.
15. **Минимально достаточная стоимость.** Карточка заранее объявляет build/retail Cost gate. Полная сборка движка и Drive hydration запускаются только по матрице `docs/agents/cost-gates.md`; успешный mock/focused test не отменяет обязательный полный или retail gate.
16. **Обычный player entry.** Существующий launcher/one-archive pipeline адаптируется под WOTR; upstream binary без изменений и второй updater запрещены. Один архив → WOTR launcher → retail detection/selection → **Play WOTR Remaster**. Стратегия и tactical остаются одним game process; WOTR update data/settings/saves изолированы от upstream OpenBFME. Offline bundled start обязателен, а platform support заявляется только после fresh-profile oracle.

Подробная схема: `docs/ARCHITECTURE.md` и принятые ADR в `docs/architecture/`.

## 3. Роли

Строка в базе «Роли» — источник имени, функции, зоны и гейта. Роль без строки не существует; рабочая выдача возможна только активной роли с валидным Agent URL.

| Роль | Функция | Ответственность |
|---|---|---|
| **Мастер** | Owner | направление, доступы, лицензии, платные действия, окончательные продуктовые решения |
| **Warden** | Reviewer | вся операционная часть проекта: ТЗ миссий, версия оракула, роли/зоны/регламент, процесс и CI этого репозитория, финальная приёмка `accept/rework/master`, арбитраж |
| **Coordinator** | Coordinator | карточки и зависимости, `Draft → Ready`, маршрутизация, итог; код и финальную приёмку не делает |
| **Strategic Core Engineer** | Executor | deterministic core, commands, canonical serialization, save/hash |
| **Tactical Bridge Engineer** | Executor | native battle DTO and OpenBFME round-trip |
| **Godot World Engineer** | Executor | 2.5D world, camera, interaction, HUD |
| **Campaign Editor Engineer** | Executor | Campaign Pack editor, schema, migrations, validators |
| **Technical Artist** | Executor | custom assets, strategic presentation, provenance and budgets |
| **AI & Simulation Engineer** | Executor | simple command-producing AI, autoresolve/simulation within mission scope |
| **Localization & Cultural QA Engineer** | Executor | required locale catalogs/runtime, fonts/input, cultural review and locale-invariance evidence |
| **Upstream Integrator** | Executor | specialized pinned OpenBFME synchronization, conflict report and upstream regression gate |
| **Transport Maintainer** | Maintainer | единственная Maintainer-функция: любая техническая часть ScriptCat и relay transport в `Creative36711/relay-wotr` — починка, развитие, сборка, тесты, CI и выпуск |
| **Integration Auditor** | Auditor | clean-checkout and Arena end-to-end evidence |
| **Determinism & Save Auditor** | Auditor | dual-run hashes, save/load/replay, migration failures, RNG audit |
| **UX & Modding Auditor** | Auditor | map/editor UX, accessibility, Campaign Pack and mod compatibility |

Исполнитель не принимает свою работу. Аудитор не чинит найденный дефект в том же ходе. Warden не подменяет исполнителя или Coordinator.

Разделение операционной и технической частей полное и симметричное: Warden отвечает за любую операционную часть
(роли, зоны, регламент, миссии, карточки, приёмка, процесс и CI этого репозитория) и не выполняет техническую работу
транспорта — не правит `relay.user.js`, не пересобирает бандл, не меняет версию транспорта. Transport Maintainer
отвечает за любую техническую часть ScriptCat в `Creative36711/relay-wotr` и не решает операционных вопросов.
Полномочия роли задаёт строка «Роли»: «Зона записи» обязана покрывать все пути, которые роль обязана менять.
Зона, не покрывающая обязательный путь роли, — дефект реестра: он заводится отдельной карточкой Warden и
исправляется строкой, а не молчаливым сужением прав и не обходом гейта.

## 4. Зоны, Scope и оракул

| Область | Правило |
|---|---|
| Зона роли | постоянная граница записи |
| Scope карточки | временно сужает или явно расширяет запись внутри миссии |
| Чужая зона | только чтение; изменение выдаётся владельцу отдельной карточкой |
| Оракул | только аддитивное усиление; ослабление, skip/todo или подгонка ожиданий запрещены |
| Retail data | только чтение и проверка, если карточка явно не про byte-exact transfer |
| Cost gate | до выдачи фиксирует `build: none/focused/full` и `retail: none/reuse/hydrate`; агент не повышает стоимость молча |
| Transport | отдельная карточка Transport Maintainer и отдельный выпуск |
| Обязательный путь вне зоны | правится зоной в «Ролях» (карточка Warden), а не исключением в preflight или ручным обходом |

Перед первой правкой агент фиксирует `BASE_SHA`, ветку и `git status --short`. Чужие локальные изменения нельзя сбрасывать, чистить, прятать или включать в свой коммит. Политика дешёвых/focused и дорогих build/retail проверок: `docs/agents/cost-gates.md`.

## 5. Фазы и миссии

План начинается с **фазы 1** и содержит фазы 1–8: `docs/PHASES.md`. Каждая фаза имеет минимум одну миссию. Активная разработка ограничена `WOTR-1.1`: карта → движение → OpenBFME tactical battle → полный результат → карта/save. `WOTR-1.2` остаётся черновиком без карточек. Принятие `WOTR-1.1` лишь снимает зависимость и само по себе не запускает подготовку `WOTR-1.2`: для неё требуется отдельное будущее решение.

После отдельного решения начать подготовку миссии первой карточкой создаётся read-only **B0 · репетиция оракула**. Ассистент создаёт её и ставит в `Ready`; остальные карточки создаёт только Coordinator после `Accepted` B0. B0 не реализует продукт, не запускает full build/retail hydration и перечисляет исполнимые команды/действия, prerequisites, negative cases и evidence для каждого пункта финального оракула.

Миссия существует только при наличии:

- версии ТЗ и строки в Notion «Миссии»;
- исполнимого оракула и явного Scope;
- назначенного независимого аудита;
- опубликованной редакции документов;
- полного состава требуемых ролей.

Параллельные карточки допустимы только с независимыми зонами и явными зависимостями. Зелёная карточка не закрывает миссию: финальный оракул повторяется на собранном SHA.

## 6. Цикл ScriptCat (транспорт в `relay-wotr`)

1. Warden публикует ТЗ и создаёт строку миссии как `Черновик`.
2. Coordinator проверяет зависимости, роли, зоны и оракул; переводит карточки `Draft → Ready`.
3. ScriptCat выдаёт ход, создаёт `dispatch_id`/`run_id`, ведёт append-only лог и меняет только транспортные поля.
   Код, сборка и гейты транспорта — в `Creative36711/relay-wotr`; карточка на транспорт заводится отсюда, но её
   `Repository` обязан указывать на `relay-wotr`.
4. Исполнитель сдаёт факты и завершает ответ точным маркером `CF_AGENT_RESULT`.
5. Coordinator принимает карточку как `Accepted` либо возвращает `Rework` с конкретной причиной.
6. Независимые аудиторы воспроизводят критерии на проверяемом SHA.
7. После полного результата Coordinator передаёт миссию Warden.
8. Warden повторяет финальный оракул и выносит `accept`, `rework` или `master`.

`master` допустим только там, где агент физически не может действовать: доступ/аккаунт, лицензия/ToS, платное действие, секрет, создание/активация агента или решение уровня продукта.

Шов разделения (кто что делает на границе): Warden публикует ТЗ, критерии приёмки и решение; Transport Maintainer
реализует, собирает бандл, синхронизирует зеркало `docs/REGULATION.md` и `docs/regulation-digest.md` в
`relay-wotr`, поднимает версию при изменении transport source и прогоняет полный гейт там же; Мастер (владелец)
выдаёт доступы к репозиторию транспорта, устанавливает userscript в браузер и включает цикл. Ни одна из сторон не
делает работу другой «чтобы разойтись»: отсутствие доступа оформляется `master`, а не самовольной правкой чужого
дерева. Установленная версия userscript остаётся прежней до принятия нового выпуска.

## 7. Git и upstream

- Рабочая ветка — только выданная Arena; direct push в `main` запрещён.
- Один PR — одна карточка. Гейт перед push запускается в том репозитории, которому принадлежат пути: в этом —
  `python3 tools/precommit.py` и `python3 tools/release/pr_audit.py --tree HEAD^{tree} --base origin/main`; в
  `Creative36711/relay-wotr` — `node tools/script-cat/preflight.mjs --zone "<зона>"` плюс `npm run verify:scriptcat`.
  Ни один репозиторий не копирует гейт другого: `preflight.mjs` в этом дереве отсутствует, и это не повод пропускать гейт.
- Merge делает исполнитель после принятой карточки; Reviewer проверяет факт merge по GitHub. `merged:true` без merge commit запрещён.
- Источник OpenBFME фиксируется в `OPENBFME_UPSTREAM`. Обновление — отдельная карточка Upstream Integrator.
- Sync обязан показать старый pin, новый pin, upstream range, конфликтные WOTR-owned paths и результаты build/smoke/round-trip. Молчаливое копирование `main` запрещено.
- Базовый tactical profile: `v0.4.12-nightly.261118100`, commit `4a8d82727c2664c381b7b1c07344881760c4765b`, пока отдельная принятая карточка не изменит pin.
- Retail paths/objects запрещены не только в tip, но и во всех публикуемых refs. Проверка дерева коммита не доказывает чистоту history; перед release и после rewrite выполняется reachability audit всех heads/tags. Переписывание истории — отдельная destructive Master-approved операция из полного mirror clone с backup refs и coordinated force-push, не обычная карточка продукта.

## 8. Доказательства и гейты

Обязательный минимум карточки:

- `BASE_SHA` и проверяемый `HEAD_SHA`/merge SHA;
- точные команды, коды возврата и существенный вывод;
- список изменённых файлов;
- путь к артефакту и его hash, если критерий создаёт артефакт;
- заявленный и фактически выполненный Cost gate (`build`, `retail`) и честный список `not run` с причиной.

`not run`, тайм-аут, непроверенный отчёт, зелёный нерелевантный CI и mock вместо требуемого retail-пути не равны pass. Агент начинает с static/focused проверки; full engine build и retail hydration обязательны только для перечисленных в `docs/agents/cost-gates.md` границ или когда их прямо требует карточка. Это снижает стоимость, но не разрешает пропустить финальный гейт.

| Изменение | Минимальный гейт |
|---|---|
| Strategic core | unit tests + два одинаковых прогона + canonical save/hash + negative validation |
| Tactical bridge | synthetic DTO round-trip + retail map battle + native full result + strategic apply |
| Godot world/editor | headless smoke + deterministic interaction + открытый screenshot/video + frame/memory facts |
| Save/schema | round-trip + corruption/migration failures + unknown-version refusal |
| AI/simulation | fixed seed, normal commands only, no hidden mutation, repeatable scenario |
| Localization | catalog/coverage/generated checks + locale-invariant hash + target screenshots/font/input smoke; independent UX audit |
| Legacy importer/maps | byte-stable import + stable-ID/provenance report + invalid-reference/capacity/fallback tests + license gate |
| OpenBFME pin | C++/GDExtension build + focused upstream tests + WOTR regressions + retail smoke |
| Launcher/package | one audited archive + fresh-profile unpack/start + retail selection + offline/update/tamper/coexistence/direct-start negatives |
| ScriptCat (repo `relay-wotr`) | build check + full-tree former-project guard + smoke + regression + tool-limit suites |

Финальный gate `WOTR-1.1` выполняется в Arena с доступными retail BFME2/RotWK: strategic map → order → real OpenBFME battle → native result → same campaign state → save/load → equal canonical hash. Зависимый gate `WOTR-1.2` выполняется на каждой заявленной платформе из fresh profile: one archive → WOTR launcher → retail selection → Play → тот же native round-trip/save, плюс offline, signature/tamper и OpenBFME-coexistence negatives.

## 9. Save, hash и миграции

- Save — versioned envelope: schema version, Campaign Pack identity/hash, tactical profile, deterministic state bytes, command/RNG metadata and checksum.
- Canonical serialization задаёт порядок полей, коллекций, numeric representation и normalization; hash не зависит от UI или локали.
- Загрузка неизвестной версии, неверного checksum, отсутствующего Campaign Pack или несовместимого tactical profile завершается явной диагностикой без частичного изменения живого состояния.
- Миграция сохраняет старый файл как вход и создаёт новое состояние отдельно; destructive in-place migration запрещена.

## 10. Assets, mods и лицензии

- Репозиторий не распространяет retail assets EA. Runtime проверяет и читает установленную пользователем копию.
- Custom assets имеют source/provenance, лицензию, author, allowed use и content hash.
- Новая tactical map — typed `pack:` component с declared starts/supported sides/profile, file SHA-256, content-root hash, localization IDs и license/provenance; она монтируется content-addressed overlay.
- Campaign Pack не полагается на абсолютный путь машины автора. References resolution детерминирован и диагностирует missing/ambiguous asset.
- Vanilla RotWK 2.01 — обязательный первый профиль; mod profile не может молча менять Vanilla.
- Retail BIG при переносе сохраняется байт-в-байт и проверяется hash. Массовая передача начинается только после успешного канареечного тома.

## 11. Notion и Drive

Проект: [War Of The Ring: Remaster](https://app.notion.com/p/War-Of-The-Ring-Remaster-41e6f0cf5705810b8b81d85ca92783b2). Четыре базы:

- «Роли» — состав, функции, зоны, гейты и Agent URL;
- «Миссии» — версия ТЗ, фаза, статус, круг, итог и замечания;
- «Запросы» — карточки, зависимости, run identity, PR и check;
- «Обратная связь» — вопросы, ADR и ответы.

Точные data source IDs: `docs/setup/notion-ids.md`. Транспортные поля (`Dispatch State`, `Run ID`, timestamps, recipient identity, output file) вручную не редактируются.

Drive layout: `Arena/wotr-remaster/{logs,payloads,artifacts}`. Секреты, retail archives и большие build outputs туда не кладутся как текстовые артефакты ScriptCat. Подробности: `docs/agents/drive.md`.

## 12. Вопросы и решения

Обычная неоднозначность решается обратимо и фиксируется строкой `Допущение:`. Вопрос передаётся только полем `question` в result-маркере с вариантами и полным `default`; без `gate` работа продолжается по default.

`gate:true` используется лишь когда следующий шаг физически невозможен без ответа. Изменение архитектурного инварианта, оракула или продуктовой границы — `ADR:` с вариантами и default `оставить как есть`. Принятые проектные решения записываются в `docs/DECISIONS.md`.

## 13. Безопасность

- Секреты, токены, пароли, приватные ключи и session cookies не попадают в Git, Notion, Drive artifacts или чат.
- Не запускать загруженный retail executable как часть проверки данных.
- Инструмент с сетью, лицензией или платной квотой требует явного разрешения в карточке.
- Внешний контент до использования проверяется по лицензии и hash.
- Никакая автоматизация не удаляет и не переписывает пользовательские локальные изменения.

## 14. Язык

Процессные документы и общение с Мастером — по-русски. Код, API names, schemas, diagnostics IDs и commit subjects — по-английски. Пользовательские строки отделены от логики. Product baseline — `en`, `ru`, `zh-Hans`, `ja`, `pt-BR`, `de`, `fr`, `ko`; английский — source и per-message fallback. Production claim требует 100% coverage, native-language/cultural review и rendering/font/input gate. Локаль не меняет состояние, RNG, save/network hash или Campaign Pack identity.

## 15. Инциденты транспорта

Временный сбой ScriptCat переживает сам в пределах предохранителя. Поломка транспорта выдаётся Transport Maintainer с минимальной телеметрией без переписки и секретов. Изменение `tools/script-cat/src/**` в `Creative36711/relay-wotr` требует новой plain-semver версии в `@version` и `SCRIPT_VERSION`, пересборки `relay.user.js` и полного gate там же. Установку userscript в браузер выполняет человек после принятия выпуска.
