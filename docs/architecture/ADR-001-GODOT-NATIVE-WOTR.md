# ADR-001: Godot-native WOTR Remaster

- Status: accepted
- Date: 2026-11-20
- Decision: Option C — a fully Godot-native War of the Ring remaster
- Engine baseline: OpenBFME `v0.4.12-nightly.261118100` (`4a8d82727c`)

## Context

The previous `Creative36711/wotr` application put a React/Tauri campaign in
front of the closed retail RotWK executable. Tactical launch and result
collection depended on Win32 window automation, coordinate clicks, timing,
screen recognition, and OCR. Those mechanisms are inherently nondeterministic,
hard to test, and unable to preserve the full tactical state reliably.

Current OpenBFME already exposes Living World state to Godot and captures a
native tactical result: winner, surviving armies and heroes, rank/experience,
upgrades, reinforcements, and destroyed buildings. It can therefore make the
strategic and tactical halves one deterministic program.

## Decision

WOTR Remaster is maintained as a downstream of the current
`Open-BFME/openbfme-godot` source tree.

- **C++ owns canonical state and rules.** Turns, movement, economy, AI,
  battle setup/result application, save migration, random streams, and hashes
  must be deterministic and testable without rendering.
- **Godot owns presentation and authoring.** The strategic map, camera,
  animation, HUD, interaction, accessibility, and map editor are scenes and
  scripts/resources.
- **OpenBFME owns tactical simulation.** Battles are started through native
  tactical setup; results return through `BattleResultCapture`, never through
  OCR or screen scraping.
- **Heroes use the normal subsystem.** A hero present in strategic state is in
  the deterministic spawn plan before map load and returns through native hero
  state. No post-load process injection or synthetic UI click is allowed.
- **The legacy Tauri app is not a runtime dependency.** Its authored world may
  be converted by the versioned one-way importer accepted in ADR-002 after the
  license/provenance gate. React, Rust Win32 automation, OCR and its state store
  do not become runtime dependencies.

## Module boundary

New work should be concentrated behind narrow, named boundaries:

```text
engine/src/GameLogic/LivingWorld/       upstream canonical Living World
engine/src/GameLogic/WotrRemaster/      downstream deterministic rules/services
engine/src/GodotDevice/                 minimal binding/adapters

godot/wotr_remaster/                    scenes, resources, shaders, editor tools
godot/scripts/wotr_remaster/            presentation/orchestration only
```

Where an existing Living World abstraction is sufficient, extend it instead of
creating a parallel campaign engine. Upstream files should receive the smallest
possible adapter changes; downstream behavior belongs in new files. This keeps
nightly merge conflicts local and reviewable.

## Determinism contract

Every strategic command is serializable and validated by C++:

```text
(previous state, command, rules version, RNG stream) -> (new state, events)
```

Required tests include:

- same command log produces the same state hash on all supported platforms;
- save/load at every phase boundary preserves the hash;
- tactical setup and captured result round-trip all hero/army fields;
- AI consumes only deterministic inputs and named random streams;
- visual nodes cannot mutate canonical state except by submitting commands.

## Consequences

### Positive

- no coordinate automation, OCR, retail-window timing, or external process
  lifecycle;
- one save format and one authoritative state;
- native solo/LAN support can build on OpenBFME networking;
- strategic visuals can use the same Godot renderer and asset loader as battle;
- upstream engine fixes and rendering improvements remain mergeable.

### Costs

- the campaign rules and UI are a real rewrite, not a wrapper migration;
- OpenBFME alpha/nightly changes require a disciplined update gate;
- a 3D strategic map needs an authored asset pipeline and performance budgets;
- save schemas and deterministic rules need versioning from the first playable
  slice.

## Rejected alternatives

- **Keep Tauri and automate retail RotWK:** rejected for nondeterminism and
  incomplete result data.
- **Godot UI with an independent strategic backend:** rejected because it would
  duplicate Living World state and create two authorities.
- **Copy OpenBFME into a nested `upstream/` directory:** rejected because it
  creates two source roots and encourages blind file replacement. The accepted
  root-level import instead pins the prior upstream SHA and performs an explicit
  three-way tree merge; see `docs/UPSTREAM_SYNC.md`. Full commit ancestry was
  attempted but GitHub rejected upstream's historical LFS ownership (`GH008`).
