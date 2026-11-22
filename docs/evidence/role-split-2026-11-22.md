# Разделение ответственности Warden ↔ Transport Maintainer · проверка полноты

Date: 2026-11-22 · Decision: `WOTR-D-025` · Regulation: `1.2 → 1.3` · Registry: rows `Роли` (Notion)

## Что утверждал владелец

После переноса ScriptCat в `Creative36711/relay-wotr` разделение должно быть полным: **Warden — любая операционная
часть**, **Transport Maintainer — любая техническая часть ScriptCat**, и никто не должен быть ущемлён в правах.
Проверяли не формулировки, а исполняемый гейт: `tools/script-cat/preflight.mjs` в `relay-wotr` читает строку
«Зона записи» роли и сравнивает с ней каждый изменённый файл (`zoneOutside`, глобы через `,`/`;`/перевод строки).

## Дефект 1 · Warden не мог писать в собственный журнал

Зона Warden в реестре была `docs/missions/**, docs/decisions/**, docs/REGULATION.md, docs/PHASES.md; Notion: Миссии/…`.
Файл журнала — `docs/DECISIONS.md` (заглавные, одна файл-строка, не каталог), то есть шаблон `docs/decisions/**` его
не покрывает, а проза после `;` — это мусор в списке глобов, запрещённый самим правилом `docs/missions/WOTR-1.1.md`
(«plain list of glob paths, no prose»). Замер на реальном инструменте (копия `preflight.mjs` из `relay-wotr@main`,
изменённый файл — `docs/DECISIONS.md`):

```
$ node <scratch>/preflight.mjs --json --zone "docs/missions/**, docs/decisions/**, docs/REGULATION.md, docs/PHASES.md; Notion: Миссии/Обратная связь/приёмка."
ZONE CHECK ok: False | detail: вне зоны: docs/DECISIONS.md      (rc 1)

$ node <scratch>/preflight.mjs --json --zone "docs/missions/**, docs/DECISIONS.md, docs/REGULATION.md, docs/regulation-digest.md,
  docs/PHASES.md, docs/agents/**, docs/evidence/**, docs/setup/**, .github/**, AGENTS.md, README.md, CONTRIBUTING.md, pytest.ini"
ZONE CHECK ok: True  | detail: 1 файлов, все в зоне
```

Практический смысл: PR #11 (перенос транспорта) правил `docs/DECISIONS.md`, `docs/agents/**`, `README.md`,
`.github/workflows/pr.yml` — то есть почти всё своё содержимое формально «вне зоны» роли, которая обязана это вести.
Операционная зона Warden теперь включает слой процесса этого репозитория: регламент, журнал, `docs/agents/**`,
`docs/evidence/**`, `docs/setup/**`, `.github/**` и файлы гейтов `tools/precommit.py`, `tools/release/pr_audit.py`,
`tools/release/pr_pytest.py`, `tools/release/public_workflows.py` с их тестами.

## Дефект 2 · Transport Maintainer не мог починить собственный гейт

Зона роли в реестре: `tools/script-cat/**, tools/relay-*.mjs and ScriptCat-specific documentation. Product code is
read-only. This is the only role with the Maintainer function.` Функция в реестре и в `docs/agents/roles/*` описана как
«починка/repairing», а зона накрывает только исходники комплекта. Изменённые файлы — `package.json`,
`.github/workflows/ci.yml`, `docs/regulation-digest.md` (то, что требует карточка переноса). Зона сравнивается боевым
`preflight.mjs`, остальные его проверки в черновой копии не проходят по независимым причинам (нет `origin/main`),
поэтому здесь цитируется строка зоны:

```
$ node <scratch>/preflight.mjs --json --zone "tools/script-cat/**, tools/relay-*.mjs and ScriptCat-specific documentation. …"
ZONE CHECK ok: False | detail: вне зоны: docs/regulation-digest.md, package.json, .github/, …    (rc 1)
```

