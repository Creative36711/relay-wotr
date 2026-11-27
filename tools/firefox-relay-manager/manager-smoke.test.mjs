import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("./", import.meta.url);
const manifest = JSON.parse(await readFile(new URL("manifest.json", root), "utf8"));
const background = await readFile(new URL("background.js", root), "utf8");
const bridge = await readFile(new URL("bridge.js", root), "utf8");

test("Firefox add-on requests only the APIs needed for exact-container tab control", () => {
  assert.equal(manifest.manifest_version, 2);
  assert.equal(manifest.version, "0.1.4");
  assert.ok(manifest.permissions.includes("contextualIdentities"));
  assert.ok(manifest.permissions.includes("tabs"));
  assert.ok(!manifest.permissions.includes("windows"), "Firefox does not accept a windows permission token");
  assert.ok(manifest.permissions.includes("http://127.0.0.1:8787/*"));
  assert.ok(manifest.permissions.includes("https://arena.ai/*"));
  assert.ok(!manifest.permissions.includes("cookies"), "cookie contents are not read");
  assert.match(background, /tabs\.query\(\{ url: \["https:\/\/arena\.ai\/\*", "https:\/\/www\.arena\.ai\/\*"\] \}\)/);
  assert.match(background, /identity\.cookieStoreId/);
  assert.match(background, /cookieStoreId: identity\.cookieStoreId/);
  assert.match(background, /matches\.length !== 1/);
  assert.match(background, /never move a tab between containers/i);
});

test("tab lifecycle reuses Arena tabs, leaves admin and user-owned tabs alone", () => {
  assert.match(background, /createdByManager: false/);
  assert.match(background, /createdByManager: true/);
  assert.match(background, /!slot\.admin && existingEntry\.createdByManager/);
  assert.match(background, /browser\.tabs\.remove\(tab\.id\)/);
  assert.match(background, /IDLE_CLOSE_MS = 180000/);
  assert.match(background, /slotHasLocalBusy/);
});

test("Coordinator turn and already-ACKed expect:plan focus the admin tab without repeated focus", () => {
  assert.match(background, /let focusedTurnId = "";/);
  assert.match(background, /shot\.turnRequest\?\.id/,
    "new Relay turn request activates Admin");
  assert.match(background, /busyClients\.find\(\(client\) => client\.localWaiting === "expect:plan"\)/,
    "a locally held plan remains focusable after Relay ACK clears turnRequest");
  assert.match(background, /!requestId && planWait && focusedPlanTabId !== tab\.id/,
    "an already-ACKed plan focuses once per active wait");
  assert.match(background, /await focusManagedTab\(current\)/);
  assert.match(background, /browser\.windows\.update\(tab\.windowId, \{ focused: true \}\)/);
  assert.match(background, /browser\.tabs\.update\(tab\.id, \{ active: true \}\)/);
  assert.match(background, /focusedTurnId = requestId \|\| `plan:/);
  assert.match(background, /focusedPlanTabId = 0/,
    "the next plan in the same tab can trigger a fresh focus");
});

test("the content bridge forwards only a cycle-mode message, not browser privileges", () => {
  assert.match(bridge, /relay-manager-cycle-mode/);
  assert.match(bridge, /relay-container-manager-mode/);
  assert.match(bridge, /leader: message\.leader !== false/);
  assert.match(bridge, /slotId: String\(message\.slotId/);
  assert.match(bridge, /browserTabId: Number\(message\.browserTabId\)/);
  const executable = bridge.replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(executable, /contextualIdentities|tabs\.create|cookies/);
});
