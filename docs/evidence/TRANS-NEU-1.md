# TRANS · NEU-1 — Транспорт без проектного содержимого: digest и профиль — вход сборки (шаг 2/2)

**Дата:** 2026-11-22 · **Карточка:** TRANS · NEU-1 (Sequence 15) · **Вариант:** (б) «транспорт как библиотека и контракт»
**Зависимость:** OPS · RELAY-BUILD-1 (шаг 1 из 2) — Accepted, до старта работ проверена.
**Tested SHA:** `832605c` (контентный коммит; отчёт — вторым коммитом) · **Ветка:** `arena/d0fc9c8c-relay-wotr`
**Node:** v22.22.3 · **Release:** @version 1.16.9 → **1.17.0**, SCRIPT_VERSION 1.17.0, protocolVersion 1.11 → **1.12**, решение **D-003**
**Cost gate:** build **none**, retail **none** (по карточке; engine/retail-прогоны не запускались).

## Что сделано (сводка)

1. **Удалены 11 путей** одним контентным коммитом с проверками, которые на них падали: `docs/REGULATION.md`, `docs/regulation-digest.md`, `docs/PHASES.md`, `docs/DECISIONS-UPSTREAM.md`, `docs/agents/cost-gates.md`, `docs/agents/troubleshooting.md`, `docs/agents/roles/localization-cultural-qa-engineer.md`, `docs/missions/TEMPLATE.md`, `docs/missions/WOTR-1.1.md`, `docs/missions/WOTR-1.2.md`, `tools/script-cat/wotr-project.json`.
2. **Сборка:** `node tools/script-cat/build.mjs [--check] [--digest <путь>]`. Placeholder `@@REGULATION_DIGEST@@` остаётся в `src/01-config.js`; без `--digest` — нейтральный бандл, пустой блок регламента, rc 0; каждая сборка пишет `contracts/build-manifest.json` (`digest: null | {version, sha256}`), `--check` сверяет bundle + coverage + manifest.
3. **Оракул сохранён, проверка переезжает на вход:** `assertDigestAgainstManifest` сверяет шапку переданного digest'а с build-manifest; при `digest: null` возвращает `null` — неприменимость показана явно (строка прогона ниже), не тихо и не как skip. Файл `regulation-oracle.mjs` не удалялся.
4. **Guard расширен** нейтральными паттернами проекта (имя, репозиторий, префиксы карточек, Notion/Drive id, процессные пути); прежние паттерны не выключены; `UPSTREAM.md` — единственное исключение; всё падавшее на новых паттернах удалено/санитизировано тем же коммитом.
5. **Изоляция проектов:** два sanitized-фиктивных проекта в одном рантайме изолированы; удаление одного не ломает другой — закреплено пробой `relay-project-profiles-integration`.
6. **Тест на отсутствие 11 путей** — в `relay-repo-visibility-smoke` (рабочее дерево) + команда `git ls-tree` ниже (git-дерево) + бандл без проектных строк (grep ниже).

## Команды, rc, существенный вывод, длительность

| # | Команда | rc | Существенный вывод | Длит., с |
|---|---------|----|--------------------|----------|
| 1 | `git fetch --unshallow origin` | 0 | история полная (лечит shallow-блокер preflight) | 1 |
| 2 | `node tools/script-cat/build.mjs` | 0 | «Собран … из 45 исходных файлов (нейтральный регламент: --digest не передан)»; `Build-manifest: digest null` | <1 |
| 3 | `npm run scriptcat:check` | 0 | bundle соответствует 45 файлам; coverage 18 ruleId; manifest: «digest null — нейтральный бандл, сверка digest неприменима (показана явно)» | 0 |
| 4 | `npm run scriptcat:guard` | 0 | `OK: full ScriptCat tree and operational guides are project-neutral; exact upstream identity is confined to UPSTREAM.md provenance` | 0 |
| 5 | `npm run verify:scriptcat` | 0 | tests **179 pass / 0 fail**, regression **22 / 0**, tool-limit **2 / 0** (было 179/22/2 — состав не менялся) | 25 |
| 6 | `node tools/script-cat/preflight.mjs --zone "tools/script-cat/**, tools/relay-*.mjs, tools/*.mjs, package.json, .github/**, docs/**, README.md, WARDEN-SCRIPTCAT-MIGRATION.md"` | 0 | все 8 проверок ok, включая «ровно одно решение, ключ в контракте — новое решение D-003» и «версия 1.16.9 → 1.17.0»; итог **«можно пушить»** | 0 |
| 7 | `git diff --check` | 0 | пусто (замечаний whitespace нет) | 0 |
| 8 | `git ls-tree -r --name-only HEAD -- <все 11 путей из п.1>` | 0 | **пусто** — ни одного из 11 путей в git-дереве (команда выполнена на SHA `832605c`) | <1 |
| 9 | `grep -ci 'wotr\|open-bfme' tools/script-cat/relay.user.js` | 1 (нет совпадений) | **0** — собранный бандл без проектных строк | <1 |

