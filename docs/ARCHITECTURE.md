# WOTR Remaster architecture

Статус: accepted baseline · 2026-11-20.

## 1. System context

```text
WOTR Launcher ──> one signed native game build
                       │
Campaign Pack ──> WotrRemaster deterministic core ──> canonical state/save/hash
      │                         │
      │                         ├──> Godot 2.5D map + editor (presentation/input)
      │                         │
      └─ asset/profile refs     └──> Tactical adapter
                                         │ BattleRequest
                                         v
                                OpenBFME Godot Nightly
                                + user's retail BFME2/RotWK
                                         │ BattleResult
                                         └──────────────> core apply
```

Стратегия и editor — продукт WOTR Remaster. OpenBFME — tactical runtime и retail asset provider. Интеграция остаётся нативной внутри одного game build; отдельный launcher только проверяет/обновляет/запускает этот build и не является вторым игровым runtime. JSON допустим для fixtures/debug export, но не является обязательным runtime IPC. Legacy import/capacity/custom-map contract принят в [ADR-002](architecture/ADR-002-LEGACY-WORLD-IMPORT-AND-TACTICAL-CAPACITY.md), locale baseline — в [ADR-003](architecture/ADR-003-PRODUCT-LOCALES.md), player entry и one-archive distribution — в [ADR-004](architecture/ADR-004-PLAYER-ENTRY-AND-DISTRIBUTION.md).

## 2. Upstream baseline

| Поле | Значение |
|---|---|
| Repository | `Open-BFME/openbfme-godot` |
| Profile | `v0.4.12-nightly.261118100` |
| Commit | `4a8d82727c2664c381b7b1c07344881760c4765b` |
| License | GPL-3.0 |
| Godot | 4.7 line |
| Tactical rules | C++17 GDExtension under `engine/` |
| Presentation/runtime | Godot project under `godot/` |

Pin is machine-readable in `OPENBFME_UPSTREAM`. Upstream already exposes validated WOTR tactical pieces such as `LivingWorld::BattleSetup`, `LivingWorld::BattleResult`, `BattleResultCapture`, Godot `LivingWorldGame`, retail archive policy and WOTR save/test fixtures. WOTR Remaster may adapt those tactical contracts, but does not adopt `LivingWorldLogic` as its strategic source of truth.

## 3. Target repository layout

```text
engine/
  src/GameLogic/WotrRemaster/       pure deterministic strategy
  src/GodotDevice/                  narrow Godot bindings and tactical adapter
  tests/WotrRemaster/               core, contract, save and bridge tests
godot/
  wotr_remaster/
    world/                           2.5D map and HUD
    editor/                          Campaign Pack editor
    tests/                           headless interaction/visual tests
campaigns/
  schema/                            versioned machine-readable schemas
  import/                            versioned one-way legacy importer + stable-ID mapping
  vanilla_rotwk_201/                 references/data, no copied retail assets
  fixtures/                          synthetic tiny packs
art/                                 licensed custom strategic assets only
docs/                                process, architecture, missions and ADR
launcher/                            adapted WOTR launcher/updater product flavor
tools/release/                       audited one-archive and manifest pipeline
```

Фактические пути утверждаются первой карточкой source integration; смысл границ менять нельзя.
Каталога транспорта в этом дереве нет: ScriptCat (`tools/script-cat/**`, `tools/relay-*.mjs`,
userscript-бандл и Drive-gateway) живёт в `Creative36711/relay-wotr` и остаётся защищённым —
правка только карточкой Transport Maintainer с полным transport-гейтом в том репозитории.

## 4. Deterministic core

### 4.1 State

Минимальный `CampaignState`:

- schema and simulation version;
- Campaign Pack identity and content hash;
- turn, phase and deterministic sequence counters;
- factions/players and team relations;
- regions/hex/topology identifiers;
- armies, heroes, persistent unit records and ownership;
- resources and queued actions required by the active ruleset;
- named RNG streams and their state;
- pending battle identity and lifecycle;
- accepted command log cursor.

Presentation fields, localized strings, absolute paths, timestamps and Godot object IDs are not state.

### 4.2 Commands and WEGO

Every mutation enters through a typed command:

