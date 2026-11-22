# ADR-003: Product locale baseline and localization ownership

- **Status:** Accepted
- **Date:** 2026-11-20
- **Decision:** `WOTR-D-013`
- **Reference:** `Creative36711/synapse@83955634d1c6d87d505a676ace3b5cfffa8b3e75`

## Context

OpenBFME already has a strict source catalog (`tools/l10n/catalog/en.json`), generated catalogs for Godot/C++, placeholder/plural validation, per-message English fallback and coverage reports. Before this decision it exposed only English and a small German sample. The related Synapse product establishes eight production locales: English, Russian, Simplified Chinese, Japanese, Brazilian Portuguese, German, French and Korean.

Simulation, save/network hashes and content IDs must not depend on display language. A locale appearing in a selector without meaningful coverage is not production support.

## Decision

The required product locale set is fixed as:

```text
en, ru, zh-Hans, ja, pt-BR, de, fr, ko
```

These are BCP-47 product locale tags. Do not collapse `zh-Hans` to generic `zh` or `pt-BR` to generic `pt` in catalogs, settings, saves, telemetry or pack metadata. Runtime plural/number rules may share language-family implementation internally, but the public tag remains exact.

`en` is the source. Each of the other seven catalogs must exist from Phase 0 onward, may initially be `partial`, and falls back per message to English. A release may call a locale **production-supported** only when the catalog is complete for that release and the localization acceptance gate passes. Until then the UI labels it clearly as incomplete; no locale is silently omitted from planning or coverage.

All player-facing OpenBFME and WOTR Remaster text uses stable catalog IDs. Locale-dependent values are presentation-only and may not enter canonical state, RNG, command ordering, `BattleRequest`, `BattleResult`, pack identity or save/network hashes. Campaign Packs localize names/descriptions by ID with the same English fallback contract.

## Ownership and independent audit

Add **Localization & Cultural QA Engineer**, an Executor specialization. It owns catalog/runtime/font/input work and locale evidence; it does not self-accept. The UX & Modding Auditor independently verifies completeness, fallback visibility, clipping/layout, font coverage, shaping, CJK line breaking, pseudolocalization and Campaign Pack fallback.

## Acceptance gate per production locale

1. catalog validation and generated-file freshness;
2. 100% source-ID coverage with placeholder/plural parity and no stale IDs;
3. native-language editorial/cultural review recorded in evidence (machine translation alone is insufficient);
4. headless locale smoke plus opened screenshots at target scale for launcher, strategic map/HUD, battle notices, save/load errors and Campaign Pack validation;
5. font/glyph coverage, shaping and input/IME smoke where applicable;
6. long-text/pseudolocale layout and English fallback checks;
7. deterministic test showing locale switches do not change canonical state/save hash;
8. independent UX & Modding Auditor pass.

## Consequences

- Locale support becomes a release-quality obligation rather than a sample UI path.
- Existing `zh`/`pt` plural helpers and install-language aliases must be upgraded to exact product tags before those catalogs are active.
- Translation can proceed incrementally, but production claims cannot.
- Locale-specific artwork or copy still needs provenance/license and cultural review.