Примечание к №9: в тесте `relay-repo-visibility-smoke` тот же список токенов (имя проекта, репозиторий, профиль, digest, план фаз) проверяется по бандлу сборкой литералов — grep-строка выше приведена как независимый замер.

## Пробы режимов сборки и оракула (явно)

Прогон `tests/relay-regulation-digest-smoke.mjs` (в составе verify) фиксирует обе границы:

- закоммиченный бандл — нейтральный: `regulationDigest` пуст, placeholder в src, `build-manifest.digest: null`;
- **неприменимо (явно):** строка прогона — `неприменимо (явно): сверка версии регламента отсутствует — переданного digest нет (digest: null)` (функция вернула `null`; это не pass и не skip);
- положительный режим: временная копия инструментов **без каталога docs**, `--digest <файл>` с шапкой `Версия 9.9` → rc 0, регламент подставлен, manifest несёт version+sha256, `--check` с тем же входом rc 0, `assertDigestAgainstManifest` = `9.9`;
- негативы: чужая версия (`8.8`) → отказ сверки; файл без строки `Версия N.N` → сборка rc ≠ 0 с причиной «в шапке digest'а нет строки „Версия N.N“».

## Что не запускалось (not run — не является pass)

- CI GitHub (`.github/workflows/scriptcat.yml`, гейт «ScriptCat required gate») — запускается после push; статус PR фиксируется в chat-отчёте отдельно.
- `npm run test:scriptcat:regression` — **запускался** (22/0, строка №5); в таблице отдельной строкой не дублируется.
- Browser-tests (`tools/script-cat/browser-tests/**`) — не входят в `verify:scriptcat` и по карточке не запускались.
- Engine/retail/Drive/Notion-прогоны, `tools/release/*` — вне cost gate этой карточки (build none, retail none).
- Прогоны на других Node-версиях, другие ОС — не выполнялись.

## Инварианты карточки — где закреплены

- Ноль проектных байтов и сетевых чтений: вход только `--digest`; `publishedTzVersion` при пустом `queueDoc` возвращает `null` до сетевого вызова (assert в `relay-publication-gap-smoke`).
- Удаление содержимого ≠ удаление оракула: `regulation-oracle.mjs` существует, проверка — на входе, N/A показан явно (выше).
- Guard только расширяется: прежние `formerPatterns` не тронуты (прогон прежних кейсов сохранён в `relay-portability-guard-smoke`), новые паттерны добавлены; `UPSTREAM.md` — единственное исключение; паттерны guard'а собираются из кусков, чтобы сам файл не ловил себя.
- Односторонняя зависимость, свои `D-###`: D-003 записан в `docs/DECISIONS.md` и в контракте (ключ `d003`); чужих номеров в записи нет.
- Release: @version 1.17.0 (src + fallback), changelog `docs/scriptcat-update.md` (секция «Выпуск 1.17.0 (D-003)»), protocolVersion 1.12, контракт `d003`; правок в чужих репозиториях нет.
- Секреты/retail/чужие id: не добавлялись; новых capability не запрашивалось.
