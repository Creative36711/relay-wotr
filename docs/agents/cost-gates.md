# Стоимостные гейты агентов

Редакция 1.0 · 2026-11-20 · решение `WOTR-D-011`.

Цель — получать достаточное доказательство с минимальной стоимостью. Полная сборка OpenBFME и восстановление retail BFME2/RotWK не являются ритуалом для каждого изменения. Но экономия не может заменить обязательный гейт карточки.

## 1. Декларация карточки

До выдачи Coordinator/Warden записывает в карточке:

```text
Cost gate:
  build: none | focused | full
  retail: none | reuse | hydrate
  reason: <какая граница затронута>
  commands: <минимальный обязательный набор>
```

- `none` запрещает запуск дорогого шага без эскалации.
- `focused` означает один затронутый target и именованные тесты, а не весь suite.
- `full` означает чистую/воспроизводимую сборку обязательных targets и назначенный regression suite.
- `reuse` разрешает уже восстановленную и повторно провалидированную `.retail`, но не скачивание.
- `hydrate` явно разрешает metadata-check, canary и последовательное восстановление Drive snapshot.

Если во время работы обнаружен новый обязательный дорогой гейт, агент сообщает причину и просит изменить Cost gate **до** скачивания или полной сборки. Нельзя тихо расходовать сеть/время, а затем оправдывать это результатом.

## 2. Уровни проверки

| Уровень | Что запускается | Когда достаточно |
|---|---|---|
| **T0 · static** | formatter/lint/schema/doc/link checks, `git diff --check`, проверка generated freshness | docs, role/ADR, JSON-схема без runtime-кода, metadata, перевод текста без изменения runtime/генератора |
| **T1 · focused** | минимальный затронутый target, один test file/filter, headless fixture | изолированная реализация с узкой границей; обычный edit/compile loop |
| **T2 · full source** | `tools/arena/build_engine.sh --tests`, назначенный полный suite, `tools/arena/smoke_godot.sh` без retail | handoff engine/GDExtension/CMake-карточки, cross-cutting ABI/startup, upstream candidate |
| **T3 · retail** | проверенный retail mount, `tools/arena/smoke_godot.sh --retail` и конкретный retail/end-to-end oracle | только retail-sensitive карточка, финал миссии, upstream pin или release candidate |

Всегда начинать с T0/T1. Успешный узкий тест не отменяет T2/T3, если таблица ниже или карточка их требует. Провал узкого теста не является поводом сначала запускать весь suite: сначала локализовать дефект.

## 3. Когда обязательна сборка движка

### T2 обязателен перед handoff

- изменён C/C++ source/header под `engine/**` с влиянием за пределами одного pure helper;
- изменены CMake, toolchain, зависимости, GDExtension ABI/bindings или Godot startup route;
- изменён `OPENBFME_UPSTREAM`, sync/conflict resolution или imported upstream tree;
- изменены generated C++ tables/headers так, что их форма или набор символов поменялись;
- карточка закрывает tactical bridge, map loader/start, save compatibility или release candidate.

Во время итерации вместо T2 допустим T1: `tools/arena/build_engine.sh --quick`, `--core`, конкретный Ninja target и точный test filter. Полный гейт выполняется один раз на финальном SHA, а не после каждой правки.

### Сборка движка не нужна по умолчанию

- только Markdown/Notion/role/ADR;
- только Campaign Pack data/schema, если её standalone validator не генерирует/не компилирует C++;
- только переводы значений каталога при неизменном runtime и актуальных generated files;
- art source/provenance без изменения importer/runtime;
- ScriptCat-only карточка: у неё собственный полный transport gate в `Creative36711/relay-wotr`.

Изменение localization runtime, генератора, plural rules или generated C++ переводит работу минимум в T1; изменение ABI — в T2.

То же правило действует и для CI pull request, и там оно механическое, а не на доверии: job сборки сам сравнивает merge-commit pull request с его базой (`git diff --name-only HEAD^1 HEAD`) и, если весь diff лежит в `docs/**`, отрабатывает один шаг с причиной и
зелёный статус (`tools/release/pr_scope.py`, `WOTR-D-027`). Корневые `README.md`, `LICENSE`, `NOTICE` в эту полосу не входят: их
раскладывает в архив `tools/release/build_launcher.sh`, поэтому правка корневой страницы — полная проверка. Ослабления `CI` при этом
нет: требуемый чек по-прежнему видит `success` от каждого job, а `push` в `main` и merge queue собирают всегда.

