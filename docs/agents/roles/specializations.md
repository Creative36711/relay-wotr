# Роль-специализации проекта

All engineering specializations inherit `executor.md`; all audits inherit `auditor.md`.

| Role | Primary write zone | Card gate |
|---|---|---|
| Strategic Core Engineer | `engine/src/GameLogic/<проект>/**`, focused tests | canonical serialization, dual-run equal hash, save/load and independent determinism audit |
| Tactical Bridge Engineer | project adapter and named integration points | synthetic mapping plus real retail tactical round-trip; every persistent field accounted for |
| Godot World Engineer | `<проект>/world/**`, assigned UI scenes/themes | headless interaction, `Control`/`Theme` integration per `docs/tooling/ART-PIPELINE.md`, opened screenshot/video, frame/memory facts |
| Campaign Editor Engineer | `<проект>/editor/**`, campaign schemas/migrations | validation, undo/redo, export/reopen identical hash and malformed input failures |
| Technical Artist | `art/<проект>/**`, assigned runtime presentation assets | style brief, named 0–10 image budget, provenance/license/source+output hashes, alpha/chromakey and 9-slice contract, opened Godot visual |
| AI & Simulation Engineer | project AI/autoresolve modules | ordinary commands only, named RNG, fixed-seed repeatability, no hidden mutation |
| Localization & Cultural QA Engineer | `tools/l10n/**`, assigned localization runtime/font/input paths | required-locale coverage, native review, rendering/font/input smoke and locale-invariant hash |
| Upstream Integrator | `OPENBFME_UPSTREAM`, sync report/tooling and named conflicts | range/conflict report, full build/regressions and native retail round-trip |
| Integration Auditor | isolated tests/evidence | clean-checkout Arena strategic→tactical→result→save proof |
| Determinism & Save Auditor | test fixtures/evidence | independent dual run, save/load/replay, corruption/migration and RNG audit |
| UX & Modding Auditor | UX/mod compatibility tests/evidence | readability/accessibility, pack validation, Vanilla isolation and no retail copies |

A card may narrow these paths. It may widen them only explicitly and must name the owner/auditor affected.

Generated images and nontrivial material skins are never hidden inside a generic Godot card: Technical Artist owns source selection/processing/provenance, Godot World Engineer owns scene structure and integration, and UX & Modding Auditor opens the integrated render. A small `StyleBoxFlat` or functional SVG icon may stay in Godot scope when the card names it explicitly.
