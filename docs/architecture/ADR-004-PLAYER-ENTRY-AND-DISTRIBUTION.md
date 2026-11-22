# ADR-004: WOTR player entry and distribution

- Status: accepted
- Date: 2026-11-20
- Decision: adapt the existing OpenBFME launcher and one-archive pipeline as a WOTR product flavor
- Depends on: ADR-001, ADR-003

## Context

The repository already contains a mature Godot launcher, signed-manifest updater,
retail-file discovery/download flow and one-archive packaging. The imported
OpenBFME build also contains a retail-faithful War of the Ring route, but that
route is not the new `WotrRemaster` core or a WOTR Remaster player product.

A source-checkout oracle is sufficient for engine integration but not for a
normal player. A supported player must not install CMake/Godot, set environment
variables or discover a developer command line merely to reach the strategic
map. Conversely, distributing the pinned upstream launcher binary unchanged
would retain OpenBFME branding, update identity, data directories and a generic
Play route. A second updater would duplicate security-sensitive code.

## Decision

### Reuse, do not duplicate

WOTR Remaster reuses and adapts the launcher under `launcher/**` and the
one-archive pipeline under `tools/release/**`. It does not ship an unchanged
upstream launcher binary and does not create an independent updater.

The product package contains two programs:

1. a small WOTR-branded launcher/updater;
2. one native game build containing the Godot strategic presentation,
   `WotrRemaster` core and OpenBFME tactical runtime.

Strategic and tactical play are modes of that one game process. The launcher is
not a second game, and no retail RotWK executable, Tauri process, OCR or window
automation participates in the battle transition.

### Player route

The supported first-run path is:

```text
one platform archive
→ unpack into a writable folder
→ start WOTR Remaster Launcher
→ detect, select or obtain supported BFME2 1.06 + RotWK 2.01 files
→ Play WOTR Remaster
→ WOTR product entry/main menu
→ strategic map
→ native tactical battle
→ return to the same campaign
```

No developer CLI, editor, build tool or environment variable is part of this
path. Starting the packaged game directly remains supported and reaches the
same WOTR product entry; it may hand update checking to the signed companion
launcher as the existing one-archive protocol does.

### Product and trust identity

A WOTR package is rebuilt from an accepted WOTR commit. It has:

- WOTR Remaster product name, iconography and player-facing text;
- an explicit route such as a typed startup option or product entry contract,
  owned by the game rather than simulated UI clicks;
- the approved WOTR release repository/channel and manifest identity;
- WOTR release/nightly public keys selected by the release policy;
- distinct launcher update data, logs, settings and WOTR saves from an upstream
  OpenBFME installation, with any import explicit and reversible;
- signed payload inventory and the existing fail-closed verification rules.

The exact executable/archive names are implementation details, but a player
must not have to infer that an `OpenBFME`-named binary is WOTR Remaster. An
upstream OpenBFME launcher must never silently update a WOTR installation, and
a WOTR launcher must never replace an upstream installation.

### Retail and offline behavior

Retail BFME2/RotWK data remains user-supplied, read-only and absent from product
archives and Git history. Existing discovery, validation and optional external
acquisition mechanisms may be reused only with their provenance/terms and
clear diagnostics preserved.

Once a valid bundled version and retail installation are present, network or
update-service failure does not block Play. Updates may be staged for the next
start; an invalid signature, wrong repository identity or modified package is
refused by name.

### Platform and release claims

Every published asset is one unpackable archive for one declared platform. A
platform is called supported only after its fresh-profile player oracle passes
on that platform. Phase 1 may publish an internal playtest for a smaller,
explicit matrix; untested platforms are not implied by source-level support.

Large build artifacts and retail files are never committed. Public publication
also requires a clean all-ref retail-history audit, approved signing policy,
license/provenance gates and the release checklist. Internal package evidence
does not waive those blockers.

## Mission boundary

`WOTR-1.1` proves the native game route from a clean checkout. The dependent
mission `WOTR-1.2` is intended to prove the launcher, one-archive package and
ordinary-player first run, but accepted WOTR-1.1 only removes its dependency;
it does not start preparation. A separate future decision is required. If that
decision starts WOTR-1.2, its B0 oracle rehearsal precedes any Coordinator-created
implementation/audit cards.

## Consequences

### Positive

- reuses battle-tested update, manifest, package-audit and retail-file code;
- gives a non-developer a short, testable path to WOTR;
- keeps strategic/tactical state in one process;
- prevents WOTR and upstream OpenBFME installations from corrupting each other;
- makes player packaging an early Phase-1 acceptance result rather than an
  unspecified late release task.

### Costs

- launcher branding, localization, user-directory migration and route wiring
  need explicit implementation and independent UX/security audit;
- release repository, channels and signing keys are product identity and need
  owner-approved provisioning;
- each claimed platform needs a real fresh-profile package test;
- public packages remain blocked until retail-history and licensing gates pass.

## Rejected alternatives

- **Ship the pinned upstream launcher binary unchanged:** rejected because its
  branding, update identity, data directories and default route are not WOTR.
- **Build a second WOTR updater:** rejected because it duplicates the most
  security-sensitive part of the distribution stack.
- **Developer commands only:** rejected because source-checkout execution is not
  a player installation path.
- **Launch a separate strategy application around retail RotWK:** rejected by
  ADR-001; it restores external-process lifecycle and incomplete result capture.

## Rollback

Before a public WOTR release, remove the product flavor and startup route while
leaving the generic OpenBFME launcher/package code intact. WOTR user data is in
a distinct directory, so rollback does not mutate upstream OpenBFME settings or
retail files.
