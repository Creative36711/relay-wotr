# ScriptCat 1.16.2 · release evidence

Date: 2026-11-20

> Archive note (2026-11-22): this is release evidence kept as an operational record of Open BFME. The
> transport itself — source, bundle, tests, gates and future release notes — now lives in
> `Creative36711/relay-wotr`. Paths named below are read relative to that repository; this record is not
> edited, and no gate in this repository runs them.

Decision: `WOTR-D-008`

Upstream: imported tree `fe8ec9368fc2f5cb9a78a5cdbc47b66e30c07cf6` (`1.16.1`); exact source provenance: `tools/script-cat/UPSTREAM.md`

Local release: `1.16.2`

## Artifact

| Fact | Value |
|---|---|
| File | `tools/script-cat/relay.user.js` |
| Bytes | `1450669` |
| SHA-256 | `617a585b61ea51ae9f1f067cbee8c245f63799ff10f8441b464f399e58b96166` |
| `@version` | `1.16.2` |
| runtime fallback | `1.16.2` |
| build fingerprint | `a6704ca6c15fedfc` |
| source files | `45` |
| embedded rule coverage | `18/18` |

The bundle was generated from `tools/script-cat/src/**` and `docs/regulation-digest.md`; it is not hand-edited.

## Independent gates

Each command was run independently from the repository root after the final rebuild.

| Command | Result |
|---|---|
| `npm run scriptcat:check` | rc 0; bundle matches 45 source files; 18 rule IDs covered |
| `npm run scriptcat:guard` | rc 0; no former-product names in runtime or operational guides |
| `npm run test:scriptcat` | rc 0; 174 passed, 0 failed |
| `npm run test:scriptcat:regression` | rc 0; 22 passed, 0 failed |
| `npm run test:scriptcat:tool-limit` | rc 0; 2 passed, 0 failed |

The regression suite also validates that `tools/script-cat/wotr-project.json` passes the runtime profile validator, uses four distinct data sources and contains no credentials.

## Release boundary

The repository artifact and local deterministic gates are accepted evidence for the transport release. They do **not** claim that a browser installation, Notion write permission, Drive Gateway deployment, agent provisioning or a live multi-agent dispatch has occurred. Those operations require owner-side connections and the explicit activation procedure in `tools/script-cat/INSTALL.md`.
