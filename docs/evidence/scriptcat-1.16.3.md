# ScriptCat 1.16.3 · release evidence

Date: 2026-11-20

> Archive note (2026-11-22): this is release evidence kept as an operational record of Open BFME. The
> transport itself — source, bundle, tests, gates and future release notes — now lives in
> `Creative36711/relay-wotr`. Paths named below are read relative to that repository; this record is not
> edited, and no gate in this repository runs them.

Decisions: `WOTR-D-010`, `WOTR-D-011`, `WOTR-D-013`, `WOTR-D-014`

Upstream: imported tree `fe8ec9368fc2f5cb9a78a5cdbc47b66e30c07cf6` (`1.16.1`); exact source provenance: `tools/script-cat/UPSTREAM.md`

Previous local release: `1.16.2`

Local release: `1.16.3`

## Scope

This process/profile release keeps transport protocol `1.11` and adds the repository regulation 1.1 facts: Upstream Integrator is an `Executor` specialization, Transport Maintainer is the sole `Maintainer`, cards declare build/retail Cost gates, and product i18n uses exact tags `en`, `ru`, `zh-Hans`, `ja`, `pt-BR`, `de`, `fr`, `ko`. The task identity block is treated as verbatim card data so long titles do not consume the instruction-overhead budget; the total prompt limit remains enforced.

## Artifact

| Fact | Value |
|---|---|
| File | `tools/script-cat/relay.user.js` |
| Bytes | `1451760` |
| SHA-256 | `943517314f531539083f720eb58a62f67cff5b2d14735d30ae53e681a2319e41` |
| `@version` | `1.16.3` |
| runtime fallback | `1.16.3` |
| build fingerprint | `ff895ce45f56ca67` |
| source files | `45` |
| embedded rule coverage | `18/18` |

The bundle was generated from `tools/script-cat/src/**` and `docs/regulation-digest.md`; it was not hand-edited.

## Independent gates

`npm run verify:scriptcat` ran from the repository root after the final rebuild and returned rc 0:

| Stage | Result |
|---|---|
| `npm run scriptcat:check` | rc 0; bundle matches 45 source files; 18 rule IDs covered |
| `npm run scriptcat:guard` | rc 0; portability guard clean |
| `npm run test:scriptcat` | rc 0; 174 passed, 0 failed |
| `npm run test:scriptcat:regression` | rc 0; 22 passed, 0 failed |
| `npm run test:scriptcat:tool-limit` | rc 0; 2 passed, 0 failed |

The prompt suite covers default and long-zone Executor cards within the existing 2800-character instruction budget; full/compact/payload/pause behavior and continuation identities remain green.

## Release boundary

This evidence accepts the deterministic repository artifact and local transport gates only. It does not claim browser installation, live dispatch, Drive hydration, agent provisioning or Notion write permission. Those remain owner-side operations under `tools/script-cat/INSTALL.md` and the live role roster.