## 4. Когда обязателен retail

T3 обязателен, если изменение затрагивает хотя бы одну из границ:

- `RetailArchivePolicy`, archive validation/mount order, install discovery или mod overlay;
- map discovery/MapCache, loaded-map start positions, tactical spawn/start или edition-specific data;
- `BattleRequest` → native OpenBFME launch → `BattleResult`;
- BFME2/RotWK profile compatibility, upstream pin, release/final mission oracle;
- критерий прямо говорит «real retail», «actual BFME2/RotWK» или «native tactical battle».

T3 **не** нужен для pure strategic core, deterministic replay/save unit tests, synthetic DTO mapping, docs, localization catalog validation, UI layout fixture или Campaign Pack validator, если эти изменения не пересекают перечисленные границы.

Mock/synthetic путь может закрыть T1, но не retail-критерий. Если retail недоступен, результат — `not run` и карточка остаётся незакрытой; skip не превращается в pass.

## 5. Drive snapshot и hydration

На 2026-11-20 metadata-only проверка Google Drive подтвердила папку `openbfme-retail-transfer`:

- `manifest.json`: 60,408 bytes, SHA-256 `45bec1a3f698acddf223a2a6edebf73b40126b38dfc56c7061175af18d68b1ab`;
- schema `openbfme.retail-big-transfer` v1;
- 213 BIG archives, 5,636,073,399 bytes;
- 57 volumes: 56 × 99,614,720 bytes и последний 57,649,079 bytes.

Это pin текущего operational snapshot, не содержимое продукта. Перед T3 агент:

1. проверяет metadata manifest/57 parts без скачивания payload;
2. проверяет, нет ли уже полной `.retail` и совпадает ли snapshot;
3. проверяет свободное место (минимум 6.5 GiB сверх нужного build output);
4. получает `retail: hydrate` в карточке;
5. скачивает manifest и один первый volume как canary, проверяет размер/hash и resume path;
6. только после canary подаёт volumes в `tools/retail_big_transfer.py ingest --out .retail --delete-parts` **шагами не более 5 volumes**: шаг считается закрытым после `ingest` и удаления staging-parts, следующий шаг начинается только после этого;
7. выставляет `BFME2_INSTALL=$PWD/.retail/BFME2` и `ROTWK_INSTALL=$PWD/.retail/RotWK`;
8. даёт OpenBFME провалидировать archive policy до продуктового теста.

Не скачивать все volumes «на будущее», не хранить их в Git/build artifacts и не запускать retail executables для проверки данных. Лимит шага — по **числу файлов, а не по объёму**: при `56 × 99 614,720 B` шаг из 5 volumes — это ≤475 MiB staging-файлов, а `tools/retail_big_transfer.py` не имеет флагов параллельной закачки, `ingest` последовательный, поэтому OOM возникает из-за того, сколько parts агент успел вытащить из Drive до передачи в скрипт. Суммарный объём, число контрольных сумм и общее время гидрации от шага в 5 volumes не меняются. Повторный агент в том же workspace переиспользует провалидированную `.retail`, а не скачивает её заново.

## 6. Матрица минимальных команд

| Изменение | Минимум в итерации | Перед принятием |
|---|---|---|
| docs/roles/ADR | T0, профильные oracles | T0 |
| localization strings | `python3 tools/l10n/l10n.py check` + focused catalog tests | locale/headless smoke; T1 только если generated C++ изменился |
| pure strategic core | `--core`/точный target + именованные tests | T2 без retail; determinism/save gate |
| Godot presentation | source check + headless focused scene | built extension + opened visual; retail только при retail route |
| tactical bridge/map/start | focused compile/tests | T2 + T3 |
| upstream pin | range/conflict report + focused compile | T2 + T3, всегда |
| ScriptCat (repo `relay-wotr`) | профильные smoke во время итерации | `npm run verify:scriptcat`, без engine/retail |

## 7. Evidence

Отчёт фиксирует заявленный Cost gate, фактически выполненный уровень, команды/rc/существенный вывод, SHA и каждый `not run`. Для hydration дополнительно фиксируются manifest SHA-256, число обработанных volumes, итог archive validation и факт удаления staging parts. Сами retail-файлы, Drive IDs и временные download URLs в evidence не попадают.
