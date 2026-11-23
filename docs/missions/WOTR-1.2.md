# WOTR-1.2 · Player entry and portable playtest package

Specification version: **1.0** · Phase: **1** · Status: **draft** · Date: 2026-11-20.

Normative decisions: [ADR-001](../architecture/ADR-001-GODOT-NATIVE-WOTR.md),
[ADR-003](../architecture/ADR-003-PRODUCT-LOCALES.md),
[ADR-004](../architecture/ADR-004-PLAYER-ENTRY-AND-DISTRIBUTION.md).

## 1. Dependency and start gate

Preparing this mission requires both an accepted `WOTR-1.1` on an integrated
`main` SHA and a separate future decision that explicitly starts WOTR-1.2
preparation. Acceptance of WOTR-1.1 is necessary but not sufficient and must
not automatically create a request card. The mission consumes the accepted
explicit WOTR route and native strategy → tactical → strategy round-trip; it
does not redesign those systems.

Until that separate decision, no WOTR-1.2 request card exists, including B0,
and no preparation or implementation work starts. Once preparation is
separately authorized, the assistant creates `WOTR-1.2-B0` as the first card.
Before any implementation or audit card is created, B0 must be `Accepted`. It
is read-only with `build: none`, `retail: none` and names every command/action,
platform, prerequisite, expected observable, negative case and evidence path
needed by this specification. Only the Coordinator creates the remaining
cards.

## 2. Intent

Turn the accepted WOTR walking skeleton into an unpackable playtest that a
person without development tools can start through a WOTR-branded launcher.
Reuse the existing launcher/update/package security model; do not ship an
unchanged upstream binary or create another updater.

The accepted result is a player journey, not merely a successful export:

```text
download one archive
→ unpack
→ open WOTR Remaster Launcher
→ detect/choose validated retail files
→ Play WOTR Remaster
→ strategic map
→ real OpenBFME tactical battle
→ return and save
```

## 3. Invariants

- **INV-1 One game runtime.** Strategy and tactical play remain in one native
  game process. Only the launcher/updater is a separate utility process.
- **INV-2 Existing updater.** Adapt `launcher/**` and `tools/release/**`; no
  second download/update implementation and no unchanged upstream launcher
  binary.
- **INV-3 No developer path.** The supported player flow requires no source
  checkout, terminal, CMake, Godot editor, environment variables or hidden
  command-line knowledge.
- **INV-4 Explicit entry.** Play and direct packaged-game start reach the WOTR
  product entry through a typed route/default, never coordinate clicks or menu
  timing automation.
- **INV-5 Product isolation.** WOTR update data, settings, logs and saves do not
  collide with an upstream OpenBFME installation. Migration/import is explicit,
  previewed and reversible.
- **INV-6 Trust identity.** Repository/channel, manifest identity and public
  keys are WOTR release inputs. Wrong-repository, wrong-key, modified, missing
  or extra package content fails closed with a player-facing diagnosis.
- **INV-7 One archive.** Each claimed platform has one unpackable archive with
  the game and launcher together. Launcher-only compatibility assets are not
  published unless an accepted migration requirement proves they are needed.
- **INV-8 Retail boundary.** BFME2/RotWK remains user-supplied and read-only.
  Product archives, manifests and Git history contain no retail payload.
- **INV-9 Offline play.** With a valid bundled game and retail installation,
  network/update failure does not block Play. A newer version is staged for a
  later start, not substituted mid-session.
- **INV-10 Exact locales.** Launcher, first-run, product entry and failures use
  stable IDs for the product set `en`, `ru`, `de`, `fr`, `es`, `it`
  (`WOTR-D-032`; the community tier is out of scope for this mission), with
  English per-message fallback and no locale effect on canonical state.
- **INV-11 Honest platform claim.** A platform is supported only after a real
  fresh-profile oracle on that platform. Source compatibility is not a claim.
- **INV-12 Publication blockers.** Internal package acceptance does not permit
  public publication before all-ref retail-history audit, signing, license and
  release gates pass.
