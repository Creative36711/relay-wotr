# Агентный контур WOTR Remaster

ScriptCat 1.16.8 доставляет карточки между четырьмя базами Notion и Arena-агентами. Он не заменяет регламент, GitHub или продуктовый oracle.

## Источники истины

1. `docs/REGULATION.md` — полномочия и запреты.
2. `docs/PHASES.md` — продуктовая последовательность.
3. `docs/missions/<ID>.md` — версия намерения, invariants, Scope и финальный oracle.
4. Notion «Роли» — живой состав, zones, gates and Agent URLs.
5. Notion «Миссии/Запросы» — состояние очереди.
6. GitHub commit/PR/merge and reproducible artifacts — факт работы.

## Документы

- `protocol.md` — цикл хода, budgets and durable result return;
- `markers.md` — exact machine markers;
- `notion.md` — базы и authority;
- `drive.md` — logs/payloads/artifacts;
- `cost-gates.md` — declared build/retail tiers, full-build triggers and Drive hydration policy;
- `pr-rules.md` — Git safety and preflight;
- `onboarding.md` — подключение роли;
- `troubleshooting.md` — отказ без потери identity;
- `roles/` — инструкции функций и WOTR specializations.

## Главный принцип

Агент получает полное задание один раз, затем продолжения с теми же IDs. Ни marker, ни report, ни зелёная карточка не являются доказательством сами по себе. Принимаются воспроизведённые команды, return codes, artifacts, hashes and tested SHA.
