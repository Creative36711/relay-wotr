// Асинхронность: несколько карточек сразу, ход возвращается тому, кто закончил.
//
// Тесты проверяют именно те обещания, которые даны владельцу:
//   • два слота могут держать работу одновременно;
//   • освобождение одного не ждёт другого;
//   • «сколько выдавать» решает Координатор, а предел — только ограничение;
//   • слот в лимите аккаунта не получает работу, и причина названа словами.

import test from "node:test";
import assert from "node:assert/strict";
import { parseSlots } from "../src/slots.mjs";
import { parseQueue, parseRuns, queueSummary, planDispatch } from "../src/queue.mjs";
import { planBatch, planOne, assignable, releaseAndRequeue } from "../src/dispatch.mjs";
import { accountState, slotGate, limitMark } from "../src/accounts.mjs";
import { slotRows, queueRow, runRow } from "./fake-sheets.mjs";

const slots = parseSlots(slotRows());

test("два рабочих слота берут работу одновременно", () => {
  const queue = parseQueue([
    queueRow({ id: "q-1", card: "c-1", role: "Technical Artist" }),
    queueRow({ id: "q-2", card: "c-2", role: "Godot World Engineer", at: "2026-11-26T10:01:00Z" }),
  ]);
  const plans = planBatch({ slots, queue, runs: [], state: new Map(), maxParallel: 2 });
  assert.equal(plans.plans.length, 2, "две строки должны уйти двум слотам");
  const used = plans.plans.map((plan) => plan.slot.slotId);
  assert.equal(new Set(used).size, 2, "одна и та же строка не должна уйти в один слот дважды");
  assert.ok(used.every((slotId) => slotId.startsWith("worker-")), "рабочие роли идут на рабочие слоты");
});

test("предел одновременности соблюдается, даже если слотов больше", () => {
  const queue = parseQueue([
    queueRow({ id: "q-1", card: "c-1" }),
    queueRow({ id: "q-2", card: "c-2", at: "2026-11-26T10:01:00Z" }),
    queueRow({ id: "q-3", card: "c-3", at: "2026-11-26T10:02:00Z" }),
  ]);
  const plans = planBatch({ slots, queue, runs: [], state: new Map(), maxParallel: 1 });
  assert.equal(plans.plans.length, 1, "при пределе 1 выдаётся ровно одна строка");
});

test("Координатор может попросить меньше предела — и получает меньше", () => {
  const queue = parseQueue([
    queueRow({ id: "q-1" }),
    queueRow({ id: "q-2", card: "c-2", at: "2026-11-26T10:01:00Z" }),
  ]);
  const plans = planBatch({ slots, queue, runs: [], state: new Map(), maxParallel: 3, requested: 1 });
  assert.equal(plans.plans.length, 1, "решение Координатора главнее «максимальной загрузки»");
});

test("ход возвращается сразу, не дожидаясь других слотов", () => {
  const runs = parseRuns([
    runRow({ runId: "r-1", slot: "worker-1" }),
    runRow({ runId: "r-2", slot: "worker-2" }),
  ]);
  const released = releaseAndRequeue({ runs, slotId: "worker-1", runId: "r-1", status: "submitted" });
  assert.equal(released.freedSlot, "worker-1");
  assert.deepEqual(released.busySlots, ["worker-2"], "второй слот продолжает работать");
  assert.match(released.next, /ход свободен/);
});

test("второй слот в том же окне не считается свободным до отчёта", () => {
  const runs = parseRuns([runRow({ runId: "r-2", slot: "worker-2" })]);
  const released = releaseAndRequeue({ runs, slotId: "worker-2", runId: "r-2" });
  assert.equal(released.freedSlot, "worker-2");
  assert.deepEqual(released.busySlots, []);
});

test("слот без работы не получает выдачу повторно", () => {
  const runs = parseRuns([runRow({ runId: "r-1", slot: "worker-1" })]);
  const free = assignable(slots, { state: new Map(), runs, maxParallelPerSlot: 1 });
  assert.ok(!free.some((slot) => slot.slotId === "worker-1"), "занятый слот не в списке свободных");
  assert.ok(free.some((slot) => slot.slotId === "worker-2"));
});

