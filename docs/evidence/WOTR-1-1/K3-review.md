# WOTR-1.1 · K3 · разбор выхода за Scope (Warden)

**Дата:** 2026-11-21 · **Роль:** Warden · **Карточка:** `41f6f0cf-5705-8101-a1fa-c0b96a72b566`, run `c5975098-a70e-4a82-a8c7-ba4d0a0c109f` · **Решение:** WOTR-D-020.

Поле «Report SHA» карточки указывает на `reports/wotr-1.1-k3.md`; этого пути в репозитории нет (`git ls-tree -r origin/main` по `reports/` даёт 0 файлов), поэтому durable-записью считаются лог рана в реестре и этот файл.

## Заявлено исполнителем (из лога рана)

- Реализация: `engine/src/GameLogic/WotrRemaster/Bridge/{BattleBridge.h,BattleBridge.cpp,BattleBridgeNative.cpp}`, тесты `engine/tests/WotrRemaster/Bridge/{test_battle_bridge.cpp,test_battle_bridge_native.cpp,test_battle_bridge_retail.cpp}`.
- «По вашему разрешению добавлено wiring в `engine/CMakeLists.txt` и `engine/cmake/Wotr1.cmake`».
- Проверки: Bridge CTest 2/2; pure Bridge 5 кейсов / 166 проверок; native NewGame 1 кейс / 23; retail integration 62/62; выбранные tactical/WOTR-регрессии 32 кейса / 897 проверок при 5648 пропущенных фильтром; `git diff --check` чисто; retail ingest 57/57 volumes, 213 проверенных BIG-архивов.
- Ограничения: полный набор тестов не запускался; дополнительный Godot smoke с retail путями упал на отсутствующем ассете (`cursor Arrow: no file SCCPointer.cur`), нативный C++ retail-прогон при этом прошёл.
- Состояние: «Работа сохранена в активной ветке `arena/c96b0520-open-bfme`, HEAD `19cde7a`, без commit/push. PR не открывался, merge не выполнялся».

## Проверено в репозитории (2026-11-21, `origin/main` = `19cde7a`)

| Команда | Результат |
|---|---|
| `git ls-tree -r origin/main` по `WotrRemaster` | `engine/src/GameLogic/WotrRemaster/**` и `engine/tests/WotrRemaster/**` есть, каталога `Bridge/**` нет |
| `ls -d engine/src/GameLogic/WotrRemaster/Bridge engine/tests/WotrRemaster/Bridge godot/wotr_remaster/bridge` | ни одного — «No such file or directory» |
| `grep -rn "WotrRemaster" engine/CMakeLists.txt engine/cmake/*.cmake` | пусто: ни один CMake-файл про лейн не упоминает |
| `gh api "repos/…/commits?path=engine/cmake/Bridge1.cmake"` | `e0cd899` 2026-11-20 «vendor: import OpenBFME v0.4.12 nightly snapshot» — файл не правка K3, а vendored-наследие; лейн BRIDGE-1 про розничные мосты (`WALK_ON_TOP_OF_WALL`) |
| `gh api "repos/…/commits?path=engine/cmake/Wotr1.cmake"` | тот же `e0cd899` — легаси-лейн WOTR-1 (LivingWorld + `tests/test_wotr*.cpp`), Bridge-списка там нет |
| `git ls-remote --heads origin` | `main` + 7 веток `arena/*`; `arena/c96b0520-*` среди них нет |
| `gh api …/compare/main...<каждая arena-ветка>` | ни одна ветка не трогает `Bridge*/**`, `engine/CMakeLists.txt` или `engine/cmake/*` |

Вывод по фактам: заявленный результат K3 в `main` не приземлился ни в одном виде — ни файлов `Bridge/**`, ни строк wiring, ни ветки. Единственные следы работы — лог рана в реестре и дерево того сандбокса.

## Вердикт по Scope

