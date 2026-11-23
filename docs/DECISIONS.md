# ScriptCat transport decisions

This journal contains only transport decisions using the `D-###` format. The WOTR operational journal is mirrored verbatim in `DECISIONS-UPSTREAM.md`; it is excluded from the relay-wotr docs sync recipe.

## D-001 (1.16.8) — Isolate transport CI and keep the decision gate meaningful

**Date:** 2026-11-22 · **Status:** accepted.

The relay-wotr pull-request gate is a single aggregate required check on GitHub-hosted runners, with read-only repository permissions, no secrets, pinned actions, full history and an explicit role-zone preflight. Operational WOTR decisions remain in the upstream mirror; `docs/DECISIONS.md` is reserved for transport decisions so preflight's existing `^##\s+D-\d+` matcher can enforce one new decision and its contract key without exceptions.

**Rollback:** remove the CI workflow and this decision/contract entry together; do not weaken or broaden the preflight decision matcher to accommodate mirrored WOTR decision IDs.

## D-002 (1.16.9) — Authority через контракт профиля: три варианта, default «оставить как есть»

**Date:** 2026-11-22 · **Status:** accepted (шаг 0: ADR + контракт; выбор варианта (а)/(б) — отдельным решением Мастера, per-project).

### Контекст

Транспорт сейчас несёт проектные процессные docs как собственное содержимое: зеркало из десяти путей проекта (`docs/REGULATION.md`, `docs/regulation-digest.md`, `docs/PHASES.md`, `docs/DECISIONS-UPSTREAM.md`, `docs/missions/TEMPLATE.md`, `docs/missions/WOTR-1.1.md`, `docs/missions/WOTR-1.2.md`, `docs/agents/cost-gates.md`, `docs/agents/troubleshooting.md`, `docs/agents/roles/localization-cultural-qa-engineer.md`), краткий регламент, вшиваемый сборкой в бандл, и профиль `tools/script-cat/wotr-project.json` с идентификаторами проекта. Правка проектных docs меняет транспорт; один репозиторий привязан к одному проекту.

Карточка TRANS · NEU требует нейтральности: один транспорт — несколько проектов, зависимость односторонняя (проект подстраивается под контракт, транспорт о проектах не знает). **Шаг 0 — только настоящий ADR и контракт**: переноса содержимого и удаления зеркал нет; старый путь остаётся рабочим, зелёным и обратимым, пока новый путь не принят.

### Варианты

**(а) artifact-by-reference.** Реестр проекта публикует краткий регламент контент-адресованным артефактом в Drive (чтение — через существующий drive-gateway, новых capability не запрашиваем). Профиль хранит `{fileId, sha256, regulationVersion}`; транспорт перед каждым dispatch читает артефакт и сверяет хэш. В git транспорта не попадает ни байта проектных docs. Плюсы: минимальный контракт, верификация до отправки, ноль проектных байтов. Минусы: публикация артефакта — работа проекта, fail-closed чтение — работа транспорта; доверие к fileId приходит из профиля.

**(б) transport-as-library.** Транспорт публикует версионированный выпуск (src-фрагменты, schema, guard, тесты); бандл собирает проект собственным CI, deploy — per-project. Транспорт проектные docs не читает вовсе. Плюсы: полная независимость, версии под контролем проекта. Минусы: интеграционная стоимость на каждый проект, публикация и синхронизация релизов транспорта.

**(в) embedded-mirror — текущее поведение.** Десять зеркальных путей и вшитый digest остаются как сейчас; нейтральность достигается только схемой контракта, а не содержимым. Плюсы: ноль работы, статус-кво зелёный, переход per-project обратим. Минусы: проектные docs остаются байтами транспорта; правка проекта меняет транспорт.

**Default: (в) оставить как есть.** Новый путь (а)/(б) включается per-project и обратим; до его принятия зеркало и digest остаются рабочими (инварианты ниже).

### Контракт (нормативная часть; любое изменение — только новым D-### вместе с release)

1. **Контракт версии транспорта.** semver в `@version` (`tools/script-cat/src/00-header.js`) плюс changelog в `docs/scriptcat-update.md`; preflight требует подъёма версии только вместе с правкой `src/**`. Breaking-изменение любого пункта контракта ниже — отдельный release транспорта с подъёмом @version и новой записью D-###; правки контракта в зеркале проекта или в чужом репозитории запрещены.
2. **Схема профиля проекта (минимальный set).**
   - `projectId`, `repo` — идентичность проекта и целевой репозиторий;
   - `notion` — data sources проекта (roles, missions, requests, questions);
   - `authority: { kind, fileId | url, sha256, regulationVersion }` — источник регламента: `kind: "embedded-mirror"` (сейчас; fileId/sha256/regulationVersion не применяются) или `kind: "artifact"` (вариант (а));
   - `dispatch: { markerPrefix, roleZones, costGateMatrix }` — общий префикс имён result-маркеров, зоны записи по ролям, ссылка на матрицу Cost gate проекта.
   Проектные значения никогда не хардкодятся в код транспорта — они читаются из профиля во время выполнения. Поля профиля вне этого набора — приватная деталь транспорта и меняются без breaking-контракта.
