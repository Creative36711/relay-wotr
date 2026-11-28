// Чужое ожидание в общем хранилище не занимает эту вкладку (28.11).
//
// Что случилось. `cfn-expect` лежит в хранилище ScriptCat, а оно общее для всех
// контейнеров профиля. Ход Координатора (роль admin-слота) держали все четыре
// вкладки: каждая на `hello` докладывала `localWaiting: "expect:plan"`, пульт
// видел «заняты все», служба не выдавала ни план, ни провижининг — и планирующий
// ход запрашивался заново каждые полторы минуты. В журнале это читалось как
// «Пульт просит дочитать ответ» → «Проект ждёт ручного запуска» → снова ход.
//
// Правило простое: держателем хода считается вкладка, чья роль открыта на
// странице. Проверка идёт по адресу агента, затем по адресу роли из ожидания,
// затем по имени роли из кеша «Ролей» — у рабочих ролей адреса в «Ролях» нет
// (D-015), и без третьего признака они бы не опознавались вовсе.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

/** Ровно функция, без соседних замыканий: границу ищем по «\n  }». */
const ownsSource = async () => {
  const client = await read("../src/46-relay-client.js");
  const start = client.indexOf("function relayOwnsHandoff(");
  assert.ok(start > 0, "relayOwnsHandoff объявлен в клиенте Relay");
  const end = client.indexOf("\n  }", start) + 4;
  return client.slice(start, end);
};

const build = async ({ path = "/agent/agent-worker-1", roleFromPath = () => "agent-worker-1", role = null } = {}) => {
  const source = await ownsSource();
  const context = { location: { pathname: path, href: `https://arena.example${path}` }, URL };
  context.roleFromPath = roleFromPath;
  context.accountRoleForPath = () => role;
  vm.createContext(context);
  vm.runInContext(`${source}\nthis.relayOwnsHandoff = relayOwnsHandoff;`, context);
  return context.relayOwnsHandoff;
};

test("ход Координатора не считается своим для рабочей вкладки", async () => {
  const owns = await build({
    path: "/agent/agent-worker-1",
    roleFromPath: () => "agent-worker-1",
    role: { name: "Godot World" },
  });
  const plan = {
    kind: "plan", roleId: "agent-coordinator", roleName: "Coordinator",
    roleUrl: "https://arena.example/agent/agent-coordinator",
  };
  assert.equal(owns(plan), false, "чужая роль — не мой ход");
});

test("свой ход остаётся своим, даже когда адреса роли в «Ролях» нет", async () => {
  const owns = await build({
    path: "/agent/agent-worker-2",
    roleFromPath: () => "agent-worker-2",
    role: { name: "Godot World" },
  });
  // Так выглядит ожидание рабочей роли после D-015: roleId пуст, адреса нет.
  assert.equal(owns({ kind: "dispatch", roleName: "Godot World" }), true,
    "роль страницы совпала с именем в ожидании");
  assert.equal(owns({ kind: "plan", roleName: "Coordinator" }), false,
    "имя не совпало — ход чужой");
});

test("адрес роли из ожидания решает раньше имени", async () => {
  const owns = await build({
    path: "/agent/agent-a", roleFromPath: () => "agent-a", role: { name: "Одна" },
  });
  assert.equal(owns({ kind: "plan", roleUrl: "https://arena.example/agent/agent-b", roleName: "Одна" }), false,
    "другой адрес агента — чужой ход, даже при совпавшем имени");
  assert.equal(owns({ kind: "plan", roleUrl: "https://arena.example/agent/agent-a" }), true,
    "свой адрес — свой ход");
});

test("без данных о роли ход считается своим, а не чужим", async () => {
  // Брошенный свой ход опаснее лишнего шага: шаг сам увидит, что маркера нет.
  const owns = await build({ path: "/", roleFromPath: () => "", role: null });
  assert.equal(owns({ kind: "plan" }), true);
  assert.equal(owns(null), false, "пустого ожидания нет");
});

test("hello и tick докладывают только своё удержание", async () => {
  const client = await read("../src/46-relay-client.js");
  assert.match(client, /const ownsWaiting = Boolean\(waitingState\) && relayOwnsHandoff\(waitingState\);/,
    "состояние для пульта считается через владельца хода");
  assert.match(client, /const localWaiting = ownsWaiting[\s\S]{0,120}expect:/,
    "чужое ожидание не уходит в localWaiting");
  assert.match(client, /relayOwnsHandoff\(pendingRaw\) \? pendingRaw : null/,
    "tick удерживает pull только своим ожиданием");
  assert.match(client, /relayOwnsHandoff\(GM_getValue\(K\.expect, null\)\)/,
    "отложенный шаг тоже ждёт только своей работы");
});

test("провижининг не считает чужим ходом простой контейнера", async () => {
  const provision = await read("../src/33-provision-flow.js");
  assert.match(provision, /function provisionLocalHandoff\(\)/, "занятость спрашивается отдельной функцией");
  assert.match(provision, /typeof relayOwnsHandoff !== "function" \|\| relayOwnsHandoff\(value\)/,
    "без клиента (проба) занятость считается как раньше");
  assert.match(provision, /if \(provisionLocalHandoff\(\)\) return "активный командный ход";/,
    "в простое провижининга чужой ход не участвует");
  assert.match(provision, /if \(provisionLocalHandoff\(\)\) \{\n\s*return provisionPause\("Provisioning: появился активный командный ход/,
    "создание не останавливается чужим ходом");
});

test("служба не заводит задание на агента повторно тем же отказом", async () => {
  const service = await read("../../../relay/src/service.mjs");
  assert.match(service, /const AGENT_CREATE_RETRY_MS = 10 \* 60_000;/, "окно ожидания после отказа названо");
  assert.match(service, /const retry = agentRetryGate\(role, slot\.slotId\);/, "решение спрашивается до задания");
  assert.match(service, /if \(retry\.blocked\) \{[\s\S]{0,400}приостановлено до/, "отказ называет срок и причину");
  assert.match(service, /if \(failed\) noteAgentFailure\(name, target, note \|\| "причина не названа"\);/,
    "отказ запоминается");
  assert.match(service, /else if \(memory\.agentCreateFailures instanceof Map\) memory\.agentCreateFailures\.delete/,
    "успех снимает память об отказе");
  assert.match(service, /if \(requested\.wait\) return idle\(requested\.why\);/, "pull называет причину вместо «готовит другая вкладка»");
  assert.match(service, /else if \(asked\.wait\) lastAgentBlock = asked\.why;/, "шаг пульта помнит причину");
});

test("отложенное создание не превращается в новый планирующий ход", async () => {
  const service = await read("../../../relay/src/service.mjs");
  const step = service.slice(service.indexOf("async function step({"), service.indexOf("async function pause("));
  const block = step.indexOf("if (!issued.length && !agentRequests.length && lastAgentBlock)");
  const turn = step.indexOf("if (!issued.length && !agentRequests.length) {");
  assert.ok(block > 0, "ветка «создание отложено» есть");
  assert.ok(block < turn, "она проверяется раньше запроса хода Координатора");
  assert.match(step.slice(block, turn), /turnRequested: false/, "новый ход не запрашивается");
  assert.match(step.slice(block, turn), /шаг: \$\{why\}/, "причина уходит в журнал");
});