- **INV-13 Cost discipline.** Full packages and retail hydration run only on
  cards and platforms named by the accepted B0 matrix. Repeated full builds are
  reused by hash where the release contract permits.

## 4. Required player behavior

### 4.1 Archive and first start

- Archive name and top-level presentation identify WOTR Remaster.
- Unpack into a writable folder; no installer or administrator access is
  required for the portable playtest.
- Launcher and direct game start both work from paths containing spaces and
  non-ASCII characters supported by the platform.
- First run finds supported BFME2 1.06 and RotWK 2.01 installations using the
  existing discovery rules, shows what was found and allows an ordinary folder
  picker when discovery fails.
- Unsupported/mixed retail layouts fail before campaign mutation and name the
  offending requirement without exposing the user's absolute path in copied
  diagnostics.

### 4.2 Play route

- Primary launcher action is **Play WOTR Remaster**.
- It opens a WOTR product entry/main menu, not a generic OpenBFME screen that
  requires the player to discover a hidden route.
- The accepted WOTR-1.1 fixture can start, enter a real tactical battle, return
  to the campaign and save/load without launching retail RotWK separately.
- Starting the game executable directly reaches the same product entry and
  keeps the existing signed companion-launcher update handoff bounded.

### 4.3 Updates and coexistence

- Bundled version starts offline.
- Background update failure is visible but non-blocking; invalid signatures and
  package tampering are blocking.
- WOTR and upstream OpenBFME can coexist on the same user account. Installing,
  updating, resetting or uninstalling one leaves the other's program data,
  settings and saves unchanged.
- Logs and **Copy details** redact home/user paths and never contain secrets.

### 4.4 Presentation

Launcher/product entry must follow `docs/tooling/ART-PIPELINE.md`: structural
Godot controls, keyboard/controller focus, scalable text and accessible states.
Any generated raster art is a separately scoped Technical Artist artifact with
provenance and the declared 0–10 image budget; text and hitboxes are not baked
into images.

## 5. Coordinator slicing constraints

After B0 is accepted, the Coordinator creates the minimum cards needed to cover
these ownership boundaries. Exact card count is free; combining unrelated write
zones or self-audit is not.

| Boundary | Primary owner | Minimum gate |
|---|---|---|
| product flavor, WOTR startup route, data/save isolation | Godot World Engineer or narrow launcher Executor chosen from the active roster | focused launcher/game tests; no retail by default |
| package/update repository, manifests, keys-as-input and audit rules | Upstream Integrator as Executor or other explicitly assigned release Executor | focused first, one approved full package build |
| first-run retail discovery and player documentation | Tactical Bridge/Godot owner by actual touched paths | synthetic discovery negatives; retail only at final player path |
| eight-locale launcher/first-run catalogs and layouts | Localization & Cultural QA Engineer | catalog/fallback/rendering checks |
| optional visual assets | Technical Artist | named assets/provenance/opened render |
| fresh-profile player journey | Integration Auditor | independent unpack/start/round-trip |
| launcher UX, accessibility and coexistence | UX & Modding Auditor | opened UI and destructive-boundary negatives |
| package trust/reproducibility | independent Auditor named by Coordinator | manifest/tamper/rebuild evidence |

No implementation card may broaden `WOTR-1.1` canonical simulation or copy
retail data to solve packaging.

## 6. Cost gates

- B0 and static contract work: `build: none`, `retail: none`.
- Focused launcher/Godot/package tests: `build: focused`, `retail: none`.
- Discovery integration may use `retail: reuse`; `hydrate` only when B0 proves no
  verified copy is available and the card explicitly authorizes it.
- Exactly the final package-producing/integration boundaries use `build: full`.
  A card names the platform and whether its output is reused by auditors.
- A new full build is not justified merely to regenerate screenshots or rerun a
  static manifest check.

## 7. Final oracle

On one accepted integrated SHA and each platform claimed by this mission:

1. Prove clean source, accepted `WOTR-1.1`, exact product version/commit and the
   declared platform matrix.