```text
CommandEnvelope {
  schema_version,
  campaign_id,
  turn,
  player_id,
  client_sequence,
  command_id,
  payload
}
```

Pipeline: decode → structural validation → authorization → rules validation → canonical ordering → apply → events → hash. A simple AI emits the same commands as a human. No AI-only mutation API exists.

Canonical ordering must be explicit and stable: phase, initiative rule from the Campaign Pack, player ID, client sequence, command ID. Any tie-break uses a named deterministic RNG stream and records the draw purpose.

### 4.3 Serialization and hash

- Fixed field order and numeric representation.
- Collections serialized by stable key/order, never container iteration accident.
- Unknown schema version is rejected before mutation.
- Hash covers every simulation-relevant field and excludes presentation/cache fields by contract.
- Save load is transactional: parse and validate into a new state, then swap on success.

## 5. Strategic/tactical contract

### 5.1 BattleRequest

The request is immutable after launch and contains at least:

- contract version and unique battle ID;
- campaign/state hash at dispatch;
- tactical profile and map reference;
- region/terrain context used by strategic resolution;
- participants, canonical tactical-side partition, teams, human/AI assignment and deterministic tactical seed;
- selected primary/fallback map component hash, required side count and verified start capacity;
- armies and stable strategic army/member IDs;
- templates, quantities, experience/rank and persistent upgrades;
- heroes and revival/persistence metadata;
- starting resources, powers/sciences and allowed reinforcements;
- strategic buildings/objectives that tactical play may destroy;
- return policy and checksum.

The adapter maps this into OpenBFME's native start structures. The core never depends on a Godot Dictionary as its canonical representation.

Participants are partitioned by the campaign diplomacy snapshot into opposed tactical sides. Allied armies share their side's start while retaining separate army/member IDs. Real-time launch requires `side_count <= verified_usable_starts`. The core tries the location's ordered, pack-pinned compatible fallback maps; if none has capacity it emits canonical autoresolve reason `tactical_capacity_exceeded`. It never drops a participant or lets unordered local file discovery choose a map.

### 5.2 BattleResult

The result contains at least:

- contract version, battle ID, request checksum and completion reason;
- victor/draw/forfeit identity;
- each surviving strategic member with stable army/member ID, quantity, experience/rank and persistent upgrades;
- hero survival/death/revival records;
- per-player persistent sciences/upgrades/skill or power state;
- reinforcements called and never called;
- strategic buildings/objectives destroyed;
- tactical statistics needed by campaign rules;
- deterministic capture frame or equivalent tactical completion boundary;
- result checksum and explicit validation errors.

Apply is idempotent by battle ID. A result for the wrong state hash, unknown army/member, duplicate completion or incompatible contract version is rejected without partial mutation.

### 5.3 Reuse boundary

OpenBFME's `BattleResultCapture` is valuable because it captures at a deterministic end-of-frame boundary and already reads native survivors, hero records and persistent player data. The WOTR adapter may wrap it. Direct calls from Godot world UI into strategic mutation are prohibited.

## 6. Godot world and editor

The map is 2.5D: strategic coordinates/topology are data; world meshes, labels and overlays are presentation. Hex rendering may aggregate into named regions, but selection and movement validation use core IDs.

Godot responsibilities:

- render terrain, hex/region overlays, armies and routes;
- translate user gestures into command drafts;
- display validation errors and resolution events;
- launch/return from tactical runtime through the adapter;
- edit and validate Campaign Packs;
- never own the authoritative campaign state.

The editor uses commands and supports undo/redo as inverse or snapshot-safe operations. Export → reopen must produce the same canonical content hash.

## 7. Campaign Pack

A pack is versioned data with:

- manifest, ID/version, compatible engine and tactical profiles;
- topology/hex/region definitions and visual placement;
- faction/player/army/hero definitions;
- ruleset parameters, starts and objectives;
- ordered primary/fallback tactical map references;
- content-addressed custom map components with declared starts/supported sides/profile, localization IDs, license/provenance and SHA-256 manifest;
- custom asset manifest with license/provenance/hash;
- dependencies and deterministic override order;
- migration/import metadata.

