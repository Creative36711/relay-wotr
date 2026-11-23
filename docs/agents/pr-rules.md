# Pull request rules

These rules apply to every role that writes the project repository named in its profile.

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

`tools/script-cat/**`, `tools/relay-build.mjs` and `tools/relay-watchdog.mjs` require a Transport Maintainer
card — in `Creative36711/relay-wotr`, where those paths now live; this repository keeps no transport copy, so
adding them here is out of zone. Source changes require a version bump; `relay.user.js` is rebuilt, not hand-edited.

## Р9 · Merge claim

Create the PR against the card's target repository/base. After acceptance, the executor merges using the exact PR number and verifies state/merge commit. `merged:true` without a merged PR is a protocol violation.

## Р10 · Preflight

Before final push/merge run:

```bash
python3 tools/precommit.py                                                     # in Open BFME (this repository)
node tools/script-cat/preflight.mjs --zone "<comma-separated role/card paths>" # in relay-wotr, the transport repository
```

Open BFME has no `tools/script-cat/**`, so a product card never runs `preflight.mjs`: its equivalent fixed gate is
`python3 tools/precommit.py` plus the tree audit below. Transport cards run `preflight.mjs` in `relay-wotr`. A zone
string is a comma- or newline-separated list of globs only — prose in a zone turns into patterns that match nothing,
which is how a role's own mandatory file got declared «вне зоны».

A pass must cover: non-shallow usable history, no conflict markers, only own zone, coherent decision/contract change, source/version coupling and generated bundle consistency where applicable. Network uncertainty is reported as unknown; it does not authorize bypass.

Since 1.16.6 the pass also covers the public tree audit (`tools/release/pr_audit.py --tree HEAD^{tree} --base origin/main`), because that CI step reads the whole tree the pull request would make, not its diff: a finding already in `main` is reported on every later pull request and looks like the newcomer's defect. A finding attributed to the base is not this pull request's blocker and never justifies editing another role's file (Р5); it is named to its owner with the commit that introduced it. A finding of your own tree is fixed in your own PR, before push.

## Р11 · No transport docs mirror (D-003)

The transport repository carries **no project process documents at all**: since D-003 the former
mirror set (regulation, digest, phase plan, foreign decisions journal, missions, agent guides)
and the project profile file are deleted from its tree, and `build.mjs` takes the regulation as
an input (`--digest <path>`) instead of reading a copy. Project docs are edited in this
repository only; nothing under `docs/**` is copied into the transport.

The historical rule behind the deletion still binds: a `docs/**` glob was tried once and in a
single pull request it carried 160 changed files and 31 588 added lines of product documentation —
`docs/setup/notion-ids.md` with the Notion data-source list and the retail reverse-engineering
notes included — into a public transport repository. A set defined by name could not repeat that;
a glob could, silently. Now even the named set is gone: the transport has no docs mirror to
maintain, sync or accidentally widen.

A transport-local rule goes into a transport-only file such as `docs/scriptcat-update.md` or
`docs/DECISIONS.md`, and the rebuilt bundle hash is recorded in `docs/scriptcat-update.md`.
Adding `.github/**` to the transport follows Р10 as well: a CI checkout that cannot see
`origin/main` cannot satisfy the «non-shallow usable history» precondition of its own preflight,
so the step fetches full history (`fetch-depth: 0`) instead of turning a green tree red.

## Commit shape

Commit subject is English and states the product change. Stage explicit files. Generated/build/cache/retail artifacts are not committed unless the specification names an exact fixture and license/provenance permits it.
