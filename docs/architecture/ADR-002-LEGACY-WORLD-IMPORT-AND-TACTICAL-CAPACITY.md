# ADR-002: Legacy world import, tactical capacity and Campaign Pack maps

- **Status:** Accepted for implementation planning
- **Date:** 2026-11-20
- **Decision:** `WOTR-D-012`
- **Depends on:** [ADR-001](ADR-001-GODOT-NATIVE-WOTR.md)

## Context

`Creative36711/wotr` contains a mature strategic-world model and authored content rather than merely a UI prototype. At audited commit `fd12e3a3a52ad485f95af3ff559610fd2778570b`, its dataset has 1,412 cells, 186 locations, 24 regions, 125 domains, 61 strongholds, 13 armies and 51 locations with tactical metadata. Every one of those 51 tactical maps declares eight starts. The repository also contains a React/Tauri/Win32/OCR bridge and `__wotr_maps.big`.

Discarding the authored world would repeat costly design work. Depending on its runtime would violate ADR-001: simulation must remain a deterministic native core and tactical play must use the in-process OpenBFME adapter. The audited WOTR repository has no established publication license, so public redistribution of its dataset or custom BIG cannot be assumed.

The strategic model can put many armies into one location. RTS maps provide a finite number of start positions. Capacity is not simply the number of army stacks: allied participants can share one tactical side/start, while hostile sides require separate starts. The current OpenBFME implementation already shares starts between allies and rejects a battle with more sides than available starts; LAN WOTR deterministically demotes that battle to autoresolve.

RotWK 2.01 does not provide a suitable map for every authored location. A durable extension point must not copy retail assets into Git or let arbitrary machine paths change simulation.

## Decision 1: import the legacy world, not its runtime

Create a **versioned, one-way importer** from an explicitly pinned legacy export into the canonical Campaign Pack schema.

The importer:

1. accepts only a declared source schema/version and source commit;
2. converts locations, region/domain ownership, adjacency, strongholds, armies and tactical references;
3. assigns stable IDs derived from explicit legacy IDs; when none exists, the mapping table is checked in and append-only rather than recomputed from display names;
4. validates dangling references, duplicate IDs, topology, ownership, map references and localization IDs;
5. sorts all emitted maps/lists canonically and emits byte-stable output plus a provenance report;
6. records importer version, source repository/commit, source hashes, warnings and every lossy/defaulted field;
7. has no TypeScript, React, Tauri, WebView, OCR, mouse automation, Win32 or external retail-process dependency;
8. never imports executable code or absolute paths.

The generated pack is reviewed like source data, but public publication is blocked until the Master records a license/provenance authorization for the source material. Until then, tests use a small clean-room fixture with the same schema. `world.json` and `__wotr_maps.big` are not copied into this repository merely because they are technically reachable.

The import is one-way. After acceptance, canonical data is edited through the Campaign Pack pipeline; runtime startup does not contact or parse the legacy repository.

## Decision 2: capacity is counted by opposed tactical sides

Before creating `BattleRequest`, the strategic core deterministically partitions participants into **tactical sides** from the campaign diplomacy/alliance snapshot:

- participants allied for this battle form one side and share one start;
- hostile participants never share a start;
- stable side order is part of the canonical request (defender/owner first, then campaign side ID); filesystem/map iteration order is irrelevant;
- every army remains separately identified inside its side so survivors, heroes, experience and persistent upgrades can be returned and applied to the correct strategic stack.

Let `S` be the number of opposed tactical sides and `C` the usable starts declared by the resolved map/profile after map validation. Real-time tactical play is allowed only when `S <= C` and every other profile limit is satisfied. The number of individual allied armies may exceed `C`; their units are placed using deterministic side-local spawn allocation at the shared start.

No participant is silently dropped, merged across hostile sides, or placed on an undeclared start.

### Overflow resolution

If `S > C`, resolution is deterministic and identical in single-player and network play:

1. try the location's ordered `fallback_maps` list;
2. select the first compatible candidate whose verified metadata supports the tactical profile, all required sides and `S` starts;
3. if none qualifies, run canonical strategic autoresolve and record reason `tactical_capacity_exceeded`, the requested location/map, `required_sides`, `available_starts` and considered fallback IDs in the command/result log;
4. show a localized notice; network peers vote/replicate the same decision and never let a local file silently choose a different branch.

A fallback map changes presentation and tactical capacity, not strategic location identity. Pack hash and resolved component hashes make the choice reproducible.

## Decision 3: new tactical maps are licensed Campaign Pack components

A location uses a typed reference, never an absolute path:

```yaml
tactical:
  primary_map: "retail:RotWK/Maps/..."
  fallback_maps:
    - "pack:maps/eregion-fords/map.yaml"
```

A `pack:` map component includes:

- stable component and map IDs;
- metadata version and tactical profile compatibility;
- canonical map path/name and playable bounds;
- declared starts (stable start ID, position/orientation, allowed side constraints);
- supported side/player count and optional deterministic spawn zones around each start;
- SHA-256 for every file and a content-root hash;
- author, source/provenance and redistributable license/SPDX expression;
- localization IDs for player-facing name/description;
- optional mod override namespace that cannot mutate the Vanilla profile silently.

Pack assembly validates hashes, case-collisions, path traversal, duplicate map names, starts/capacity and license fields. The runtime mounts the immutable content-addressed overlay through `GodotRetailFileSystem` ahead of retail archives according to the explicit Campaign Pack profile. Save/network envelopes pin Campaign Pack identity/hash and resolved map component hash. A missing, changed, ambiguous or incompatible map fails before tactical launch; it may only take the declared autoresolve branch, never choose a local substitute.

Retail-derived maps and the audited legacy `__wotr_maps.big` cannot be distributed as Campaign Pack components without affirmative rights. A new clean-room or licensed map is the standard route for locations not covered by RotWK 2.01.

## Consequences

- The existing authored world remains useful without importing an obsolete runtime architecture.
- Stable IDs and provenance make migration reviewable and saves/network state durable.
- Battles with many allied armies can still use normal maps; truly multi-sided overflow is explicit and fair.
- Custom maps become reproducible, licensed overlays rather than private loose files.
- Implementation needs importer fixtures, a Campaign Pack schema/validator, deterministic side partition tests, fallback-map tests and retail map/start oracle tests.
- Publication of the full legacy dataset and custom BIG remains a Master license gate, not an engineering assumption.
