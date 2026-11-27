// Экземпляры агентов: пара (роль, слот) и ленивое создание.
//
// Две вещи здесь стоят дороже остальных:
//
//   1. Наследование адреса из строки роли. Старые базы держат один Agent URL
//      на роль, и обновление не должно требовать ручного переноса адресов:
//      обновление, которое требует ручной работы, не делают.
//   2. Задание создаётся под пару, а не под роль. Ошибка «создать по роли»
//      выглядит безобидно, а стоит тридцать три агента в одном слоте.

import test from "node:test";
import assert from "node:assert/strict";
import {
  parseInstances, agentDecision, needsAgent, instanceFor, instanceKey,
  instancesOfSlot, instanceToRow, pairsForPrompt, AGENT_STATE,
} from "../src/agents.mjs";
import { createFakeStore } from "./fake-sheets.mjs";
import { createService } from "../src/service.mjs";

const slots = [
  ["admin", "arena-creative", "creative36711@gmail.com", "да", "активен", ""],
  ["worker-1", "arena-yandex", "Creative36711@yandex.ru", "нет", "активен", ""],
  ["worker-2", "arena-list", "creative36711@list.ru", "нет", "активен", ""],
];

const serviceWith = (instances = []) => {
  const store = createFakeStore({ slots, agents: instances });
  return { store, service: createService({ store, now: () => Date.parse("2026-11-23T10:00:00Z") }) };
};

test("agents: пара (роль, слот) — ключ, а не роль", () => {
  const parsed = parseInstances([
    ["Godot World", "worker-1", "https://arena/agent/1", "создан"],
    ["Godot World", "worker-2", "https://arena/agent/2", "создан"],
  ]);
  assert.equal(parsed.length, 2);
  assert.notEqual(parsed[0].key, parsed[1].key, "одна роль в двух слотах — два экземпляра");
  assert.equal(instanceFor(parsed, "Godot World", "worker-2").url, "https://arena/agent/2");
  assert.equal(instanceFor(parsed, "Godot World", "worker-3"), null);
});

test("agents: имя пары не зависит от регистра и пробелов", () => {
  assert.equal(instanceKey("Godot  World", "worker-1"), instanceKey(" godot world ", " Worker-1 "));
});

test("agents: готовый экземпляр используется, создавать нечего", () => {
  const instances = parseInstances([["Godot World", "worker-1", "https://arena/agent/1", "создан"]]);
  const decision = agentDecision({ role: "Godot World", slot: "worker-1", instances });
  assert.equal(decision.action, "use");
  assert.equal(decision.url, "https://arena/agent/1");
});

test("agents: «создан» без адреса — не готов: адреса нет, выдавать некуда", () => {
  const instances = parseInstances([["Godot World", "worker-1", "", "создан"]]);
  assert.equal(agentDecision({ role: "Godot World", slot: "worker-1", instances }).action, "create");
});

test("agents: пока создаётся — ждём, второго задания не плодим", () => {
  const instances = parseInstances([["Godot World", "worker-1", "", "создаётся"]]);
  assert.equal(agentDecision({ role: "Godot World", slot: "worker-1", instances }).action, "wait");
  assert.equal(needsAgent(instanceFor(instances, "Godot World", "worker-1")), false);
});

test("agents: неудачная попытка не блокирует навсегда — причина видна", () => {
  const instances = parseInstances([["Godot World", "worker-1", "", "ошибка", "", "", "", "лимит Arena"]]);
  const decision = agentDecision({ role: "Godot World", slot: "worker-1", instances });
  assert.equal(decision.action, "create");
  assert.match(decision.why, /лимит Arena/, "причина прошлой ошибки попадает в решение");
});

test("agents: адрес из строки роли наследуется — старые базы работают без миграции", () => {
  const decision = agentDecision({
    role: "Godot World", slot: "worker-1", instances: [], legacyUrl: "https://arena/agent/old",
  });
  assert.equal(decision.action, "use");
  assert.equal(decision.url, "https://arena/agent/old");
  assert.equal(decision.inherited, true);
});

test("agents: наследование не действует, если для пары уже есть свой экземпляр", () => {
  // Иначе адрес роли перебивал бы адрес экземпляра, и роль в worker-2 уходила
  // бы в агента worker-1 — то есть в тот же чат из другого контейнера.
  const instances = parseInstances([["Godot World", "worker-2", "https://arena/agent/2", "создан"]]);
  const decision = agentDecision({
    role: "Godot World", slot: "worker-2", instances, legacyUrl: "https://arena/agent/old",
  });
  assert.equal(decision.url, "https://arena/agent/2");
});

test("agents: строка листа собирается по схеме, а не по порядку полей объекта", () => {
  const row = instanceToRow({ role: "Godot World", slot: "worker-1", url: "u", state: "создан" });
  assert.equal(row[0], "Godot World");
  assert.equal(row[1], "worker-1");
  assert.equal(row.length, 8);
});

