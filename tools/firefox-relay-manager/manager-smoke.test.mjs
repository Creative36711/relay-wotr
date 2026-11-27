import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("./", import.meta.url);
const manifest = JSON.parse(await readFile(new URL("manifest.json", root), "utf8"));
const background = await readFile(new URL("background.js", root), "utf8");
const bridge = await readFile(new URL("bridge.js", root), "utf8");

test("Firefox add-on requests only the APIs needed for exact-container tab control", () => {
  assert.equal(manifest.manifest_version, 2);
  assert.equal(manifest.version, "0.1.5");
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

test("the manager never steals the foreground for a Relay state (D-022)", () => {
  // Фокус — только по явной просьбе человека из пульта. Ветка «новый turn →
  // окно Firefox наверх» удалена: она и была тем самым «пока не переключишься,
  // ничего не отправляется», о котором сказал владелец.
  const pollBody = background.slice(background.indexOf("async function pollRelay("));
  assert.doesNotMatch(pollBody, /focusManagedTab\(/, "опрос Relay больше не переключает окно");
  assert.doesNotMatch(pollBody, /windows\.update\(/, "окно в опросе не поднимается");
  assert.doesNotMatch(pollBody, /tabs\.update\([^)]*active: true/, "вкладка в опросе не активируется");
  assert.match(pollBody, /focusedTurnId = requestId \|\| `plan:/, "наблюдение за ходом осталось");
  assert.match(pollBody, /focusRequestedFor = "";/, "состояние просьбы сбрасывается после хода");

  assert.match(background, /async function bringSlotForward\(slotId\)/,
    "вкладку показывает отдельное действие");
  assert.match(background, /browser\.windows\.update\(tab\.windowId, \{ focused: true \}\)/);
  assert.match(background, /browser\.tabs\.update\(tab\.id, \{ active: true \}\)/);
  assert.match(background, /message\?\.type === "relay-manager-focus"/, "только явная просьба пульта");
  assert.ok(background.includes("/^http:\\/\\/127\\.0\\.0\\.1:8787\\//"),
    "просьбу принимает только локальный пульт");
  assert.match(background, /передний план переключает только пульт Relay/,
    "чужой странице отказано словами");
});

test("the pult page can reach the manager through the content bridge", () => {
  assert.ok(manifest.content_scripts.some((entry) => entry.matches.includes("http://127.0.0.1:8787/*")),
    "мост живёт и на странице пульта");
  assert.match(bridge, /relay-pult-focus-request/);
  assert.match(bridge, /relay-manager-focus-result/);
  assert.match(bridge, /relay-manager-bridge-ready/);
  assert.match(bridge, /detail\.source !== MANAGER_SOURCE/);
  assert.match(bridge, /browser\.runtime\.sendMessage/);
  const executable = bridge.replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(executable, /contextualIdentities|tabs\.create|cookies/,
    "мост не получает привилегий браузера");
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
