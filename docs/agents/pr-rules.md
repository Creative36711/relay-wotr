# Pull request rules

These rules apply to every role that writes `Creative36711/open-bfme`.

## Р1 · One card, one PR

A PR implements one request card and references mission/card IDs. Unrelated cleanup and opportunistic fixes are separate cards.

## Р2 · Preserve local work

Before edits record `git status --short --branch`. Never reset, clean, checkout over, stash or include another user's dirty files. Stage explicit paths only.

## Р3 · Correct history

Check `git rev-parse --is-shallow-repository` and `git merge-base HEAD origin/<base>`. If shallow and history is required, use `git fetch --unshallow origin` (or an explicit sufficient deepen) before claiming a safe diff. An empty merge-base is not proof that every file is new.

## Р4 · Fixed branch

Use only the branch supplied by Arena. Do not create/switch/rename another branch. Direct push to `main` is forbidden.

## Р5 · Zone and Scope

Diff must fit both the role zone and card Scope. A required foreign edit is returned as a new owner card, not smuggled into the PR.

## Р6 · Oracle integrity

Tests may be added, never weakened, removed, skipped or rewritten to fit the implementation. Generated files are changed only through their generator.

## Р7 · Evidence before push

Run the exact card oracle and `git diff --check`. Record command, rc, relevant output, tested SHA and artifact hash/path. `not run` is explicit and cannot be reported as pass.

## Р8 · Transport lock

`tools/script-cat/**`, `tools/relay-build.mjs` and `tools/relay-watchdog.mjs` require a Transport Maintainer card. Source changes require a version bump; `relay.user.js` is rebuilt, not hand-edited.

## Р9 · Merge claim

Create the PR against the card's target repository/base. After acceptance, the executor merges using the exact PR number and verifies state/merge commit. `merged:true` without a merged PR is a protocol violation.

## Р10 · Preflight

Before final push/merge run:

```bash
node tools/script-cat/preflight.mjs --zone "<comma-separated role/card paths>"
```

A pass must cover: non-shallow usable history, no conflict markers, only own zone, coherent decision/contract change, source/version coupling and generated bundle consistency where applicable. Network uncertainty is reported as unknown; it does not authorize bypass.

Since 1.16.6 the pass also covers the public tree audit (`tools/release/pr_audit.py --tree HEAD^{tree} --base origin/main`), because that CI step reads the whole tree the pull request would make, not its diff: a finding already in `main` is reported on every later pull request and looks like the newcomer's defect. A finding attributed to the base is not this pull request's blocker and never justifies editing another role's file (Р5); it is named to its owner with the commit that introduced it. A finding of your own tree is fixed in your own PR, before push.

## Commit shape

Commit subject is English and states the product change. Stage explicit files. Generated/build/cache/retail artifacts are not committed unless the specification names an exact fixture and license/provenance permits it.