test("аккаунт в лимите выключает свой слот с внятной причиной", () => {
  const state = accountState(slots.map((slot) => slot.account), {
    limits: [limitMark("Creative36711@yandex.ru", { role: "Technical Artist" })],
    now: Date.now(),
  });
  const worker1 = slots.find((slot) => slot.slotId === "worker-1");
  const gate = slotGate(worker1, { state, liveRuns: [] });
  assert.equal(gate.ok, false);
  assert.match(gate.why, /в лимите до/);

  const plans = planBatch({ slots, queue: parseQueue([queueRow({ id: "q-1" })]), runs: [], state, maxParallel: 2 });
  assert.ok(plans.plans.every((plan) => plan.slot.slotId !== "worker-1"), "в слот с исчерпанной квотой работа не идёт");
});

test("просроченный лимит не держит слот закрытым", () => {
  const mark = limitMark("Creative36711@yandex.ru");
  const state = accountState(["creative36711@yandex.ru"], { limits: [mark], now: mark.until + 1000 });
  const worker1 = slots.find((slot) => slot.slotId === "worker-1");
  assert.equal(slotGate(worker1, { state, liveRuns: [] }).ok, true);
});

test("административная роль идёт на административный слот", () => {
  // Функция в строке очереди — единственный источник, который есть всегда.
  const queue = parseQueue([queueRow({ id: "q-1", role: "Coordinator" })]);
  queue[0]["Функция"] = "Coordinator";
  const plan = planOne({ slots, queue, runs: [], roles: [], state: new Map() });
  assert.equal(plan.ok, true);
  assert.equal(plan.slot.slotId, "admin", "Coordinator живёт только в административном слоте");
});

test("занятый админский слот не отдаёт административную роль рабочему", () => {
  const queue = parseQueue([queueRow({ id: "q-1", role: "Coordinator" })]);
  queue[0]["Функция"] = "Coordinator";
  const runs = parseRuns([runRow({ runId: "r-9", slot: "admin", role: "Warden" })]);
  const plan = planOne({ slots, queue, runs, roles: [], state: new Map() });
  assert.equal(plan.ok, false, "лучше подождать, чем съесть квоту исполнителя");
  assert.match(plan.why, /административн/);
});

test("явно названный слот сильнее правила выбора", () => {
  const queue = parseQueue([queueRow({ id: "q-1", slot: "worker-3" })]);
  const plan = planOne({ slots, queue, runs: [], roles: [], state: new Map() });
  assert.equal(plan.ok, true);
  assert.equal(plan.slot.slotId, "worker-3");
});

test("сводка очереди показывает занятые и свободные слоты", () => {
  const runs = parseRuns([runRow({ runId: "r-1", slot: "worker-1" }), runRow({ runId: "r-2", slot: "worker-2" })]);
  const summary = queueSummary({
    queue: parseQueue([queueRow({ id: "q-1" }), queueRow({ id: "q-2", status: "blocked", at: "2026-11-26T10:01:00Z" })]),
    runs,
    slots,
  });
  assert.equal(summary.inFlight, 2);
  assert.equal(summary.waiting, 1);
  assert.equal(summary.blocked, 1);
  assert.deepEqual(summary.busySlots.sort(), ["worker-1", "worker-2"]);
  assert.deepEqual(summary.idleSlots.sort(), ["admin", "worker-3"]);
});

test("решение о количестве объясняет причину отказа словами", () => {
  const busy = planDispatch({
    queueSummary: { waiting: 5, idleSlots: [] },
    maxParallel: 2,
  });
  assert.equal(busy.count, 0);
  assert.match(busy.why, /заняты/);

  const empty = planDispatch({ queueSummary: { waiting: 0, idleSlots: ["worker-1"] }, maxParallel: 2 });
  assert.equal(empty.count, 0);
  assert.match(empty.why, /нет свободной работы/);
});