То есть роль, которой перенос отдал техническую часть, не могла выполнить её же обязательные шаги: добавить CI
transport-репозитория, синхронизировать вшиваемый регламент и поправить `package.json`. Зона расширена до всего дерева
`relay-wotr` (`tools/script-cat/**`, `tools/relay-*.mjs`, `tools/*.mjs`, `package.json`, `.github/**`, `README.md`,
`docs/**`, включая зеркало `docs/REGULATION.md`/`docs/regulation-digest.md`, `docs/agents/**`, `docs/missions/**`,
`docs/PHASES.md`, `docs/DECISIONS.md`), а функция переформулирована: «repair **and** development».

## Что изменено на операционной стороне (этот PR)

| Файл | Правка |
|---|---|
| `docs/REGULATION.md` | версия 1.3; §1 «Agent transport» = вся техническая часть, «Процесс» = слой процесса и гейтов; §3 строки Warden и Transport Maintainer + абзац о полном и симметричном разделении и о том, что непокрытая обязательным путём зона — дефект реестра; §4 новая строка «Обязательный путь вне зоны»; §6 абзац «шов разделения» (кто что делает на границе); §7 гейт перед push объявлен по репозиториям вместо требования всем искать `tools/script-cat/preflight.mjs` |
| `docs/regulation-digest.md` | версия 1.3, «один репозиторий» → продукт+процесс здесь / техника ScriptCat там, роли: операционка у Warden и вся техника у Maintainer, правило покрытия зоны. 7590 знаков до `build:meta` (лимит 9000) |
| `docs/agents/roles/warden.md` | полномочия: процесс и CI этого репозитория + исправление чужих зон; прямой запрет на техническую работу транспорта |
| `docs/agents/roles/transport-maintainer.md` | зона = всё дерево `relay-wotr`, «repair and development», отсутствие права записи поднимается как `master`, а не обходится |
| `docs/agents/pr-rules.md` | Р10: команды гейта разделены по репозиториям + правило «зона — только глобы, без прозы» |
| Notion «Роли» | `Зона записи` Warden и Transport Maintainer переписаны списком глобов; проза перенесена в `Гейт` |

## Репетиция синхронизации (то, что должна сделать карточка транспорта)

На свежей копии `relay-wotr@main`, полученной с `codeload.github.com` (только проверка: запись в `relay-wotr` этой
песочнице не выдана, см. последний раздел):

1. `printf '\n' >> tools/script-cat/src/08-projects-ui.js; printf '\n' >> tools/script-cat/src/12-notion.js`
   → `node tools/script-cat/build.mjs --check` = `ScriptCat bundle соответствует 45 исходным файлам.`,
   `npm run verify:scriptcat` → **rc 0** (`# pass 179 / # fail 0`, `# pass 22 / # fail 0`, `# pass 2 / # fail 0`); бандл
   `77ca0fcc…` не меняется, версия не поднимается.
2. Копирование актуальных `docs/REGULATION.md`, `docs/regulation-digest.md`, `docs/DECISIONS.md`, `docs/PHASES.md`,
   `docs/agents/**`, `docs/missions/**` из `open-bfme@main` + `node tools/script-cat/build.mjs` → бандл меняется на
   `5725235422a6e26d…` (в него вшит новый digest), и **весь гейт остаётся зелёным**:
   `scriptcat:check` ok, portability guard ok, `test:scriptcat` `# pass 179 / # fail 0`,
   `test:scriptcat:regression` `# pass 22 / # fail 0`, `test:scriptcat:tool-limit` `# pass 2 / # fail 0`,
   `npm run verify:scriptcat` → **rc 0**. Значит правки операционных документов на этой стороне не ломают транспорт:
   синхрон безопасен, и он не требует подъёма версии — сам гейт не требует подъёма версии при изменении только digest
   (правило версии смотрит на `src/**`). Решение о версии и о записи в `docs/scriptcat-update.md` принимает
   Transport Maintainer, а не эта сторона.

## Что осталось за пределами этого PR

Карточка `Transport Maintainer` в «Запросах» (ID и ссылка — в описании PR) с четырьмя пунктами: вернуть две пустые
строки в `src/**`, завести `.github/workflows/**` в `relay-wotr`, синхронизировать зеркало документов под регламент
1.3 и пересобрать бандл, разделить журнал `D-###` и зеркало `WOTR-D-*`. Плюс доступ: `git push` в `relay-wotr` из
песочницы отдан не был (403; запись через API — 404), что и оформлено как `master`-граница владельца, а не как работа
Warden в чужом дереве.
