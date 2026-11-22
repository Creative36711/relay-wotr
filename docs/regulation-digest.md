# Регламент WOTR Remaster · краткий вход

Версия 1.2 · 2026-11-20. Полный источник: `docs/REGULATION.md` и одноимённая страница Notion из профиля. Этот текст уже пришёл в задании; повторно открывать регламент не нужно.

## 1. Архитектура

- Один репозиторий: `Creative36711/open-bfme`.
- `WotrRemaster` — отдельное детерминированное стратегическое ядро: WEGO commands, canonical state/hash, versioned save. Godot nodes, wall clock, locale, filesystem/unordered iteration и неназванный RNG в simulation запрещены.
- Godot делает 2.5D hex map, ввод, HUD и Campaign Pack editor.
- OpenBFME Godot Nightly делает tactical battle и читает retail BFME2/RotWK пользователя напрямую.
- Граница — versioned `BattleRequest` / полный `BattleResult`: победитель, survivors, experience/rank, heroes, persistent upgrades/sciences, reinforcements, destroyed strategic buildings и metadata. Mock не заменяет retail gate.
- Vanilla RotWK 2.01 — первый tactical profile; Campaign Packs поддерживают retail references, licensed custom assets и mod overrides.
- Мир `Creative36711/wotr` переносится только versioned one-way importer со stable IDs/provenance, без React/Tauri/Win32 runtime; publication ждёт license. Tactical capacity считается по сторонам: союзники делят start; overflow → declared fallback map либо deterministic autoresolve.
- Новые tactical maps — лицензированные content-addressed `pack:` overlays с starts/profile/hash/provenance. Retail assets не копируются в продукт или публикуемую history; BIG передаётся байт-в-байт.
- Player path: адаптировать существующий launcher/one-archive pipeline, не upstream binary и не второй updater. Один архив → WOTR launcher → retail selection → **Play WOTR Remaster**; strategy+tactical — один game process. WOTR data/saves изолированы, offline bundled start обязателен, support — только после fresh-profile oracle.

## 2. Роли

Мастер — направление, доступы, лицензии и платные действия. Warden — ТЗ и финальная приёмка. Coordinator — очередь и карточки, без кода и финальной приёмки. Executors: Strategic Core, Tactical Bridge, Godot World, Campaign Editor, Technical Artist, AI & Simulation, Localization & Cultural QA, Upstream Integrator. Единственный Maintainer — Transport Maintainer, чинящий транспорт. Auditors: Integration, Determinism & Save, UX & Modding.

Источник полномочий — строка Notion «Роли». Без строки, активного статуса и Agent URL рабочей роли нет. Исполнитель не принимает себя; Auditor не чинит найденное в том же ходе; Warden не пишет продукт.

## 3. Зоны и Git

Зона роли — постоянная граница, Scope карточки — граница хода. Чужое только читать. Оракул можно усиливать, но нельзя удалять, ослаблять, skip/todo или подгонять. Перед правкой зафиксируй branch, BASE_SHA и `git status --short`; чужие локальные изменения не reset/clean/stash/overwrite.

Работай только в ветке Arena. Один PR — одна карточка. Direct push в `main` запрещён. Клон может быть shallow: пустой merge-base не доказательство. `merged:true` только после фактического merge. OpenBFME sync — отдельная карточка Upstream Integrator по pin `OPENBFME_UPSTREAM` с range/conflict report и полным regression gate. `tools/script-cat/**` меняет только Transport Maintainer отдельным выпуском. History rewrite retail — отдельная destructive Master-approved операция из full mirror clone, не продуктовая карточка.

## 4. Фазы и ход

План: `docs/PHASES.md`, фазы 1–8. Активная миссия `WOTR-1.1`: map → movement → OpenBFME battle → full native result → map/save. `WOTR-1.2` остаётся черновиком без карточек: accept `WOTR-1.1` только снимает зависимость, а подготовка `WOTR-1.2` требует отдельного будущего решения. Не делай работу будущих миссий и пустые заготовки.

После отдельного решения начать подготовку миссии ассистент создаёт её первую карточку: единственную `Ready` B0 — read-only репетицию всего оракула (`build:none`, `retail:none`). Только после её `Accepted` Coordinator нарезает остальные карточки.

Цикл: Warden публикует ТЗ → Coordinator готовит Draft/Ready и зависимости → ScriptCat выдаёт dispatch/run → агент сдаёт evidence и точный marker → Coordinator Accepted/Rework → независимый audit → Warden `accept/rework/master`. Зелёная карточка не заменяет финальный oracle собранной миссии. `master` — только доступ/аккаунт, лицензия/ToS, платное действие, секрет, agent activation или продуктовая граница.

## 5. Evidence

`not run`, timeout, зелёный нерелевантный CI, слова агента или mock вместо retail-пути не равны pass. Нужны команда, rc, существенный вывод, artifact path/hash, tested SHA и Cost gate. Карточка заранее задаёт `build: none/focused/full` и `retail: none/reuse/hydrate`; сначала static/focused. Полная engine build и Drive hydration — только по `docs/agents/cost-gates.md` или явному критерию, но обязательный финальный gate не пропускается. Визуал — агент открыл screenshot/video и описал увиденное.

- Core: unit + repeated-run equal hash + canonical save + negative validation.
- Bridge: synthetic DTO + retail map real battle + native full result + strategic apply.
- Godot/editor: headless smoke + deterministic interaction + opened visual artifact + frame/memory facts.
- Save/schema: round-trip + corruption/unknown-version/migration failures.
- Upstream: C++/GDExtension build + focused tests + WOTR regressions + retail smoke.
- ScriptCat: `npm run verify:scriptcat` — build check, portability guard, smoke, regression, tool-limit.

Формат финальной строки всегда стоит в самом конце задания; точный marker и IDs задаёт ScriptCat. Финал `WOTR-1.1`: map → real battle → result → save/hash. Финал `WOTR-1.2` на каждой заявленной платформе: fresh profile → unpack one archive → WOTR launcher/retail selection/Play → тот же round-trip/save, offline/update/tamper/coexistence negatives.

## 6. Save, assets, mods

Save envelope содержит schema version, Campaign Pack identity/hash, tactical profile, canonical state, command/RNG metadata и checksum. Неизвестная версия, damaged checksum, missing pack или incompatible profile отказываются до изменения живого state. Миграция не перезаписывает исходный файл.

Custom asset требует provenance/license/author/hash. Pack не содержит абсолютных путей машины автора. Missing/ambiguous references дают явную ошибку. Mod profile не меняет Vanilla молча.

## 7. Вопросы, секреты, язык

Неясность решай минимально и обратимо; в отчёт `Допущение:`. Вопрос — только `question` в result marker с options и полным default; без gate продолжай по default. `gate:true` — лишь когда следующий шаг физически невозможен. Контракт/oracle/граница продукта — `ADR:` с тремя вариантами и default `оставить как есть`.

Секреты и session data не в Git/Notion/Drive/chat. Retail executable не запускать ради проверки данных. Процесс и общение — русский; code/API/schema/commit — English. Обязательные локали: `en`, `ru`, `zh-Hans`, `ja`, `pt-BR`, `de`, `fr`, `ko`; English fallback, production — только после coverage/native review/rendering gate. Locale не меняет simulation/save/network hash.

<!-- build:meta -->
Сборка вшивает текст выше в `relay.user.js`. После изменения: поднять версию только при изменении transport source, выполнить `node tools/script-cat/build.mjs`, затем полный ScriptCat gate. Предел входа — 9000 знаков.
