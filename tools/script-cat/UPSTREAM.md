# ScriptCat upstream provenance — non-operational

> **Provenance boundary.** This is the only file allowed to name the repository
> from which the transport snapshot was imported. That repository, its project
> names, IDs, card prefixes and product semantics are never runtime defaults,
> prompt input, current examples or WOTR authority. Structural regression
> fixtures are sanitized to neutral `CASE-*` and `fixture-*` identifiers.

## Imported snapshot

| Field | Value |
|---|---|
| Source repository (provenance only) | `Creative-textile/vault` |
| Last complete tree | `fe8ec9368fc2f5cb9a78a5cdbc47b66e30c07cf6` |
| Removal commit | `eecb68739dbb66a83a6cd9a3d0dbec9650a78ade` |
| Upstream version | `1.16.1` |
| License | MIT (`LICENSE` in this directory) |
| Imported paths | `tools/script-cat/**`, `tools/relay-build.mjs`, `tools/relay-watchdog.mjs` |

`fe8ec936…` is the parent of the commit that removed the Arena/Notion/Drive
transport and is therefore the latest full source snapshot. Earlier candidate
`63486b4d47078b90bd8466d9306b74aefbc20644` had the same runtime version but was
not final: transport/contract tests and related evidence changed before removal.

## WOTR adaptation

- `1.16.2` introduced the WOTR project profile, prompts and regulation 1.0.
- `1.16.3` embedded regulation 1.1: role classification, cost tiers and exact
  product locales.
- `1.16.4` embeds regulation 1.2, the launcher/player-package boundary and the
  mandatory B0 rehearsal rule for explicitly authorized mission preparation.
  It removes former-project names/card labels from source comments, contracts,
  tests and regression fixtures. The full-tree portability guard enforces that
  boundary.

Transport behavior through upstream D-122 remains covered. Files under
`upstream-fixtures/` are now **sanitized structural fixtures**, not frozen
product documents: their transport contracts and test anchors are retained,
while project names, repositories and card IDs are neutral. Exact source bytes
remain recoverable from the pinned tree above and ordinary Git history.

## Integrity

Reproduce the exact imported source snapshot in a temporary external checkout:

```bash
git clone https://github.com/Creative-textile/vault /tmp/scriptcat-upstream

git -C /tmp/scriptcat-upstream rev-parse eecb687^ \
git -C /tmp/scriptcat-upstream archive eecb687^ \
  tools/script-cat tools/relay-build.mjs tools/relay-watchdog.mjs
```

The local delta from that archive is intentionally reviewable with ordinary
Git. `relay.user.js` is generated from `src/**` plus
`docs/regulation-digest.md`; use `node tools/script-cat/build.mjs --check` to
verify it.