3. **Формат result-marker.** Имена `CF_*_RESULT` с JSON-телом по матрице `markers` в `contracts/agent-protocol.json` (эталон) и `docs/agents/markers.md`; разбор — лестница `parseMarker` в `src/13-arena-messages.js`. Префикс имён задаёт профиль (`dispatch.markerPrefix`, сейчас `CF_`).
4. **Формат evidence-строки.** Отчёт строчный: строка evidence = команда, rc, существенный вывод, длительность в секундах (шаг «команды/rc/существенный вывод» — `docs/agents/cost-gates.md` §7); шапка отчёта фиксирует tested SHA, Node version, итоги (pass/fail) и каждый `not run`. Ровно этот формат обязателен для отчётов транспорта в `docs/evidence/`.

Всё, что вне этих четырёх пунктов, — приватная деталь транспорта.

### Fail closed (нормативно)

При `authority.kind: "artifact"` перед каждым dispatch: прочитать артефакт, посчитать sha256, сверить с профилем. Несовпадение хэша **или** отсутствие артефакта — отказ dispatch с явной ошибкой, в которой названы ожидаемый и полученный хэш и `regulationVersion`; warning и «продолжить молча» запрещены. При `authority.kind: "embedded-mirror"` (текущий режим) поведение не меняется.

### Portability guard: нейтральность (нормативно)

`tools/script-cat/portability-guard.mjs` обязан падать, если в любом файле транспорта, кроме `UPSTREAM.md`, встретится имя проекта, его repo, ID Notion/Drive, префикс карточки или проектный путь. Расширение — только добавлением паттернов: существующие проверки не выключаются и не ослабляются. Активация нейтральных паттернов идёт вместе с новым путём (переносом содержимого и профиля наружу), чтобы режим embedded-mirror оставался зелёным до принятия нового пути; сегодняшний охват guard'а (бывшие идентификаторы, provenance, provision) сохраняется без изменений.

### Изоляция мультипроектности (нормативно)

Разные authority-артефакты живут в одном рантайме без взаимного влияния: prompt, зоны, лимиты и очереди каждого проекта изолированы профилем; удаление одного проекта не ломает остальных. При выборе (а) или (б) добавляется тест: собранный бандл режима artifact не содержит проектных строк (имя, repo, ID, префиксы, пути); вшитый digest остаётся только в режиме embedded-mirror.

### Приложение: план и стоимость удаления embedded-mirror (если выбраны (а) или (б); само удаление — отдельной карточкой на стороне проекта)

**Пути, которые перестают копироваться в транспорт** (сейчас это зеркало из десяти): `docs/REGULATION.md`, `docs/regulation-digest.md`, `docs/PHASES.md`, `docs/DECISIONS-UPSTREAM.md`, `docs/missions/TEMPLATE.md`, `docs/missions/WOTR-1.1.md`, `docs/missions/WOTR-1.2.md`, `docs/agents/cost-gates.md`, `docs/agents/troubleshooting.md`, `docs/agents/roles/localization-cultural-qa-engineer.md`.

**Что придётся перестроить:** `tools/script-cat/build.mjs` (сборка не стартует без `docs/regulation-digest.md` и сверяет версию digest'а с REGULATION через `regulation-oracle.mjs`), `relay-regulation-digest-smoke` (фиксирует проектные строки в digest'е), зоны в `prompts-smoke` и guard-extra-список (REGULATION, digest, scriptcat-update сейчас вне нейтральных паттернов), `wotr-project.json` наружу (профиль приходит во время выполнения), ссылки acceptance-report на `docs/evidence/<version>.md`.

**Стоимость (оценка):** 10 путей, две точки сборки (digest-зависимость build.mjs и assertDigestVersionMatches), не меньше трёх тестов на пересмотр, вынос профиля, один ход удаления с полным `verify:scriptcat`; протокол маркеров не меняется. Удаление — только после принтия (а)/(б) и зелёного нового пути; при ветке (в) ничего из этого не делается.

### Инварианты

1. Ноль проектных байтов в репозитории транспорта как цель: проектные docs транспорт получает только как данные профиля во время выполнения (или не получает вовсе при (б)); на шаге 0 ничего не переносится и не удаляется.
2. Зависимость односторонняя: проект подстраивается под контракт транспорта; транспорт не знает о существовании WOTR, OpenBFME и других проектов; ни одна правка проектных docs не создаёт задачи в очереди транспорта.
3. Транспорт не выделяет номера `WOTR-*` и не копирует чужие журналы: собственный журнал — только `D-###`; ссылки на чужие решения допускаются только цитатой, не как номер, занятый у нас.
4. Ни одна проверка не выключается и не ослабляется: режим embedded-mirror остаётся зелёным, пока новый путь не принят; переход включается per-project и обратим конфигом; not run не превращается в pass, таймаут не становится skip.
5. Секреты, токены, retail-ссылки и персональные пути в git нет; новых capability не запрашивается — артефакты читаются существующим drive-gateway.
6. Breaking-изменение контракта — только собственный release транспорта с подъёмом @version и записью D-###; правки контракта в зеркале проекта или в чужом репозитории не делаются.

### Не делаем (шаг 0)

Перенос содержимого, удаление зеркал, правки guard'а, dispatch и тестов. Исполнение нормативных пунктов «fail closed», «нейтральность guard'а» и «изоляция» — отдельными ходами после выбора варианта; на этом шаге зеркало, digest и профиль не меняются.

**Rollback:** удалить секцию D-002 и ключ `d002` из `contracts/agent-protocol.json` вместе; контракт выше перестаёт действовать, поведение транспорта не менялось.
