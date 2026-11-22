# Agent tools

Use repository scripts before ad-hoc commands.

- ScriptCat build/check: `node tools/script-cat/build.mjs [--check]` — in `Creative36711/relay-wotr`; the
  transport is no longer built from this repository.
- Portability: `node tools/script-cat/portability-guard.mjs` (same repository).
- Transport tests: `npm run verify:scriptcat` in `Creative36711/relay-wotr`.
- PR preflight: `node tools/script-cat/preflight.mjs --zone "<paths>"` in the repository that owns the paths.
- Upstream pin: `OPENBFME_UPSTREAM`; sync is an Upstream Integrator (Executor) card.
- Cost selection: `docs/agents/cost-gates.md`; declare `build` and `retail` tiers before expensive work.
- Retail BIG transfer: `tools/retail_big_transfer.py`; byte-exact, canary-first and only with `retail: hydrate`.
- GitHub facts: `git` locally and `gh` for PR/check state.
- UI/art contract: `docs/tooling/ART-PIPELINE.md`; generated art belongs to a Technical Artist Scope, while Godot layout/integration belongs to Godot World Engineer.
- Pinned art environment: `tools/arena/bootstrap.sh --art`.
- Strict green-screen cutout: `/tmp/mediaenv/bin/cutout-chromakey input.png output.png --mode auto --crop`.
- Arena image generation: use only the named per-card budget (currently at most 10 images per turn), one standalone image per result; never commit unselected candidates.

Do not install a heavy tool manually in `/tmp` and call it reproducible. A required tool is pinned by version/hash and installed through a repository script or the accepted OpenBFME build instructions. Do not reveal credentials in commands or reports.
