import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("./", import.meta.url);
const manifest = JSON.parse(await readFile(new URL("manifest.json", root), "utf8"));
const background = await readFile(new URL("background.js", root), "utf8");
const bridge = await readFile(new URL("bridge.js", root), "utf8");

test("Firefox add-on requests only the APIs needed for exact-container tab control", () => {
  assert.equal(manifest.manifest_version, 2);
  assert.ok(manifest.permissions.includes("contextualIdentities"));
  assert.ok(manifest.permissions.includes("tabs"));
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

test("a new coordinator turn focuses the admin tab exactly once (D-035)", () => {
  assert.match(background, /let focusedTurnId = "";/);
  assert.match(background, /slot\.admin && shot\.turnRequest && String\(shot\.turnRequest\.id \|\| ""\) !== focusedTurnId/,
    "focus is edge-triggered per turn request id");
  assert.match(background, /browser\.tabs\.update\(tab\.id, \{ active: true \}\)/);
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
