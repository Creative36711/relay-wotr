import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const client = await readFile(new URL("../src/46-relay-client.js", import.meta.url), "utf8");
const cycle = await readFile(new URL("../src/28-cycle.js", import.meta.url), "utf8");
const identity = client.slice(
  client.indexOf("async function relayIdentity("),
  client.indexOf("/** Отчёт службе", client.indexOf("async function relayIdentity(")),
);

test("forced hello bypasses the 10-minute identity cache after Relay restart", async () => {
  assert.ok(identity.startsWith("async function relayIdentity("), "relayIdentity source is present");
  const context = {
    relayClient: {
      slotId: "admin",
      account: "admin@example.com",
      admin: true,
      tab: "tab-admin",
      helloAt: Date.now() - 120000,
      lastPresenceAt: 0,
      warned: { hello: "", version: "" },
    },
    SCRIPT_VERSION: "1.33.0",
    K: { pending: "pending", expect: "expect" },
    location: { pathname: "/" },
    readAccountEmail: async () => ({ email: "admin@example.com" }),
    GM_getValue: () => null,
    accountSeen: () => ({ email: "" }),
    relayVersionAtLeast: () => true,
    log: () => {},
    sent: [],
    relayPost: async (payload) => {
      context.sent.push(payload);
      return { ok: true, slot: { slotId: "admin", admin: true }, requiredScriptVersion: "1.33.0" };
    },
  };
  vm.createContext(context);
  vm.runInContext(`${identity}\nthis.runIdentity = relayIdentity;`, context);
  const slot = await context.runIdentity({ force: true });
  assert.equal(slot, "admin");
  assert.equal(context.sent.length, 1, "force sends a fresh hello instead of returning cached slotId");
  assert.equal(context.sent[0].action, "hello");
});

test("admin poll skips and client exceptions are saved to local and Relay journals", () => {
  assert.match(client, /Админская вкладка не опросила очередь Relay/);
  assert.match(client, /action: "event", slotId, kind: "state", level: relayClient\.admin \? "warn" : "info", text/);
  assert.match(client, /Служба Relay: тик клиента не прошёл/);
  assert.match(client, /kind: "net", level: "error", text/);
  assert.match(client, /relayManagerExpectedSlot\(\)/, "контейнерный менеджер подтверждает ожидаемый слот");
  assert.match(client, /relayManagerMayPoll\(\)/, "лишние вкладки одного контейнера переводятся в standby");
  assert.match(cycle, /managerOwnsScheduling \|\| relayOwnsScheduling/, "локальный цикл не дублирует диспетчер Relay");
});
