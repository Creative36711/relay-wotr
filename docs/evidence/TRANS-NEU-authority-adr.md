# TRANS · NEU — authority-ADR (D-002) · evidence

- **Card:** TRANS · NEU · Транспорт не зависит от проектов: authority через контракт профиля (ADR, без переноса содержимого) — `4216f0cf-5705-81f2-825d-eb1883c9cc67`
- **Date:** 2026-11-22
- **Tested SHA:** `3b813f8d69e21e4ba89086d9d645b67524711729` — коммит контента (ADR + ключ контракта + changelog); файл этого отчёта добавлен следующим коммитом и во входы гейтов не входит (guard/build/tests `docs/evidence/**` не читают)
- **Node:** v22.22.3
- **Версии:** `@version 1.16.9` (src/** не менялся), protocolVersion 1.11, digest «Версия 1.4 · 2026-11-23»
- **Bundle SHA-256:** `89bee68f6c3f5685ccc48ca0b636ddbeeeb35c8aee4a749dec59a219643defca` (бандл не менялся — пересборка байт-иденична)

## Команды

| Команда | rc | Длительность | Существенный вывод |
|---|---|---|---|
| `npm run verify:scriptcat` | 0 | 27 s | scriptcat:check + portability guard + 179/22/2, fail 0 |
| `npm run scriptcat:check` (= `build.mjs --check`) | 0 | <1 s | бандл соответствует 45 исходным файлам; Coverage: 18 ruleId |
| `git diff --check` | 0 | <1 s | пусто |
| `node tools/script-cat/preflight.mjs --zone "tools/script-cat/**, tools/relay-*.mjs, tools/*.mjs, package.json, .github/**, docs/**, README.md, WARDEN-SCRIPTCAT-MIGRATION.md"` | 0 | <1 s | «новое решение D-002», ключ в контракте; версия без подъёма — src не менялся; 14 файлов, все в зоне; **можно пушить** |

## Итоги тестов (при tested SHA)

- `test:scriptcat` — 179 pass / **0 fail**
- `test:scriptcat:regression` — 22 pass / **0 fail**
- `test:scriptcat:tool-limit` — 2 pass / **0 fail**
- портability guard — OK (бывшие идентификаторы, provenance-граница, provision — без замечаний)
- `scriptcat:guard`/`build` не выдали ни одного `not ok`

## Что не запускалось

- `npm run verify:scriptcat:node` (`tools/relay-build.mjs`) — вне гейтов карточки.
- Browser live cycle — ручной гейт включения auto mode, к ADR отношения не имеет; репозиторные тесты не заявляют, что userscript установлен.
- Правки `src/**`, `portability-guard.mjs`, dispatch и тестов — **шаг 0 по Цели карточки: только ADR + контракт**; исполнение нормативных пунктов (fail closed, нейтральность guard'а, изоляция, тест бандла) — отдельными ходами после выбора варианта.
- Перенос содержимого и удаление embedded-mirror — не делались (запрет шага 0); план и стоимость — приложение D-002.
- Cost gate: build none (движок не затрагивался), retail none — проверки не применимы.
- CI GitHub «ScriptCat required gate» — запускается на push, результат в checks PR (не локальный гейт).

## Что сделано (правки этого хода)

1. `docs/DECISIONS.md` — **D-002 (1.16.9)**: контекст, три варианта ((а) artifact-by-reference, (б) transport-as-library, (в) embedded-mirror) c default «оставить как есть», нормативный контракт (версия транспорта, схема профиля `projectId/repo/notion/authority/dispatch`, формат result-marker `CF_*_RESULT`, формат evidence-строки), fail closed, требование нейтральности guard'а, изоляция мультипроектности, приложение «план и стоимость удаления embedded-mirror» (10 путей, build.mjs digest-зависимость, ≥3 тестов на пересмотр), 6 инвариантов, rollback.
2. `tools/script-cat/contracts/agent-protocol.json` — ключ `d002` (preflight: «ровно одно решение, ключ в контракте»).
3. `docs/scriptcat-update.md` — чужие номера `WOTR-D-030` убраны как свои (инвариант 3 D-002): шапка и секция выпуска 1.16.9 переназваны (`ids-ladder`), ссылка на чужой журнал осталась только цитатой.

## Замечания

- Карточный гейт `npm run scriptcat:build --check` в этом npm не пробрасывает `--check` в скрипт (npm съедает флаг — уходит в сам npm); фактическая проверка — `npm run scriptcat:check` = `node tools/script-cat/build.mjs --check`, rc 0. Попутная полночная пересборка (`build.mjs` без `--check`) дала байт-идентичный бандл: `git status` по `relay.user.js`/`prompt-coverage.json` пуст.
- На ветке `arena/c461233d-relay-wotr` уже открыт PR #4 (TR2 mirror-resync); этот ход добавляет коммит в ту же ветку — PR несёт обе карточки, preflight это допускает («ровно одно решение» — D-002), мерж — по инструкции Мастера.

## Повтор на дереве этого отчёта (до коммита)

| Команда | rc | Длительность | Существенный вывод |
|---|---|---|---|
| `git diff --check` | 0 | <1 s | пусто |
| `node tools/script-cat/preflight.mjs --zone "…"` (CI-зона) | 0 | 1 s | «новое решение D-002»; 15 файлов, все в зоне; **можно пушить** |

Сам файл отчёта (`docs/evidence/**`) — markdown вне входов guard/build/tests; его правка не меняет результаты гейтов выше.
