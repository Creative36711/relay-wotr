# ScriptCat transport decisions

This journal contains only transport decisions using the `D-###` format. The WOTR operational journal is mirrored verbatim in `DECISIONS-UPSTREAM.md`; it is excluded from the relay-wotr docs sync recipe.

## D-001 (1.16.8) — Isolate transport CI and keep the decision gate meaningful

**Date:** 2026-11-22 · **Status:** accepted.

The relay-wotr pull-request gate is a single aggregate required check on GitHub-hosted runners, with read-only repository permissions, no secrets, pinned actions, full history and an explicit role-zone preflight. Operational WOTR decisions remain in the upstream mirror; `docs/DECISIONS.md` is reserved for transport decisions so preflight's existing `^##\s+D-\d+` matcher can enforce one new decision and its contract key without exceptions.

**Rollback:** remove the CI workflow and this decision/contract entry together; do not weaken or broaden the preflight decision matcher to accommodate mirrored WOTR decision IDs.
