import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("Relay console owns profile selection; ScriptCat accepts switches only while idle and preserves run state", async () => {
  const [boot, cycle, profiles, client, html, app, panel, connections, projectUi] = await Promise.all([
    read("../src/29-boot.js"), read("../src/28-cycle.js"), read("../src/02-profiles-core.js"),
    read("../src/46-relay-client.js"), read("../../../relay/web/index.html"), read("../../../relay/web/app.js"),
    read("../src/06-pause-panel.js"), read("../src/07-connections-ui.js"), read("../src/08-projects-ui.js"),
  ]);
  assert.match(boot, /mount\(\);/, "executor operations panel stays available");
  assert.doesNotMatch(boot, /\n\s*setup\(false\);/, "old connection setup is not started at boot");
  assert.doesNotMatch(panel, /id="\$\{ui\.setup\}"|setup\(true\)/, "executor panel has no setup entry point");
  assert.doesNotMatch(connections, /function connectionDialog\(|async function setup\(/, "old connection editor is removed");
  assert.doesNotMatch(projectUi, /function projectsDialog\(/, "old project editor is removed");
  assert.doesNotMatch(cycle, /setup\(false\)|cfn-connections|cfn-projects/, "executor ticks never open or wait on settings UI");
  const select = profiles.slice(profiles.indexOf("function applyRelayProjectSelection"), profiles.indexOf("const mainEntry ="));
  assert.match(select, /validProfile\(profile\)/, "incoming profile is validated");
  assert.match(select, /rawSet\(PROFILE_REGISTRY_KEY, next\)/, "profile is stored in the existing registry");
  assert.match(select, /sessionStorage\.setItem\(PROFILE_SESSION_KEY, profile\.id\)/, "only the selected profile ID changes");
  assert.doesNotMatch(select, /K\.(?:pending|expect)|resetState\(/, "switch never clears a queue or expectation");
  assert.match(client, /res\?\.projectSelection && !localBusy && !busy && !\(Number\(projectAsyncWork\) > 0\)/,
    "switch waits for local queue, running work and async tasks");
  assert.match(client, /location\.reload\(\)/, "page reloads only after the selected profile is safely persisted");
  assert.match(client, /projectSettingsUnavailable[\s\S]*?applyRelayProjectSettingsUnavailable/,
    "revoked credentials are cleared after an idle hello");
  assert.match(html, /id="btn-project-activate"/, "pult has an active-profile action");
  assert.match(app, /\/api\/projects\/active/, "pult sends active-profile changes to Relay");
});
