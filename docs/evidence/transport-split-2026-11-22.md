# Transport split · ScriptCat moved to `Creative36711/relay-wotr`

Date: 2026-11-22 · Decision: `WOTR-D-024` · Instruction source: `WARDEN-SCRIPTCAT-MIGRATION.md` in `relay-wotr`

## What the split is

The transport implementation and its release wiring are no longer part of the product tree. Open BFME keeps the
operational layer: missions, role registry, regulation, phase plan, acceptance artifacts, and the authority to write
transport assignments and acceptance criteria. `Creative36711/relay-wotr` is the technical source: ScriptCat sources,
generated bundle, Drive gateway, profile template, transport tests and transport docs.

The transfer was a file snapshot, not a subtree: it preserves content, not history.

## Removed from Open BFME (this PR)

| Path | Extent | Where it went |
|---|---|---|
| `tools/script-cat/**` | 227 tracked files (≈6.4 MiB: `src/`, `relay.user.js`, tests, regression suites, contracts, gateway, profile, dev docs, upstream fixtures) | `relay-wotr:tools/script-cat/**` |
| `tools/relay-build.mjs`, `tools/relay-watchdog.mjs` | 2 files, referenced only by the aliases below and by `docs/agents/**` | `relay-wotr:tools/**` |
| `package.json` scripts `scriptcat:build/check/guard`, `test:scriptcat*`, `verify:scriptcat`, `verify:scriptcat:node`, `test` | the whole `scripts` block was ScriptCat-only; no other project script or dependency existed, so the manifest keeps only identity metadata | `relay-wotr:package.json` |
| `docs/scriptcat-update.md` | release-notes document of the bundle, read by the transport's portability guard | `relay-wotr:docs/scriptcat-update.md` |

No CI workflow ran a ScriptCat job: `.github/workflows/**` was searched for `script-cat`, `scriptcat`, `relay-build`
and `relay.user.js` and matched only one prose comment, which was re-pointed rather than deleted.

## Retained deliberately

- `docs/evidence/scriptcat-1.16.2 … 1.16.8` — accepted release records. Frozen, each given a four-line archive note
  saying that the named paths are read against `relay-wotr`.
- `docs/agents/**` — operational guides that the transport's own tests bind (`docs-smoke.mjs` asserts on
  `markers.md`, `protocol.md`, `roles/executor.md`, `pr-rules.md` and on `existsSync('docs/agents/<file>')`, and
  requires `docs/agents/troubleshooting.md` to exist). Edits were limited to path redirects; process sentences were
  not touched, and the WOTR-1.1 gate stayed green.
- `docs/REGULATION.md` / `docs/regulation-digest.md` — the regulation names `relay-wotr` as the transport's home and
  records the sync duty (§1 note): the bundle embeds the digest copied from this repository, so a regulation change
  needs a sync commit and a rebuild on the transport side.
- Project-side identifiers agents need to run Warden: `docs/setup/notion-ids.md` keeps the four data-source IDs and
  the secret-free rule; only the import-file path was re-pointed.
- `docs/missions/WOTR-1.1.md` — the read-only list now states that transport files are out of this tree entirely,
  so no card of this mission may reinstate them.

## Classification evidence (the search required by the migration doc)

```
git grep -lI -e ScriptCat -e script-cat -e relay.user.js -e relay-build -e relay-watchdog -e verify:scriptcat
  → 87 / 46 / 150 / 14 / 13 / 19 files
```

- transport wiring → deleted: `tools/script-cat/**`, `tools/relay-build.mjs`, `tools/relay-watchdog.mjs`,
  `docs/scriptcat-update.md`, `package.json` aliases.
- operational documentation → retained, links re-pointed: `AGENTS.md`, `README.md`, `docs/ARCHITECTURE.md`,
  `docs/REGULATION.md`, `docs/regulation-digest.md`, `docs/RELEASE.md`, `docs/agents/{tools,protocol,pr-rules,
  acceptance-report,troubleshooting,cost-gates,notion,markers,drive,onboarding}.md`,
  `docs/agents/roles/{transport-maintainer,executor}.md`, `docs/missions/WOTR-1.1.md`, `docs/setup/notion-ids.md`,
  `.github/workflows/pr.yml` (comment), `tools/release/pr_audit.py` (docstring).
