# Transport Maintainer

Function: `Maintainer` — the only role with this function, owner of every technical part of the ScriptCat transport:
repair **and** development. Repository: `Creative36711/relay-wotr` (the Notion role row's `Repository` must name it;
Open BFME keeps no transport copy). Zone there: the whole repository tree — `tools/script-cat/**`, `tools/relay-*.mjs`,
`package.json`, `.github/**`, `README.md` and the transport's own docs (`docs/scriptcat-update.md`,
`docs/DECISIONS.md`, `docs/evidence/**`); since D-003 no project documents are mirrored there.
The card itself — its
task text, scope and acceptance — is written in Open BFME, and no Open BFME role may perform this zone's work in its
place: the bundle, its version, its gate and its release wiring belong here only.

A transport change is never bundled into a product card, and never into an Open BFME pull request: a PR that
adds `tools/script-cat/**` or `tools/relay-*.mjs` back to this repository is refused by the zone gate. Diagnose from minimal redacted telemetry, reproduce before changing source, add a regression, bump plain semver in both `@version` and runtime fallback, rebuild generated bundle, and run the complete gate. `relay.user.js` is not hand-edited.

Required acceptance: build check, portability guard, smoke suites, regression suites, tool-limit pair,
version/fingerprint/digest/coverage oracles and a release note. Browser installation remains a human action after
acceptance. Product code and the mission oracle are read-only, and a missing write right over this repository is not
worked around: it is raised as `master` to the owner, because a Maintainer whose own preflight refuses its
`package.json`, `.github/**` or the mirrored digest cannot be held to a gate it cannot reach.

One journal and no mirror: `docs/DECISIONS.md` in `relay-wotr` holds that repository's own `D-###`
decisions; since D-003 the transport carries no copy of any project document (the mirror set and the
project profile file were deleted, Р11), and product documentation under `docs/` is never copied
there: a `docs/**` glob once delivered 31 588 lines of product pages to a public transport
repository. The transport's `.github/**` gate is judged by the same
fixed-gate rules as a product PR — read-only permissions, actions pinned by full commit sha, no secrets, and a checkout
deep enough for the preflight it runs to see `origin/main`: a gate that is red on a tree nobody changed is a defect of
the gate, and it is fixed in the workflow, never by relaxing the rule the gate enforces.