**Легализовано, карточка не забракована, принятие отложено.** Основания — WOTR-D-020: правка вне `Bridge/**` была необходима (glob'ов нет, `engine/CMakeLists.txt:741 add_executable(openbfme_tests …)` перечисляет тестовые файлы явно), разрешение запрошено до внесения и записано в лог, класс стоимости не изменён (`build: full`, `retail: hydrate` — cost-gates §1 не нарушен), оракул `§8 K3` и текст инвариантов не тронуты.

Закрыто в реестре: поле «Scope» карточки дополнено `engine/CMakeLists.txt` и `engine/cmake/WotrRemaster1.cmake`; инвариант 5 не переписывался.

Условия принятия (за исполнителем, не за Warden):

1. `commit` + `push` в свою ветку и PR. `Submitted` без ветки на origin — это состояние, которое приёмка не может пересобрать.
2. Полный гейт на финальном SHA: `tools/arena/build_engine.sh --clean --tests` и `openbfme_tests` целиком, без `-k`/фильтра; по cost-gates §6 «tactical bridge/map/start» требует T2 + T3 перед принятием. Плюс дослить evidence hydration по cost-gates §7: manifest SHA-256, итог archive validation, факт удаления staging parts (в логе есть только 57/57 volumes и 213 архива).
3. Wiring перенести из vendored `engine/cmake/Wotr1.cmake` в `engine/cmake/WotrRemaster1.cmake` (one include-строка в `engine/CMakeLists.txt`) и той же правкой зарегистрировать пять существующих файлов K2 в сборке (`test_main.cpp`, `test_pack.cpp`, `test_save.cpp`, `test_state.cpp`, `test_determinism.cpp` и их `test_common.h`), иначе «зеленость» WOTR-тестов по-прежнему не проверяется машиной: ни одна цель сборки их не компилирует.

## Не выполнено (`not run`)

- Полный `openbfme_tests` на финальном SHA — `not run` (прогон был с фильтром, 5648 пропущено).
- T3-граница на финальном SHA после последних правок — `not run`: Godot smoke с retail путями падал на `SCCPointer.cur`; skip в pass не превращается (cost-gates §4).
- Рецензия A3 по K3 — не заводилась: карточка ещё не принята.

## Вердикт по INFRA-предложению «Arena build/launch cache»

| # | Пункт | Решение |
|---|---|---|
| 1 | Обязательный timing-блок в отчётах K4/A3 | Принять с изменением: не два адреса, а любая карточка с declared `build: full`/`retail: hydrate`; формат — команды, rc, длительность, `not run` (cost-gates §7 уже это требует, новый артефакт не вводится) |
| 2 | Итерационная стратегия: восстановление `engine/build`, `godot/bin`, `godot/.godot` по внешнему артефакту + gitlink `engine/thirdparty/godot-cpp` + версия компилятора + `BUILD_TYPE`/`OPENBFME_EXTRA_CXX_FLAGS`, обязательно `build_engine.sh --check` и SHA binaries | Принять с изменением: ключ кэша обязан включать hash дерева источников (`git rev-parse HEAD^{tree}`), а не только `OPENBFME_UPSTREAM` — upstream-pin не меняется между нашими коммитами, и на одном пине разные SHA получали бы один артефакт. `--check` + сверка SHA — до и после восстановления. `--tests` и `--clean` в `build_engine.sh` уже есть, новых флагов гейт не требует |
| 3 | Приёмочная стратегия: `build_engine.sh --clean --tests` ровно один раз на финальном SHA | Принять как есть; ослабления (кэш вместо чистого прогона, «раньше же проходило») — отклонить |
| 4 | `ccache`/`sccache` после замера | Принять как есть: сначала замер (порог — не менее четверти времени итерационного цикла), гейт не трогать; базовая точка для сравнения — 754.83 s полного прогона release-файлов на 2 vCPU (`docs/evidence/scriptcat-1.16.6.md`:202) |
| 5 | Toolchain snapshot в Drive с SHA256SUMS; retail в Git не хранить | Принять с изменением: манифесты и SHA256SUMS только append, перезаписи pinned-версий нет; Drive IDs и временные ссылки в Git/evidence не попадают (cost-gates §7 запрещает прямо), адрес артефакта живёт в полях реестра |
| 6 | Формализация переиспользования валидированной `.retail` (metadata-check → 57 volumes → `reuse` только при совпадении snapshot) | Принять как уже действующее правило (cost-gates §5): карточка может добавить исполняемую проверку `reuse` в bootstrap, но не меняет ни 8 шагов hydration, ни декларацию `retail: hydrate` |
| 7 | Более мощный runner (4–8 vCPU / 8–16 GiB) как платный эксперимент Owner с одним замером `JOBS=2` vs `JOBS=4/8` на том же SHA | Принять как замер, не как гейт: на мощном раннере можно измерять, приёмочный прогон остаётся на стандартном, иначе выводы карточек становятся несравнимыми |
| 8 | Отдельная карточка на `SCCPointer.cur` | Принять: карточку заводит Координатор по ответу владельца, адресат — роль Godot/ассетов. Не блокёр K3, и в `skip` не конвертируется |

**Отклонено в любом виде:** перенос доказательства приёмки на кэш или на «артефакт восстановлен, `--check` зелёный»; превращение `not run`/skip в pass; правка `tools/arena/**` внутри чужой (Bridge-)карточки — в таблице зон ТЗ §9 у `tools/arena/**` нет строки владельца, кроме `sync_upstream.sh` (Upstream Integrator), поэтому инфраструктурная карточка обязана прийти с явно назначенной зоной; BIG-архивы и ссылки на Drive в репозитории; замена оракула `§8` или cost-гейта K3/K4/A3 «оптимизацией».

**Решение по открытым путям (WOTR-D-022, принято Warden 2026-11-21):** таблица зон ТЗ §9 дополнена — это ровно тот случай, когда регламент отдаёт правку такой строки приёмке, а не исполнителю. (1) `tools/arena/**` целиком — Upstream Integrator (K1): `bootstrap.sh`, `build_engine.sh`, `smoke_godot.sh` и `sync_upstream.sh` — одна семья скриптов среды сборки, и правка `--tests`/`--clean` меняет гейт, по которому принимают все карточки. (2) Регистрация файлов лейна живёт в `engine/cmake/<lane>.cmake`, а в `engine/CMakeLists.txt` любой роли доступна ровно одна строка `include(...)`; vendored-списки (`Wotr1.cmake`, `Bridge1.cmake`) правит их владелец, иначе three-way merge `sync_upstream.sh` конфликтует на каждом импорте. (3) Отчёт карточки коммитится в `docs/evidence/WOTR-1-1/<карточка>/**` исполнителем карточки, и поле «Report SHA» называет этот путь: артефакт, живущий только в дереве сандбокса или только в Drive, доказательством приёмки не считается. Строка K3 в таблице содержит теперь `engine/CMakeLists.txt` и `engine/cmake/WotrRemaster1.cmake`, то есть расхождение «поле Scope ↔ ТЗ» закрыто с обеих сторон.

Поля «Зона записи» в реестре ролей обновлены тем же ходом (Upstream Integrator, Tactical Bridge Engineer, Strategic Core Engineer, Godot World Engineer, Localization & Cultural QA Engineer — по строке своей карточки плюс `docs/evidence/WOTR-1-1/<карточка>/**`), так что `preflight.mjs` больше не имеет основания отклонять эти пути: ровно на этом основании он и отклонял правку K3 до WOTR-D-020. Строки аудитов A1–A3 не менялись.
