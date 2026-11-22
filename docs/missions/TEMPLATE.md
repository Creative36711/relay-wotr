# <MISSION-ID> · <Название>

ТЗ <N.M> · статус: Черновик · фаза <1–8> · владелец: Warden.

## Намерение

Один проверяемый результат миссии.

## Контекст и зависимости

- Published base SHA / upstream pin.
- Предыдущие принятые миссии.
- Нужные роли и независимые аудиторы; specialization записывается с точной функцией из «Ролей».
- Locale impact для `en`, `ru`, `zh-Hans`, `ja`, `pt-BR`, `de`, `fr`, `ko` и license/provenance impact для content.

## Cost gate

Для каждой карточки до выдачи зафиксировать по `docs/agents/cost-gates.md`:

```text
build: none | focused | full
retail: none | reuse | hydrate
reason: <затронутая граница>
commands: <минимальный обязательный набор>
```

Начинать с T0/T1. T2/T3 выполняются один раз на финальном SHA, если обязательны; отсутствующий retail остаётся `not run`, а не pass. Release-кандидат дополнительно требует clean all-ref history gate из `docs/RETAIL-HISTORY-AUDIT.md`.

## Visual/UI gate, если применимо

Следовать `docs/tooling/ART-PIPELINE.md`. До выдачи назвать style brief, конкретный asset list и consuming scenes/nodes, разделить Godot layout/integration и Technical Artist generation/provenance, задать budget `0–10 images` на visual card, source/runtime paths, states/resolutions/locales и открываемые acceptance renders. Текст и interaction не запекаются в изображения; unselected generations не коммитятся.

## Инварианты

Нумерованный список свойств, которые нельзя нарушить. Не смешивать с выбранной реализацией.

## Результат

Что становится реально доступно пользователю/следующей фазе.

## Scope

### Разрешённая запись

Точные пути и виды изменений.

### Только чтение / запрещено

Чужие зоны, защищённый оракул, retail data, секреты и будущие фазы.

## Контракты

Типы, versioning, ошибки, deterministic ordering, migration and compatibility rules.

## Карточки

| ID | Роль / функция | Зависит от | Build | Retail | Выход |
|---|---|---|---|---|---|
| `<MISSION-ID>-K1` | `<specialization>` / Executor | — | focused | none | … |
| `<MISSION-ID>-A1` | `<specialization>` / Auditor | K1 | focused | none | независимый отчёт |

## Оракул карточек

Для каждой карточки: reason/commands объявленного Cost gate, точная команда/fixture, ожидаемый rc и измеримый результат. Отчёт агента не является оракулом. Для пользовательских строк — catalog/generated/coverage checks, точные product tags, locale-invariant hash и назначенный rendering/native-cultural gate.

## Финальный оракул миссии

Проверка интегрированного SHA, включая required retail/Arena path и обязательный T2/T3 handoff. `not run`, timeout и mock не pass. Release/final publication дополнительно требует rc 0 от `tools/release/retail_history_audit.py` в complete clone.

## Evidence

BASE_SHA, HEAD/merge SHA, объявленные и фактические `build`/`retail`, команды+rc, существенный вывод, артефакты+hash, visual/locale description, список `not run`. При hydration: pinned manifest SHA, volumes и archive validation без Drive IDs/retail payload.

## Допустимая свобода

Решения, которые исполнитель вправе принять обратимо. Для существенной неоднозначности — `Допущение:`; для изменения контракта/границы — ADR.

## Не входит

Явный список соседних задач и будущих фаз.

## Rollback

Как удалить/отключить изменение без повреждения сохранений, retail data и upstream baseline.