Reference kinds are explicit (`retail:`, `pack:`, `custom:` or equivalent accepted schema). Absolute author-machine paths are invalid. Vanilla and mod packs pass the same validator. `pack:` maps mount as immutable overlays through `GodotRetailFileSystem`; save/network envelopes pin pack and resolved component hashes. Missing, ambiguous, changed or incompatible maps fail before launch and can only take the declared autoresolve path.

A versioned one-way importer may convert the pinned world/ownership/region/location content of `Creative36711/wotr` into this schema. It emits stable IDs, canonical bytes and a source/hash/loss report, but imports no React/Tauri/Win32/OCR runtime. Publication of generated full content or legacy BIG remains blocked until its license/provenance is authorized.

## 8. Player entry and retail boundary

WOTR adapts the existing launcher and one-archive pipeline rather than shipping an unchanged upstream binary or writing a second updater. A package contains a WOTR-branded launcher and one native game build. **Play WOTR Remaster** and direct packaged-game start reach the same typed WOTR product entry without developer commands. Launcher update data/settings/logs and WOTR saves are isolated from an upstream OpenBFME installation; repository/channel/signing identity is explicit and fail-closed. The normative route, offline behavior and support claims are ADR-004 and `docs/missions/WOTR-1.2.md`.

Retail BFME2 1.06 and RotWK 2.01 are user-supplied and read-only. OpenBFME's archive policy validates expected files by size/hash and mounts original archives in a defined order. Product tests receive locations through `BFME2_INSTALL` and `ROTWK_INSTALL` only at developer/integration layers; the accepted player path uses normal discovery/folder selection and no environment variables.

No retail binary is added by WOTR product commits, product archives or any published reachable ref. Byte-exact transfer tooling is operational support, not a content packaging mechanism. A canary part is verified before any bulk transfer. Engine build and retail hydration follow the tiered policy in `docs/agents/cost-gates.md`; retail is not a default gate for unrelated work. Public publication additionally requires a clean all-ref retail-history audit and the accepted signing/license gates.

## 9. Save envelope

```text
WotrSave {
  magic,
  envelope_version,
  engine_version,
  campaign_pack_id,
  campaign_pack_hash,
  tactical_profile,
  state_bytes,
  state_hash,
  command_cursor,
  rng_metadata,
  checksum
}
```

Mid-battle saves additionally carry immutable `BattleRequest` identity and the tactical save reference required by OpenBFME. On return, result identity must match both.

Locale is presentation state and is deliberately absent from this envelope and `state_bytes`. Required product catalogs are `en`, `ru`, `zh-Hans`, `ja`, `pt-BR`, `de`, `fr`, `ko`; English is source/per-message fallback. Campaign Pack display text uses localization IDs. Exact locale tags, completeness and cultural/rendering gates are specified by ADR-003 and `docs/L10N.md`.

## 10. Testing pyramid

1. Pure unit/property tests with tiny synthetic packs.
2. Deterministic replay and save/load dual runs.
3. Native adapter contract tests against OpenBFME types.
4. Godot headless map/editor smoke.
5. Retail tactical integration on a known map.
6. Arena end-to-end walking skeleton with screenshot/log/save/hash artifacts.
7. Fresh-profile one-archive player path: unpack → launcher → retail selection → WOTR → battle/return/save, plus offline/tamper/coexistence negatives.
8. Upstream sync gate replaying levels 1–7 affected by the pin.

The final relevant level cannot be replaced by mocks or serialized hand-written results. Levels are selected by affected boundary: static/focused checks first, a full source build for engine/ABI/upstream/package handoff, and retail only for retail-sensitive/final integration. The normative selection matrix is `docs/agents/cost-gates.md`.

## 11. Upstream synchronization

Upstream Integrator advances only the explicit pin. The report includes old/new commits, upstream commit range, file-level conflicts, local WOTR-owned paths, license/notice changes and exact gates. A sync that compiles but loses the tactical result, save hash, retail validation or Godot route is rejected.

WOTR extensions should be additive and concentrated in `WotrRemaster` paths and narrow adapters, minimizing edits to faithful OpenBFME systems. Generally useful bridge fixes should be prepared so they can be contributed upstream without exposing WOTR product policy.
