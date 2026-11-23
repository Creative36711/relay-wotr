# Агентный контур транспорта

ScriptCat 1.17.0 доставляет карточки между четырьмя базами Notion и Arena-агентами. Он не заменяет регламент, GitHub или продуктовый oracle.

## Источники истины

1. Регламент проекта — полномочия и запреты (в репозитории проекта).
2. План фаз проекта — продуктовая последовательность (в репозитории проекта).
3. ТЗ миссии `<ID>` — версия намерения, invariants, Scope и финальный oracle (в репозитории проекта).
4. Notion «Роли» — живой состав, zones, gates and Agent URLs.
5. Notion «Миссии/Запросы» — состояние очереди.
6. GitHub commit/PR/merge and reproducible artifacts — факт работы.

## Документы

- `protocol.md` — цикл хода, budgets and durable result return;
- `markers.md` — exact machine markers;
- `notion.md` — базы и authority;
- `drive.md` — logs/payloads/artifacts;
- `pr-rules.md` — Git safety and preflight;
- `onboarding.md` — подключение роли;
- `roles/` — инструкции функций и специализации ролей проекта.

## Главный принцип

Агент получает полное задание один раз, затем продолжения с теми же IDs. Ни marker, ни report, ни зелёная карточка не являются доказательством сами по себе. Принимаются воспроизведённые команды, return codes, artifacts, hashes and tested SHA.
