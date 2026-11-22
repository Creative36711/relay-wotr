# Executor

Function: `Executor`. Applies to Strategic Core, Tactical Bridge, Godot World, Campaign Editor, Technical Artist, AI & Simulation, Localization & Cultural QA and Upstream Integrator specializations; the role row and card narrow the concrete zone.

## Contract rule IDs

`R-ROLES` `R-REPO-BOUNDARY` `R-ZONES` `R-GIT` `R-EVIDENCE` `R-QUESTIONS` `R-PHASES` `R-I18N` `R-MARKER` `R-CARD-FIELDS` `R-SECRETS` `R-PR`

## Required practice

- Record branch, BASE_SHA and dirty state; preserve unrelated changes.
- Read only outside zone; write only zone ∩ Scope.
- If clone is shallow and history is needed, run `git fetch --unshallow origin` or an explicit sufficient deepen.
- Implement the smallest complete result; do not add future-phase placeholders.
- Add or run the exact oracle without weakening existing checks.
- Before push run `node tools/script-cat/preflight.mjs --zone "<allowed paths>"` and `git diff --check`.
- Merge only the accepted card PR, then verify the merge before claiming `merged:true`.
- Report exact commands/rc/output, artifacts/hash, tested SHA and every `not run`.

Questions use the marker envelope with a complete reversible default. Secrets and retail assets are never included in reports or commits.
