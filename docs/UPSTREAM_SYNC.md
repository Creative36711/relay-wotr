# Synchronising WOTR Remaster with OpenBFME nightly

WOTR Remaster keeps the current OpenBFME tree at the repository root and pins
its exact source commit in `OPENBFME_UPSTREAM`. It does **not** keep a nested
`upstream/` copy.

## Why the upstream commit is not a Git parent

`Creative36711/open-bfme` is an ordinary repository rather than a formal GitHub
fork. OpenBFME's historical commits reference Git LFS objects owned by the
upstream repository. Making that history a parent caused GitHub to reject a
push with `GH008` for 234 unknown LFS objects, even though the current source
tree itself contains no LFS pointers.

The repository therefore imports the current source **tree**, but not the old
commit graph. This is not a blind file copy: updates use an explicit three-way
merge with these inputs:

```text
base   = OPENBFME_UPSTREAM (previous accepted upstream SHA)
ours   = current WOTR Remaster HEAD
theirs = newly fetched OpenBFME SHA
```

That has the conflict behaviour of a normal downstream merge while keeping
unreachable historical LFS objects out of pushes.

## Pin file format

`OPENBFME_UPSTREAM` is a key=value record, not a bare SHA:

```text
# Machine-readable upstream pin for WOTR Remaster.
repository=https://github.com/Open-BFME/openbfme-godot.git
tag=v0.4.12-nightly.261118100
commit=4a8d82727c2664c381b7b1c07344881760c4765b
license=GPL-3.0
pinned_at=2026-11-20
```

`commit=` and `tag=` are one exact pair, and the sync tool enforces it:

1. `commit=` must be a 40-hex SHA and `tag=`/`repository=` must be present;
2. the fetched remote's URL must equal `repository=` (a stray remote cannot
   stand in for the pinned source);
3. `refs/tags/<tag>` on that remote must peel to exactly `commit=` before any
   merge is offered — a mismatch aborts, so the pin is never silently bumped
   or overridden locally;
4. an update rewrites only `commit=`, `tag=` (a tag that peels to the new
   commit; an untagged tip is refused) and `pinned_at=`, leaving the header,
   `repository=` and `license=` byte-identical.

`tools/arena/sync_upstream.sh --check` is the read-only verification: exit 0
means the pair is intact; it also prints the base/next SHAs, and `Already
current.` means the working tree already carries the pinned upstream commit.

## Remotes and commands

One-time local setup:

```bash
git remote add upstream https://github.com/Open-BFME/openbfme-godot.git
```

Inspect an available update without changing files:

```bash
tools/arena/sync_upstream.sh --check
```

Stage the explicit three-way tree merge:

```bash
tools/arena/sync_upstream.sh
```

The script:

1. verifies the pin (`repository=` equals the remote URL, `tag=` peels to
   `commit=`);
2. fetches `upstream/main` and the pinned tag without importing tags;
3. merges old upstream / downstream HEAD / new upstream at tree level;
4. leaves real conflicts in the index for review;
5. rejects a resulting tree containing Git LFS pointers;
6. updates `OPENBFME_UPSTREAM` only after a conflict-free merge, and only the
   `commit=`/`tag=`/`pinned_at=` lines of the key=value record;
7. stages changes but never commits or pushes automatically.

Every accepted sync records its evidence (old/new commit, upstream range,
`LICENSE`/`NOTICE` delta, each touched WOTR-owned path and every conflict
decision) as a report artifact under the Drive folder
`Arena/wotr-remaster/artifacts/`, named
`<dispatch_id>_<run_id>__<slug>.md`.

## Pin, do not float at runtime

Development may update frequently, but every build is validated against the
SHA in `OPENBFME_UPSTREAM`. Never download an unknown `main` during build or
runtime. Record the accepted SHA/tag in release notes.

## Conflict-minimising rules

1. Put new deterministic code under `engine/src/GameLogic/WotrRemaster/` and
   new presentation under `godot/wotr_remaster/` where possible.
2. Keep registration/binding edits in upstream files small and mechanical.
3. Do not reformat or rename unrelated upstream code.
4. Keep each upstream sync in its own commit, separate from WOTR features.
5. Propose generally useful, retail-faithful fixes upstream; retain intentional
   remaster rules downstream.
6. Never vendor another OpenBFME copy in a subdirectory.

## Update gate

Accept a staged update only after:

1. configure and compile core/GDExtension;
2. upstream source-only tests;
3. deterministic WOTR rule/replay/save hash tests;
4. retail archive policy check (`107/107` BFME2 and `106/106` RotWK);
5. boot/menu/strategic-map smoke test through SwiftShader;
6. one tactical setup → battle result → strategic apply round-trip;
7. save/resume and hero rank/experience persistence;
8. strategic map/HUD screenshot comparison.

After an Arena reset, group retail-dependent stages into one session rather
than restoring 5.249 GiB separately for each check.

## Automation target

A scheduled GitHub Action may report a new upstream SHA and open a sync issue or
pull request, but it must not merge nightlies automatically. The update gate and
a human review of conflicts remain required.
