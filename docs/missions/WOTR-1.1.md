# WOTR-1.1 · Контракты и детерминированный walking skeleton

ТЗ 1.2 · редакция 1.2 · статус: Активна · фаза 1 · владелец: Warden · 2026-11-21.

Notion draft: [WOTR-1.1](https://app.notion.com/p/WOTR-1-1-41e6f0cf570581d89a15eca7e646f077).

Изменения редакции 1.2 (аддитивные): `§10` получает таблицу владельцев путей и правило
авторования `Scope`; `§7` отмечает, что карточки нарезаются только от этой редакции.
Текст оракула `§8`/`§9` не изменён ни на строку. Разбор, породивший редакцию:
[docs/handoff/2026-11-21-WOTR-1-1-B0-zone-gate.md](../handoff/2026-11-21-WOTR-1-1-B0-zone-gate.md).

## 1. Намерение

Доказать самый короткий реальный вертикальный путь нового продукта:

```text
Campaign Pack → strategic map → WEGO movement → conflict
→ native BattleRequest → OpenBFME tactical battle
→ native full BattleResult → strategic map → canonical save/load/hash
```

Результат миссии — не набор интерфейсов и не демонстрационный mock, а воспроизводимый round-trip в Arena на retail BFME2 1.06 + RotWK 2.01.

## 2. Baseline и зависимости

- Один репозиторий: `Creative36711/open-bfme`.
- OpenBFME pin: `v0.4.12-nightly.261118100`, commit `4a8d82727c2664c381b7b1c07344881760c4765b`.
- Godot line: 4.7; engine: C++17 GDExtension.
- Tactical profile: Vanilla RotWK 2.01.
- Existing upstream tactical facts may be wrapped: `LivingWorld::BattleSetup`, `LivingWorld::BattleResult`, `BattleResultCapture`, `NewGameMessage::livingWorldBattle`, retail archive policy.
- Existing `LivingWorldLogic` is reference/read-only for this mission; it is not the Remaster strategic core.
- Required roles: Upstream Integrator (`Executor` specialization), Strategic Core Engineer, Tactical Bridge Engineer, Godot World Engineer, Localization & Cultural QA Engineer (`Executor` specialization), Determinism & Save Auditor and Integration Auditor. UX & Modding Auditor independently reviews the visible map, locale behavior and pack boundary. `Transport Maintainer` is the only `Maintainer` and is not a product executor.
- Product locale tags are exactly `en`, `ru`, `zh-Hans`, `ja`, `pt-BR`, `de`, `fr`, `ko`; English is per-message fallback and locale is presentation-only.

Execution begins only after the required role rows have active Arena Agent URLs and the published source baseline is present in the repository. Every card is issued with an explicit `build`/`retail` Cost gate from `docs/agents/cost-gates.md`.

## 3. Инварианты

- **INV-1 Separate core.** Authoritative state and rules live under `GameLogic/WotrRemaster`, not in GDScript and not in retail-faithful `LivingWorldLogic`.
- **INV-2 Deterministic input.** Pack hash + initial seed + ordered command envelopes produce identical state bytes and hashes.
- **INV-3 No ambient input.** Simulation does not read wall clock, locale, Godot node state, absolute paths, filesystem order or unordered container order.
- **INV-4 Native typed boundary.** Tactical launch/return uses versioned C++ DTOs. Godot Dictionaries may expose a binding but are not canonical storage.
- **INV-5 Full result.** Result is not only winner/casualties: persistent fields listed in §6 are carried or explicitly represented as empty/not-applicable.
- **INV-6 Transactional apply.** Wrong battle ID, request checksum, state hash, unknown entity, duplicate result or unsupported contract version changes zero strategic bytes.
- **INV-7 Retail truth.** Final tactical criterion uses OpenBFME with actual validated retail archives. A fake result cannot satisfy it.
- **INV-8 Retail read-only.** No retail asset or transformed derivative is committed by this mission.
- **INV-9 Save identity.** Save includes pack identity/hash and tactical profile; corrupt/unknown/incompatible input fails before state swap.
- **INV-10 Existing OpenBFME parity.** Focused upstream tests and ordinary skirmish startup remain green.
- **INV-11 One conflict.** The fixture contains one intentional movement conflict and one tactical battle; no economy, diplomacy or narrative system is built.
- **INV-12 Legacy phase boundary.** Phase 1 does not import the full `Creative36711/wotr` dataset or its React/Tauri/Win32/OCR runtime. The accepted one-way importer, stable-ID/provenance rules and map-capacity fallback from ADR-002 begin in phase 2; no runtime dependency or unlicensed content enters this mission.
- **INV-13 Locale boundary.** Every new user-facing string is a catalog ID with English fallback; selecting any required locale changes no command, state byte, RNG result, save/network hash, request/result checksum or pack identity.

## 4. Required product slice

### 4.1 Tiny Campaign Pack

A versioned synthetic pack, committed without retail content:

- three connected hex/regions: `west`, `crossing`, `east`;
- two factions and one controllable army each;
- stable IDs for every region, faction, army and member;
- one tactical map reference known to Vanilla RotWK 2.01;
- simple visual placement and catalog-ID labels rendered through English fallback in every required product locale;
- one move from each side into `crossing`, creating a conflict;
- manifest, schema version, content hash and validation diagnostics.

### 4.2 Core flow

1. Load and validate pack.
2. Build initial state from explicit seed.
3. Accept two move command envelopes.
4. Resolve canonical command order.
5. Move armies and create exactly one pending battle.
6. Emit immutable `BattleRequest` and freeze that pending battle until a result arrives.
7. Apply valid `BattleResult` once.
8. Return to planning state with updated armies/ownership.
9. Save, load into a fresh instance and compare canonical bytes/hash.

### 4.3 Godot flow

A minimal 2.5D view must allow the user/test driver to:

- see the three cells and two armies;
- select the local army and preview/submit its move;
- see validation and conflict state;
- transition into the OpenBFME battle without launching another application;
- return to the same strategic view with visible survivor/owner changes;
- save and reload the resulting campaign.

The flow needs headless automation and one opened visual artifact. Visual polish is not part of this mission.

## 5. Canonical strategic contracts

Names may change only by accepted ADR; semantics may not.

```text
CampaignPackManifest
CampaignState
CommandEnvelope<MoveArmy>
ResolutionEvent
PendingBattle
BattleRequestV1
BattleResultV1
WotrSaveEnvelopeV1
```

Stable IDs are strings or fixed-width values with explicit normalization. No Godot instance ID or container address crosses the boundary. Every decoder returns structured error code + context; user-facing localization remains outside core.

## 6. Tactical round-trip

### BattleRequestV1 must carry

- contract version, battle ID and strategic state hash;
- pack ID/hash, tactical profile and map reference;
- tactical seed, participants, teams and human/AI seats;
- army/member stable IDs, templates, quantities, experience/rank and persistent upgrades;
- hero identity and persistence metadata;
- starting resources, persistent sciences/powers and reinforcement schedule;
- strategic building/objective IDs represented on the tactical map;
- canonical request checksum.

### BattleResultV1 must carry

- contract version, battle ID, request checksum and completion reason;
- winner/draw/forfeit identity;
- survivors by stable army/member identity, quantity, experience/rank and persistent upgrades;
- hero survival/death/revival records;
- per-player persistent sciences/upgrades/skill or power state;
- called and uncalled reinforcements;
- destroyed strategic building/objective IDs;
- tactical statistics required for strategic presentation;
- deterministic capture boundary/frame where available;
- canonical result checksum.

If OpenBFME cannot currently produce a field, the DTO still represents it with explicit absence and the card reports the exact gap. Silently dropping a persistent field is failure.

## 7. Cards

| Card | Role / function | Depends on | Build | Retail | Required output |
|---|---|---|---|---|---|
| `WOTR-1.1-K1` | Upstream Integrator / Executor | — | full | hydrate¹ | pinned OpenBFME source baseline in the one repository; sync report; baseline build/tests |
| `WOTR-1.1-K2` | Strategic Core Engineer / Executor | K1 | full | none | pack loader, state/commands, deterministic conflict, DTOs, canonical save/hash and pure tests |
| `WOTR-1.1-K3` | Tactical Bridge Engineer / Executor | K1,K2 | full | hydrate¹ | adapter to native OpenBFME start/result capture and focused bridge tests |
| `WOTR-1.1-K4` | Godot World Engineer / Executor | K2,K3 | full | hydrate¹ | minimal 2.5D interaction and automated route through battle/return/save |
| `WOTR-1.1-K5` | Localization & Cultural QA Engineer / Executor | K4 | full | none | exact eight-locale catalogs/fallback, generated tables, hash-invariance and target-screen evidence |
| `WOTR-1.1-A1` | Determinism & Save Auditor / Auditor | K2,K4 | focused | none | independent dual-run and corruption/transactionality report |
| `WOTR-1.1-A2` | UX & Modding Auditor / Auditor | K4,K5 | focused | none | opened locale visuals plus independent pack/reference/cultural boundary report |
| `WOTR-1.1-A3` | Integration Auditor / Auditor | K1–K5,A1,A2 | full | hydrate¹ | clean-checkout Arena retail end-to-end evidence |

¹ `retail: reuse` may replace `hydrate` only when the card records a revalidated pinned snapshot; otherwise hydration is explicitly authorized once at final SHA. All `build: full` cards use focused iteration and run the full gate once before handoff.

Warden may split K2–K4 further only if the final oracle and interfaces remain unchanged. Coordinator must not issue overlapping write zones in parallel.

`B0 · репетиция оракула` precedes every card of the table: read-only, `build: none`,
`retail: none`, it verifies the executability of each `§8`/`§9` item and of the path
owners in `§10`. K1–K5 and A1–A3 are sliced from the published edition named by the
mission row «ТЗ SHA» and only after `B0` is `Accepted`.

## 8. Card-level oracles

### K1 · Source baseline

- Exact upstream pin equals `OPENBFME_UPSTREAM`.
- GPL `LICENSE`/`NOTICE` are preserved.
- Clean configure and focused build of `openbfme` and `openbfme_tests` return 0.
- Baseline WOTR/tactical tests selected from upstream run and their names/results are recorded.
- Source import does not alter `BFME2/`, `RotWK/`, user dirty files or ScriptCat.

### K2 · Core

- Schema accepts the valid tiny pack and rejects duplicate IDs, broken topology, missing tactical profile/map and unstable/absolute references.
- Two fresh processes run the same commands and emit byte-identical canonical state plus equal hash at every resolution boundary.
- Reordered source JSON properties do not change canonical pack/state hash.
- Invalid command and invalid result leave pre/post state bytes equal.
- Save/load in a fresh instance yields equal bytes/hash and continues with equal next-step hash.
- Unknown save/contract version and damaged checksum return named nonzero failures.

### K3 · Bridge

- Synthetic DTO → native start → synthetic native capture → DTO round-trip proves every field mapping.
- Negative cases reject unknown templates/entities, duplicate battle completion and mismatched checksum/hash transactionally.
- A real OpenBFME tactical map starts from the request and native `BattleResultCapture` (or an accepted equivalent end boundary) produces the result; no hand-authored result on this path.
- Existing focused OpenBFME tactical/WOTR tests remain green.

### K4 · Godot

- Headless scenario performs select → move → conflict → battle launch → return → save/load and exits 0.
- Input is translated into core commands; no direct state mutation from GDScript.
- Screenshot or short recording shows the tiny map before and after battle. Agent opens it and reports visible cells, armies, route/conflict and result change.
- Frame time and peak memory are reported as facts, without setting a release budget in this mission.

### K5 · Localization and cultural QA

- Every phase-1 user-facing string is an English source ID; all exact required locale catalogs are present, validate and regenerate byte-identically.
- English per-message fallback is proven for missing partial translations; `zh`/`pt` aliases do not replace the public `zh-Hans`/`pt-BR` tags.
- A repeated fixture under each locale produces the same canonical state/save/request/result hashes as English.
- Target screenshots or headless geometry reports cover long text, CJK/Hangul/Cyrillic glyphs, shaping, clipping and input. A locale remains `partial` and is not called production-ready without 100% coverage plus native/cultural review.

### A1 · Determinism/save

Auditor reruns from a clean checkout, on accepted SHA, with separate output directories. At least two complete runs have equal command log, state bytes and hash. Corrupt, unknown-version and mismatched-pack inputs fail before state mutation. Auditor does not reuse executor-generated pass files as proof.

### A2 · UX/modding/localization

Auditor opens the artifacts at normal scale, checks selection/readability, fallback and glyph/clipping evidence across all exact product tags, and confirms the tiny pack has no absolute path, copied retail data or undeclared custom asset. Vanilla profile resolution is explicit; the auditor does not accept a locale based only on the executor's coverage report.

### A3 · Integration

Auditor performs §9 exactly with actual retail paths in Arena and records exact commands, rc, relevant logs, hashes and artifact paths. A skipped tactical launch, test hook that kills units, injected result or mocked asset provider is failure for the final criterion.

## 9. Final oracle of the mission

On one accepted SHA, from a clean checkout in Arena:

1. Verify exact OpenBFME pin and clean source tree.
2. Configure/build the C++ GDExtension and focused tests.
3. Validate/generate the catalogs; enumerate the exact eight tags, prove English per-message fallback and compare canonical hashes for the same fixture under every locale.
4. Set `BFME2_INSTALL` and `ROTWK_INSTALL` to validated retail trees; retail archive validation passes.
5. Launch the automated WOTR Remaster fixture through Godot/OpenBFME.
6. Observe and artifact the initial three-cell map in English plus assigned locale layout/glyph evidence.
7. Submit movement through the ordinary command API and reach one conflict.
8. Start a real tactical map through OpenBFME with request checksum logged.
9. Complete the tactical battle through an accepted deterministic test scenario that still runs native tactical logic; capture a native full result. A hand-authored result is forbidden.
10. Apply result once; second apply is rejected and leaves the hash unchanged.
11. Return to the map; artifact shows the changed surviving force/ownership.
12. Save, load in a fresh process and prove byte-identical canonical state/hash.
13. Run the selected upstream regressions and all WOTR-1.1 tests with `fail 0`.

Acceptance record includes:

- BASE_SHA, HEAD_SHA and merge SHA;
- upstream tag/commit;
- declared and actual `build`/`retail` tier per card; hydration manifest SHA/volume count when used;
- exact commands and return codes;
- request/result/state/save hashes, including the locale-invariance comparison;
- catalog coverage/generated reports and exact locale tags;
- C++/Godot test summaries;
- initial/final visual artifact paths and independent locale/UX descriptions;
- list of any `not run` items. Any required item marked `not run` means `rework`.

## 10. Scope

### Allowed by cards

- `OPENBFME_UPSTREAM` and sync tooling/report for K1;
- imported upstream source and required license/notice files for K1;
- `engine/src/GameLogic/WotrRemaster/**` and focused tests for K2;
- narrow OpenBFME/Godot adapter points named by K3;
- `godot/wotr_remaster/**` for K4;
- `tools/l10n/catalog/**`, generated catalog outputs and narrow locale runtime/tests for K5;
- `campaigns/schema/**`, `campaigns/fixtures/wotr_1_1/**` for the tiny pack;
- additive test/evidence documents explicitly named by audit cards.

### Path owners (machine-readable zones)

Every token of a card `Scope` is compared with the «Зона записи» of its addressee before
issuance, so an allowed path has to be owned by a role and a zone has to be readable by
a machine. The rules below are normative for slicing.

- «Зона записи» in «Роли» is a plain list of glob paths — one pattern per line, no
  prose. Description, exclusions and read-only notes belong to «Гейт».
- `Scope` names repository paths only. A `§` reference, a section number, a commit SHA
  or any other token that is not a path stays out of `Scope` and goes to
  `Намерение`/`Acceptance`; a card that writes nothing to the repository (`B0`) keeps
  `Scope` free of path tokens and sends its artifact to Drive `Arena/wotr-remaster/artifacts`.
- Each `Scope` path is matched by the zone of the role the card is issued to; a path
  owned by a neighbour is issued to that neighbour as a separate card.
- A pattern needs `*` or `/`: a bare file name (`OPENBFME_UPSTREAM`) is neither a zone
  pattern nor a checked path, so the gate ignores it on both sides. That is expected,
  not a loophole — read-only boundaries stay in `§10` prose and in «Гейт».
- A lane registers its own sources and tests in its own include file `engine/cmake/<lane>.cmake`;
  every role may touch `engine/CMakeLists.txt` only to add that one `include(cmake/<lane>.cmake)`
  line — the path is in its zone for that single line, and the gate reads no prose exemption. Editing another lane's include file — and any vendored list such as
  `engine/cmake/Wotr1.cmake` or `engine/cmake/Bridge1.cmake`, imported in `e0cd899` and
  merged three-way by `tools/arena/sync_upstream.sh` — belongs to the owner named in its row,
  never to the newcomer (WOTR-D-022).
- The card's report is committed under `docs/evidence/WOTR-1-1/<card>/**` by the role that
  executes the card, and the registry field «Report SHA» names that repository path. A report
  that lives only in a sandbox tree or only in Drive is not acceptance evidence (cost-gates §7).

| Path | Owning role row | Cards |
|---|---|---|
| `OPENBFME_UPSTREAM`, `tools/arena/**`, `docs/UPSTREAM_SYNC.md`, `docs/evidence/WOTR-1-1/K1/**` | Upstream Integrator | K1 |
| `engine/src/GameLogic/WotrRemaster/**`, `engine/tests/WotrRemaster/**`, `campaigns/schema/**`, `campaigns/fixtures/wotr_1_1/**`, `docs/evidence/WOTR-1-1/K2/**` | Strategic Core Engineer | K2 |
| `engine/src/GameLogic/WotrRemaster/Bridge/**`, `engine/tests/WotrRemaster/Bridge/**`, `engine/CMakeLists.txt`, `engine/cmake/WotrRemaster1.cmake`, `docs/evidence/WOTR-1-1/K3/**` | Tactical Bridge Engineer | K3 |
| `godot/wotr_remaster/**`, `docs/evidence/WOTR-1-1/K4/**` | Godot World Engineer | K4 |
| `tools/l10n/**`, `godot/wotr_remaster/l10n/**`, `docs/evidence/WOTR-1-1/K5/**` | Localization & Cultural QA Engineer | K5 |
| `docs/evidence/WOTR-1-1/A1/**` | Determinism & Save Auditor | A1 |
| `docs/evidence/WOTR-1-1/A2/**` | UX & Modding Auditor | A2 |
| `docs/evidence/WOTR-1-1/A3/**` | Integration Auditor | A3, `B0` (read-only, no repo writes) |

A nested zone (`…/Bridge/**` inside `WotrRemaster/**`, `…/l10n/**` inside
`godot/wotr_remaster/**`) is not a licence for parallel work: the dependency graph of
`§7` keeps K3 after K2 and K5 after K4. `B0` reports per item `ready-now`,
`future-card-ready` or `blocked`, and names any path of this table that no active role
row owns; such a row is corrected in «Роли» by decision of приёмка, not by an executor.

### Read-only or forbidden

- `BFME2/**`, `RotWK/**` and retail binaries;
- `tools/script-cat/**` and relay files;
- unrelated OpenBFME parity code;
- existing tests/oracles except additive wiring required by the card;
- `Creative36711/wotr` runtime or full authored dataset; ADR-002 importer work is assigned to phase 2 and remains license-gated;
- systems assigned to later phases.

## 11. Not in this mission

Full Middle-earth map/importer, production art, economy/recruitment depth, narrative events, diplomacy, deep AI, multiplayer, mod discovery UI, retail Living World parity and balance. This mission proves exact-tag catalogs/fallback/hash safety for all product locales; claiming every existing string production-ready still requires 100% translation plus native/cultural and target-font review under ADR-003.

## 12. Allowed freedom

Choice of canonical binary format, hash algorithm, exact C++ namespace decomposition, tiny-map geometry and Godot rendering primitive is free if all invariants/oracles pass and the choice is documented. Dependency additions, public schema changes, changes to OpenBFME faithful behavior or a reduced battle result require ADR.

## 13. Rollback

The feature remains behind an explicit WOTR Remaster route until acceptance. Rollback removes the route, `WotrRemaster` modules and fixture without modifying retail data or ordinary OpenBFME saves. WOTR saves carry a distinct magic/version and are never opened as ordinary OpenBFME saves.
