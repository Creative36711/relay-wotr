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
    SCRIPT_VERSION: "1.33.1",
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
      return { ok: true, slot: { slotId: "admin", admin: true }, requiredScriptVersion: "1.33.1" };
    },
  };
  vm.createContext(context);
  vm.runInContext(`${identity}\nthis.runIdentity = relayIdentity;`, context);
  const slot = await context.runIdentity({ force: true });
  assert.equal(slot, "admin");
  assert.equal(context.sent.length, 1, "force sends a fresh hello instead of returning cached slotId");
  assert.equal(context.sent[0].action, "hello");
});

test("local hold diagnostics include routing metadata but never prompt or page content", () => {
  const start = client.indexOf("function relayLocalStateSummary(");
  const end = client.indexOf("/** POST действия в службу", start);
  assert.ok(start >= 0 && end > start, "local summary function is present");
  const context = {};
  vm.createContext(context);
  vm.runInContext(`${client.slice(start, end)}\nthis.summary = relayLocalStateSummary;`, context);
  const summary = JSON.parse(JSON.stringify(context.summary({
    kind: "heal", roleId: "role-123", roleName: "Maintainer", turnId: "heal-turn-1",
    at: 1795780000000, sentAt: 1795780001000, verified: false,
    text: "private prompt", prompt: { body: "private" }, roleUrl: "https://arena.ai/private",
  })));
  assert.equal(summary.kind, "heal");
  assert.equal(summary.roleName, "Maintainer");
  assert.equal(summary.turnId, "heal-turn-1");
  assert.equal("text" in summary, false);
  assert.equal("prompt" in summary, false);
  assert.equal("roleUrl" in summary, false);
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

test("pult turn and queued work release the project switch hold (D-035)", () => {
  assert.match(client, /function relayReleaseSwitchHold\(reason\)/, "helper is present");
  assert.match(client, /relayReleaseSwitchHold\("планирующий ход Координатора"\)/,
    "coordinator turn from the pult is an explicit action and releases the hold");
  assert.match(client, /relayReleaseSwitchHold\("выдача работы из очереди"\)/,
    "queued work from the pult is an explicit action and releases the hold");
  const start = client.indexOf("function relayReleaseSwitchHold(");
  const end = client.indexOf("async function relayTakeWork(", start);
  assert.ok(start >= 0 && end > start, "helper source is present");
  const context = { log: (...args) => context.logged.push(args), logged: [] };
  vm.createContext(context);
  vm.runInContext(`${client.slice(start, end)}\nthis.releaseHold = relayReleaseSwitchHold;`, context);
  let held = false;
  let releases = 0;
  context.projectHeld = () => held;
  context.releaseProjectHold = () => { releases += 1; return true; };
  context.releaseHold("проба");
  assert.equal(releases, 0, "без удержания снимать нечего и писать нечего");
  assert.equal(context.logged.length, 0, "обычный ход не засоряет журнал");
  held = true;
  context.releaseHold("проба");
  assert.equal(releases, 1, "удержание снимается");
  assert.match(String(context.logged[0][0]), /Удержание после переключения снято/);
});