2. Build/package through the repository's normal audited pipeline with the WOTR
   product/repository/trust inputs; record commands, rc, tool versions and hash.
3. Audit the unpacked tree and archive: only allowlisted product files, no retail
   content, no secrets, no unexpected executable/archive/container payload.
4. From a fresh OS user/profile, unpack into a writable path containing a space;
   do not install development tools or set product environment variables.
5. Start WOTR Remaster Launcher and artifact the WOTR identity, locale, focus
   order and primary Play action at normal scale.
6. Exercise both retail outcomes: valid automatic discovery/confirmation and a
   deterministic missing/invalid-layout diagnosis with ordinary folder choice.
7. Press **Play WOTR Remaster**. Observe the WOTR product entry and accepted
   strategic fixture without scripted UI clicks.
8. Complete one native tactical battle and return to changed campaign state;
   save, close, start again through the launcher and load the same canonical
   state/hash.
9. Disconnect the update service and prove the bundled version still starts.
10. Serve a newer valid test release and prove it is staged for the next start;
    prove wrong repository/key/signature, tampered payload and extra/missing
    file cases are refused by name.
11. Install/run upstream OpenBFME beside WOTR and prove each product's update
    data, settings and saves remain unchanged by the other's start/update/reset.
12. Start the packaged game directly and prove the bounded signed-launcher
    handoff reaches the same WOTR entry or safely continues with the bundled
    version according to the accepted protocol.
13. Repeat catalog/fallback and target-layout checks for all eight exact locale
    tags; compare canonical campaign/request/result/save hashes with English.
14. Run selected upstream launcher/one-archive regressions and all WOTR-1.2
    tests with `fail 0`.

Any required line marked `not run`, any developer-only substitute, a mocked
battle, or a platform called supported without its own fresh-profile run is
`rework`.

## 8. Acceptance record

Record:

- BASE_SHA, HEAD_SHA and merge SHA; accepted WOTR-1.1 SHA;
- product version, platform/architecture and support claim;
- exact commands/actions, return codes and relevant logs;
- archive/payload/manifest/signature hashes and package inventory;
- launcher repository/channel/public-key fingerprints, never private keys;
- declared and actual `build`/`retail` tiers and reuse/hydration facts;
- fresh-profile evidence paths for first-run, locale/focus, retail selection,
  Play, battle return and save/load;
- offline/update/tamper/coexistence/direct-start outcomes;
- canonical state/request/result/save hashes across locale checks;
- independent auditor descriptions and every `not run` item.

## 9. Scope

### Allowed by cards

- `launcher/**` for WOTR product flavor, UI, localization and data isolation;
- `tools/release/**`, release tests and narrow workflow inputs for package
  identity, manifests and one-archive generation;
- narrow `godot/**` entry/update handoff points needed to consume the already
  accepted WOTR route;
- WOTR player/install/release documentation and focused fixtures;
- assigned localization and art paths under existing ownership rules.

### Read-only or forbidden

- canonical `WotrRemaster` rules/save/BattleRequest/BattleResult except a narrow
  accepted startup adapter defect returned to the owning mission/card;
- retail BFME2/RotWK files and private signing keys;
- public GitHub release publication, tag creation or channel promotion;
- history rewriting;
- full authored legacy dataset and license-gated content;
- unrelated OpenBFME gameplay parity.

## 10. Not in this mission

A public stable release, installer/registry integration, telemetry, store
submission, automatic migration of upstream saves, final production signing or
notarization purchase, full Middle-earth content and later-phase strategic
systems. Public alpha timing is a separate release decision after Strategic MVP
and all publication blockers.

## 11. Allowed freedom

Exact product-flavor mechanism, startup option name, portable directory names,
archive names and internal launcher scene decomposition are free if ADR-004 and
the final oracle hold. Changing update trust, user-data migration semantics,
retail acquisition terms or supported platform claims requires an ADR.

## 12. Rollback

Remove the WOTR product flavor/entry and package wiring while retaining the
upstream launcher and one-archive implementation. Because WOTR data is isolated,
rollback does not alter upstream OpenBFME settings/saves or retail files.
