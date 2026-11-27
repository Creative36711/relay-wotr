import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const [connections, projectCore, profileCore, boot, client, html, app] = await Promise.all([
  read("../src/07-connections-ui.js"), read("../src/08-projects-ui.js"), read("../src/02-profiles-core.js"),
  read("../src/29-boot.js"), read("../src/46-relay-client.js"), read("../../../relay/web/index.html"), read("../../../relay/web/app.js"),
]);
assert.match(connections, /function connectionSettings\(\)/, "executor retains a project-scoped settings reader");
assert.match(connections, /async function probeNotionConnection\(settings\)/);
assert.match(connections, /async function probeDriveConnection\(settings\)/);
assert.match(connections, /async function probeGithubConnection\(settings\)/);
assert.doesNotMatch(connections, /function connectionDialog\(|async function setup\(/, "old ScriptCat connection editor is removed");
assert.match(projectCore, /async function validateProjectSchema\(settings, \{ readOnly = false \} = \{\}\)/);
assert.match(projectCore, /async function approveProjectFromRelay\(/, "pult approval still reuses read-only checks");
assert.doesNotMatch(projectCore, /function projectsDialog\(/, "old ScriptCat profile editor is removed");
assert.match(boot, /\n\s*mount\(\);/, "executor status and local-control panel remains mounted");
assert.doesNotMatch(boot, /\n\s*setup\(false\);/, "legacy connection setup does not run at startup");
for (const id of ["project-notion", "project-gw-url", "project-gw-key", "project-github", "project-ntfy", "project-ntfy-topic"])
  assert.match(html, new RegExp(`id="${id}"`), `Relay pult owns ${id}`);
assert.match(html, /btn-project-activate/, "active-project selection moved to Relay");
assert.match(app, /post\("\/api\/projects"/, "profile metadata and credentials save through the local service");
assert.match(app, /\/api\/projects\/active/, "profile switching is available in Relay");
assert.match(client, /projectSelection/, "ScriptCat receives the pult's profile selection over hello");
assert.match(client, /projectSettingsUnavailable/, "missing Relay credentials revoke approval on a safe hello");
assert.match(client, /projectCredentials:\s*!projectCredentialsSynced[\s\S]*?projectCredentialsSnapshot/, "already-saved local credentials migrate until Relay confirms receipt");
assert.match(profileCore, /cfn-relay-project-credentials-synced/, "credential migration uses its own confirmation marker");
assert.match(profileCore, /function projectCredentialsSnapshot\(\)/, "migration reads project-scoped local secrets");
assert.doesNotMatch(profileCore.match(/function applyRelayProjectSettingsUnavailable\(data\) \{[\s\S]*?\n  \}/)?.[0] || "", /rawSet\([^\n]*,\s*["']{2}\)/,
  "an empty Relay profile does not erase credentials before migration");
console.log("OK: Relay pult owns project settings and credentials; ScriptCat retains only execution and read-only approval checks");