test("agents: экземпляры слота — то, что вкладка держит открытым", () => {
  const instances = parseInstances([
    ["Godot World", "worker-1", "u1", "создан"],
    ["Godot World", "worker-2", "u2", "создан"],
    ["Campaign Editor", "worker-1", "u3", "создан"],
  ]);
  assert.deepEqual(instancesOfSlot(instances, "worker-1").map((item) => item.role).sort(), ["Campaign Editor", "Godot World"]);
});

test("agents: пары для промпта показывают «готов / нет агента», а не только занятость", () => {
  const roles = [
    { name: "Godot World", agentAdmin: false, url: "" },
    { name: "Coordinator", agentAdmin: true, url: "https://arena/agent/c" },
  ];
  const slotsParsed = [
    { slotId: "admin", admin: true, enabled: true },
    { slotId: "worker-1", admin: false, enabled: true },
  ];
  const instances = parseInstances([["Godot World", "worker-1", "u1", "создан"]]);
  const pairs = pairsForPrompt({ roles, slots: slotsParsed, instances, liveRuns: [] });
  const godot = pairs.find((pair) => pair.role === "Godot World");
  assert.equal(godot.state, "готов");
  const admin = pairs.find((pair) => pair.role === "Coordinator");
  assert.equal(admin.slot, "admin", "админ-роль не показывается в рабочем слоте");
});

test("service: задание на агента ставится в очередь, но не карточка", async () => {
  const { store, service } = serviceWith([]);
  const result = await service.__test.requestAgent({
    role: "Godot World",
    slot: { slotId: "worker-1", container: "arena-yandex", account: "creative36711@yandex.ru" },
    data: { instances: [], queue: [] },
    reason: "нет пары",
  });
  assert.equal(result.ok, true);
  assert.equal(result.item["Вид"], "provision");
  assert.equal(result.item["Слот"], "worker-1");
  assert.equal(result.item["Карточка"], "", "у задания нет карточки: это не работа над миссией");
});

test("service: второе задание на ту же пару не ставится", async () => {
  const { service } = serviceWith([["Godot World", "worker-1", "", "создаётся"]]);
  const result = await service.__test.requestAgent({
    role: "Godot World",
    slot: { slotId: "worker-1", container: "arena-yandex", account: "creative36711@yandex.ru" },
    data: { instances: [{ key: instanceKey("Godot World", "worker-1"), role: "Godot World", slot: "worker-1", state: "создаётся", url: "" }], queue: [] },
  });
  assert.equal(result.ok, false);
  assert.match(result.why, /уже создаётся/);
});

test("service: задание выдаётся только своему слоту", async () => {
  const { store, service } = serviceWith([]);
  await service.__test.requestAgent({
    role: "Godot World",
    slot: { slotId: "worker-1", container: "arena-yandex", account: "creative36711@yandex.ru" },
    data: { instances: [], queue: [] },
  });
  // Вкладка worker-2 не должна получить задание чужого контейнера: она его не
  // выполнит, а строка застрянет в «leased» до ручной чистки.
  const pulled = await service.pull({ scriptVersion: "1.30.0", slotId: "worker-2", tab: "t2" });
  // Отсутствие `kind: provision` и есть проверка: задание осталось за worker-1.
  assert.notEqual(pulled.kind, "provision", `worker-2 не должен создавать агента чужого слота: ${pulled.why}`);
  assert.equal(pulled.work, null);
});

/**
 * `beat` продлевает «Последнюю жизнь» экземпляра.
 *
 * Колонка была в схеме с 1.20.0 и означала «когда создан». По ней нельзя было
 * понять, живёт ли агент пары (роль, слот) или его контейнер закрыли, — а
 * именно этот вопрос задаёт владелец, глядя на книгу: «три агента Godot World
 * в трёх контейнерах, кто из них ещё открыт?»
 */
test("удар сердца вкладки обновляет «Последнюю жизнь» её экземпляра", async () => {
  const store = createFakeStore({
    slots,
    agents: [["Technical Artist", "worker-1", "https://arena.example/agent/ta1", "создан", "2026-11-20T10:00:00Z", "job-1", "2026-11-20T10:00:00Z", ""]],
    runs: [[
      "run-1", "card-1", "Проверить сцену", "worker-1", "Creative36711@yandex.ru",
      "Technical Artist", "https://arena.example/agent/ta1", "issued", "2026-11-20T10:00:00Z",
      "", "1", "", "",
    ]],
  });
  const service = createService({ store, now: () => Date.parse("2026-11-23T12:34:00Z"), log: () => {} });
  const beaten = await service.beat({ slotId: "worker-1", runId: "run-1", tab: "aa11", silentMs: 5000 });
  assert.equal(beaten.ok, true);
  const row = store.objects("agents")[0];
  assert.notEqual(row["Последняя жизнь"], "2026-11-20T10:00:00Z", "время жизни сдвинулось");
  assert.match(row["Последняя жизнь"], /^2026-11-23T12:34/, "это момент удара, а не создания");
  assert.equal(row["Создан"], "2026-11-20T10:00:00Z", "дата создания не перезаписывается");
  assert.equal(row["Agent URL"], "https://arena.example/agent/ta1", "адрес на месте");
});
