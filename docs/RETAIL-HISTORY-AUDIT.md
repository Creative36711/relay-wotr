# Retail Git history audit and purge runbook

Audit date: 2026-11-20 · status: **FAIL — retail data is still reachable**.

This document separates the verified fact from the destructive remediation. Removing `BFME2/` and `RotWK/` in a later commit cleans only that commit's tree; it does not remove earlier blobs, LFS pointers or GitHub/LFS storage.

## Verified result

Remote/ref inventory at audit time:

- private repository `Creative36711/open-bfme`, default branch `main`;
- heads: `main` at `d59a6e2277f544c87e01baf7e7580b101dd067a5` and `arena/b012a89d-open-bfme` at `8a5a21805864e00faf8a9bd7b9a4bd197dac91ed`;
- no tags, pull-request refs or open/closed PRs;
- `main` tip contains **602** `BFME2/`/`RotWK/` paths; arena tip contains **0**;
- all reachable commits contain **741 distinct historical retail paths** and **414 unique retail blobs**:
  - 222 ordinary binary blobs, **1,704,122,876 Git bytes**;
  - 192 Git LFS pointer blobs, **25,245 Git bytes**, declaring **5,625,769,977 payload bytes**;
- local packed Git size after complete fetch: about 1.58 GiB; GitHub API reported repository disk usage 1,666,230 KiB.

The object count is deduplicated by Git object ID; it is intentionally different from a path/file manifest. The operational Drive snapshot has 213 BIG paths and 5,636,073,399 bytes because paths can reuse content and the historical object set contains versions outside the current snapshot.

Conclusion: **the heavy files have not been fully removed from Git history**. The arena deletion commit makes its tip clean, but inherits all old objects. `main` is worse: it still publishes the 602 paths in its current tree.

The audit cannot establish whether every declared LFS payload is still retained/billed by GitHub LFS. Pointer reachability and LFS object storage are separate. After ref rewrite, GitHub Support/account storage must be checked for LFS and cached/unreachable-object purge.

### Reproduce

Use a complete clone or mirror, never a shallow clone:

```bash
python3 tools/release/retail_history_audit.py --json
```

Exit codes: 0 clean, 1 retail found, 2 incomplete/invalid audit. The tool refuses a shallow repository unless `--allow-shallow` is supplied; that flag is diagnostic only and can never prove cleanliness.

## Why no rewrite was performed

A rewrite changes every descendant commit and requires coordinated force-push of both remote heads. It can invalidate open clones, commit links and branch-rule leases. GitHub protection/ruleset APIs returned 403 for the current integration/private-plan combination, so protection is **unknown**, not absent. The currently active Arena session is also scoped to its arena branch and may not force-push `main`.

Therefore remediation requires explicit Master authorization and an owner/dedicated repository-maintenance session allowed to update every head. It must not be mixed into a feature/docs commit.

## Authorized purge procedure

### 1. Freeze and inventory

1. Freeze pushes/merges and tell every collaborator not to push until verification ends.
2. Record `git ls-remote --heads --tags` and GitHub default branch/rulesets/environments/releases.
3. Resolve branch protection/rulesets with an owner credential/UI; temporarily permit only the coordinated rewrite if necessary.
4. Confirm no new heads/tags/PR refs appeared after this audit.
5. Prepare a pinned `git-filter-repo` installation. Git LFS CLI is needed only to inspect/prune LFS storage, not to delete pointer blobs from Git history.

### 2. Full disposable mirror and private rollback copy

```bash
git clone --mirror https://github.com/Creative36711/open-bfme.git open-bfme-purge.git
cd open-bfme-purge.git
git fsck --full
git show-ref > ../refs.before.txt
git bundle create ../open-bfme-before-purge.bundle --all
```

The bundle contains proprietary retail blobs. Keep it encrypted/access-controlled outside GitHub (for example in the owner's private retail storage), never attach it to a PR or CI artifact, and delete it after remote verification/support cleanup and the agreed rollback window.

### 3. Rewrite every published ref

From the disposable mirror:

```bash
git filter-repo --force \
  --path BFME2/ \
  --path RotWK/ \
  --invert-paths
```

Do not add `--replace-refs` or preserve backup refs in the mirror used for the clean audit: any ref pointing to old commits makes the objects reachable again. Preserve only the external encrypted bundle and `refs.before.txt`.

### 4. Prove the mirror clean before pushing

Run the audit tool from a clean source checkout against the bare mirror:

```bash
python3 /path/to/open-bfme/tools/release/retail_history_audit.py \
  --repo /path/to/open-bfme-purge.git --json

git -C /path/to/open-bfme-purge.git fsck --full
```

The audit must exit 0 with zero paths/blobs. Also run the repository public-tree audit on each rewritten head and confirm the expected source tree did not change except removal of retail roots. Record old→new SHA mapping for both heads.

### 5. Coordinated force-push

An owner maintenance session pushes **only the inventoried heads/tags**, with a lease against each old SHA. Do not use an unleased blanket force or silently create backup refs on GitHub. For the audited two-head state the conceptual operation is:

```text
refs/heads/main                       old d59a6e2… -> rewritten main
refs/heads/arena/b012a89d-open-bfme  old 8a5a218… -> rewritten arena
```

Exact commands are generated from `refs.before.txt`; abort if any remote SHA changed after the freeze. Restore branch rules immediately after both updates. This Arena branch cannot perform the `main` update itself.

### 6. Verify from the server, not the rewrite mirror

1. Make a new full mirror clone from GitHub.
2. Compare its heads/tags to the intended rewritten refs.
3. Run `retail_history_audit.py --json`; require zero.
4. Query GitHub for unexpected refs and inspect the default-branch tree.
5. Run source/document/CI gates on rewritten heads.
6. Ask GitHub Support to purge cached views/unreachable Git objects and investigate/delete orphaned LFS objects; repository disk usage may not fall immediately merely because refs moved.
7. Verify GitHub storage/billing after Support/garbage collection. Do not claim completion from local `git gc` or a clean fresh clone alone.

### 7. Re-clone policy

All existing clones are contaminated and their old refs/reflogs can reintroduce the data. Contributors must archive unpushed source patches (not branches), delete old clones/forks/CI caches, make a fresh clone and reapply only reviewed source changes. Never merge or push an old branch after the rewrite.

## Preventing recurrence

- `tools/release/pr_audit.py` and the commit gate continue to reject game files in new trees.
- `retail_history_audit.py` is the all-ref pre-release/post-rewrite gate. Both release workflows run it from a full-history checkout now, so release packaging is intentionally blocked until the one-time rewrite passes fresh-clone verification.
- Retail remains only in ignored `.retail/`/transfer storage. Drive hydration follows `docs/agents/cost-gates.md` and never uploads parts as GitHub artifacts.
