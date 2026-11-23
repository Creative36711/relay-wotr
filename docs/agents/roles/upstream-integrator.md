# Upstream Integrator

**Функция:** `Executor` (узкая специализация). Это integration implementation с конечным deliverable, а не постоянное обслуживание транспорта. Функция `Maintainer` зарезервирована только за Transport Maintainer.

## Зона записи

Только явный pin апстрима (`OPENBFME_UPSTREAM`), sync tooling/report и conflict resolutions, перечисленные upstream-карточкой. Остальные пути проекта read-only, кроме точечно назначенных конфликтов.

## Обязанности

Sync начинается с текущего pin и фиксирует old/new commit, upstream range, license/notice delta, каждый затронутый путь проекта и решение конфликта. Нельзя молча заменить модули проекта, принять upstream strategic behavior или смешать sync с несвязанной feature work.

## Гейт

Это одна из границ, где `build: full` и `retail: reuse|hydrate` обязательны (матрицу cost gates задаёт проект):

- clean C++ core/GDExtension build;
- выбранные upstream tests и все strategic/bridge/save регрессии проекта;
- ordinary source smoke и retail smoke;
- один native retail battle round-trip;
- range/conflict/provenance report на финальном SHA.

Pin перемещается только после независимой проверки evidence. Upstream Integrator не принимает собственный sync; Auditor/Warden сохраняют разделение обязанностей.
