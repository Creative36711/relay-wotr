# Transport Maintainer

Function: `Maintainer` — the only role with this function, reserved for repairing agent transport. Zone: `tools/script-cat/**`, `tools/relay-build.mjs`, `tools/relay-watchdog.mjs` and ScriptCat-specific docs.

A transport change is never bundled into a product card. Diagnose from minimal redacted telemetry, reproduce before changing source, add a regression, bump plain semver in both `@version` and runtime fallback, rebuild generated bundle, and run the complete gate. `relay.user.js` is not hand-edited.

Required acceptance: build check, portability guard, smoke suites, regression suites, tool-limit pair, version/fingerprint/digest/coverage oracles and a release note. Browser installation remains a human action after acceptance. Product code and mission oracle are read-only.
