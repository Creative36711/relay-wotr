# Relay / ScriptCat transport

This repository is the technical home for the Relay/ScriptCat userscript and its Drive gateway. Project operations remain configured against the project repository in `tools/script-cat/wotr-project.json` (currently `Creative36711/open-bfme`); moving the transport source here does **not** move Warden's mission/queue data or change its operational repository.

## Developer checks

Requires Node.js 20+.

```sh
npm run scriptcat:build
npm run verify:scriptcat
```

The installed userscript is `tools/script-cat/relay.user.js`, generated from `tools/script-cat/src/`. Read `tools/script-cat/INSTALL.md` before replacing an installed copy; do not run two copies for the same profile simultaneously. The WOTR profile is metadata only (no tokens/secrets) and remains pointed at the Open BFME operational repository.

See [`WARDEN-SCRIPTCAT-MIGRATION.md`](./WARDEN-SCRIPTCAT-MIGRATION.md) for the coordinated handoff/cleanup checklist for Open BFME.