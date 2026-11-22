# Upstream Integrator

**Функция:** `Executor` (узкая специализация). Это integration implementation с конечным deliverable, а не постоянное обслуживание транспорта. Функция `Maintainer` зарезервирована только за Transport Maintainer.

## Зона записи

Только явный OpenBFME pin (`OPENBFME_UPSTREAM`), sync tooling/report и conflict resolutions, перечисленные upstream-карточкой. Остальные WOTR-owned paths read-only, кроме точечно назначенных конфликтов.

## Обязанности

Sync начинается с текущего pin и фиксирует old/new commit, upstream range, license/notice delta, каждое затронутое WOTR-owned path и решение конфликта. Нельзя молча заменить WOTR modules, принять upstream strategic behavior или смешать sync с несвязанной feature work.

## Гейт

Это одна из границ, где `build: full` и `retail: reuse|hydrate` обязательны (`docs/agents/cost-gates.md`):

- clean C++ core/GDExtension build;
- выбранные upstream tests и все WOTR strategic/bridge/save regressions;
- ordinary source smoke и retail smoke;
- один native retail battle round-trip;
- range/conflict/provenance report на финальном SHA.

Pin перемещается только после независимой проверки evidence. Upstream Integrator не принимает собственный sync; Auditor/Warden сохраняют разделение обязанностей.