- false positives, left alone: `docs/MACOS.md:259-260` matches `relay-build` because it is the CMake build directory
  of `services/online/relay` — an engine artifact, not transport; `tools/release/autorelease.sh:1056` names its own
  `STEP=preflight`, unrelated to `tools/script-cat/preflight.mjs`.

## State of the receiving repository at the time of cleanup

| Fact | Value |
|---|---|
| Transport import | `relay-wotr` PR #1 `Move ScriptCat transport into relay-wotr`, MERGED 2026-11-22T08:39:14Z |
| Imported files | 259 (`tools/script-cat/**`, `tools/relay-*.mjs`, copied `docs/**`, README, package.json) |
| Bundle identity | `relay.user.js` SHA-256 `77ca0fcc7fe9ff4e8503c4d0dd352641abf026b1211508c76a5e5ddc54b97914` — byte-identical to the accepted 1.16.8 release in `main@54e30c2` |
| `@version` / `SCRIPT_VERSION` in the new repo | `1.16.8` |
| Local gate in `relay-wotr` | `scriptcat:guard` ok; `test:scriptcat` 179/179; `test:scriptcat:tool-limit` 2/2 |
| `npm run scriptcat:check` at import | **red**: `relay.user.js устарел` |

The red check is an import defect, not a code difference: `src/08-projects-ui.js` and `src/12-notion.js` were
written without the trailing blank line the source tree carries, so the re-concatenated source differs from the
committed bundle by exactly those newlines. Adding one `\n` to the end of each file makes
`node tools/script-cat/build.mjs --check` report `ScriptCat bundle соответствует 45 исходным файлам.` and turns
`regression-tests/scriptcat-build-integration.mjs` green; with both fixes `npm run verify:scriptcat` in `relay-wotr`
is fully green (`179/179`, `22/22`, `2/2`, rc 0) without touching the bundle bytes, so no version bump is required.
`git push` to `relay-wotr` from this sandbox is denied (403 for `Creative36711`), so the patch is handed over in the
PR body of this cleanup rather than pushed. `relay-wotr` has no `.github/workflows/**`, so its gate is local-only
until a runner workflow is added there.

## Owner-approval steps not taken by this PR

Migration steps 2–5 are deliberately left to the owner, because they touch a live installation and the cycle:

- pausing the ScriptCat cycle and recording in-flight `dispatch_id`/`run_id`;
- installing the bundle from `relay-wotr` (Raw view), keeping the old entry as backup, never two copies on one profile;
- editing the existing profile to add `Creative36711/relay-wotr` as a secondary repo and the route
  `41e6f0cf-5705-815f-9b37-e533c4ccad21` → `relay-wotr`, keeping `open-bfme` as the project target;
- a controlled smoke/pilot on live data with evidence. Until that is accepted, the cycle stays held, and no installed
  version is changed by this repository.

## Gates for this cleanup

| Command | rc | Output |
|---|---|---|
| `python3 tools/precommit.py` | 0 | commit gate over the staged cleanup |
| `python3 tools/release/pr_audit.py --base 'HEAD^1'` | 0 | `PR AUDIT ok: <tree> (4480 files; 0 findings of this tree)` |
| `python3 -m pytest tools/release/test_community_prs.py` | 0 | `103 passed` (the workflow-policy tests parse the edited `.github/workflows/pr.yml`) |
| `npm run scriptcat:check` (before deletion) | 0 | bundle matched 45 sources; the tree being deleted was self-consistent |
| `node --test tools/script-cat/tests/*.mjs` (before deletion) | 0 | 179/179 — the copy that was transferred is the accepted, green one |

The Python tooling suite under `tools/` was run after the deletion, because its subject is exactly the state the
cleanup leaves behind:

```
python3 -m pytest tools/ -n 2      →  8 failed, 1968 passed, 945 skipped, 16 errors, 94 subtests (1656 s)
python3 -m pytest <the same 5 files> at the base commit 54e30c2 (a worktree)
                                   →  8 failed, 44 passed, 3 skipped, 15 errors + 1 collection error
```

The failing set is identical in both trees and lives in `tools/re`, `tools/save`, `tools/audio`,
`tools/release/test_nightly.py`: missing `relib` import, absent `lame`/fixture tooling, and a `gh`-dependent credits
test — sandbox environment, not this cleanup. CI reports 11/11 on the cleanup head, where the same suite runs in the
`gate` job.
