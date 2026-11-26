// Служба целиком: вкладка спрашивает, человек жмёт, отчёты разбираются.
//
// Эти тесты фиксируют поведение, которое раньше было невозможно: вкладка не
// держит очередь, работает без общего хранилища с другими вкладками, а отказ
// разбора объясняется словами и сопровождается пакетом инцидента.

import test from "node:test";
import assert from "node:assert/strict";
import { createService } from "../src/service.mjs";
import { createFakeStore, settingsRows, slotRows, queueRow, runRow, eventRow, agentRow, knownAgentRows } from "./fake-sheets.mjs";

const makeService = (initial = {}, { nowMs } = {}) => {
  const store = createFakeStore({
    slots: slotRows(),
    settings: settingsRows(),
    queue: [],
    runs: [],
    events: [],
    // Агенты уже созданы: эти тесты про выдачу и учёт, а не про ленивое
    // создание. Цикл «сначала создать агента» проверяется отдельно ниже.
    agents: knownAgentRows(),
    ...initial,
  });
  let clock = nowMs || Date.now();
  const service = createService({
    store,
    now: () => clock,
    slotsCacheMs: 0,
    log: () => {},
  });
  return { store, service, advance: (ms) => { clock += ms; }, setClock: (ms) => { clock = ms; } };
};

test("вкладка опознаётся по аккаунту, а не по имени контейнера", async () => {
  const { service } = makeService();
  const hello = await service.hello({ account: "Creative36711@yandex.ru", tab: "ab12" });
  assert.equal(hello.ok, true);
  assert.equal(hello.slot.slotId, "worker-1");
  assert.equal(hello.slot.admin, false);
});

test("неизвестный аккаунт получает отказ с подсказкой", async () => {
  const { service, store } = makeService();
  const hello = await service.hello({ account: "someone@example.com", tab: "zz99" });
  assert.equal(hello.ok, false);
  assert.match(hello.why, /не привязан ни к одному слоту/);
  assert.equal(hello.slots.length, 4);
  const events = store.objects("events");
  assert.ok(events.some((event) => event["Уровень"] === "warn" && /не опознана/.test(event["Текст"])));
});

test("две вкладки получают работу одновременно и не мешают друг другу", async () => {
  const { service, store } = makeService({
    queue: [
      queueRow({ id: "q-1", card: "c-1", role: "Technical Artist" }),
      queueRow({ id: "q-2", card: "c-2", role: "Godot World Engineer", at: "2026-11-26T10:01:00Z" }),
    ],
  });
  const first = await service.pull({ slotId: "worker-1", tab: "aa11" });
  const second = await service.pull({ slotId: "worker-2", tab: "bb22" });
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.notEqual(first.work.card, second.work.card, "одна карточка не должна уйти дважды");
  assert.equal(store.objects("runs").length, 2, "обе выдачи записаны в таблицу");
});

test("повторный pull возвращает ту же выдачу, а не новую", async () => {
  const { service, store } = makeService({
    queue: [queueRow({ id: "q-1", role: "Technical Artist" })],
  });
  const first = await service.pull({ slotId: "worker-1", tab: "aa11" });
  const again = await service.pull({ slotId: "worker-1", tab: "aa11" });
  assert.equal(again.work.runId, first.work.runId);
  assert.equal(again.work.repeated, true);
  assert.equal(store.objects("runs").length, 1);
});

test("отчёт освобождает слот и возвращает ход, не дожидаясь второго", async () => {
  const { service, store } = makeService({
    queue: [
      queueRow({ id: "q-1", card: "c-1", role: "Technical Artist" }),
      queueRow({ id: "q-2", card: "c-2", role: "Godot World Engineer", at: "2026-11-26T10:01:00Z" }),
    ],
  });
  const first = await service.pull({ slotId: "worker-1" });
  const second = await service.pull({ slotId: "worker-2" });
  const report = await service.report({
    slotId: "worker-1",
    payload: { runId: first.work.runId, markerRunId: first.work.runId, markerCard: first.work.card, answer: "готово" },
  });
  assert.equal(report.ok, true);
  assert.equal(report.freedSlot, "worker-1");
  assert.deepEqual(report.busySlots, ["worker-2"], "второй слот ещё работает");

  const runs = store.objects("runs");
  assert.equal(runs.find((run) => run["Run ID"] === first.work.runId)["Статус"], "submitted");
  assert.equal(runs.find((run) => run["Run ID"] === second.work.runId)["Статус"], "issued");
});

test("чужой run id в маркере — не потеря хода, а разбор с пакетом", async () => {
  const { service } = makeService({
    queue: [queueRow({ id: "q-1", card: "c-1", role: "Technical Artist" })],
  });
  const pulled = await service.pull({ slotId: "worker-1" });
  const report = await service.report({
    slotId: "worker-1",
    payload: { runId: pulled.work.runId, markerRunId: "r-00000000000000-deadbeef", markerCard: "c-1" },
  });
  assert.equal(report.ok, false);
  assert.match(report.why, /маркер называет run/);
  assert.ok(report.incident, "к отказу приложен пакет инцидента");
  assert.match(report.incident.text, /Чей это run id/);
  assert.match(report.incident.text, /Все живые выдачи/);
});

test("закрытая выдача не принимает ответ повторно", async () => {
  const { service } = makeService({
    queue: [queueRow({ id: "q-1", card: "c-1" })],
  });
  const pulled = await service.pull({ slotId: "worker-1" });
  await service.report({ slotId: "worker-1", payload: { runId: pulled.work.runId, markerRunId: pulled.work.runId } });
  const second = await service.beat({ slotId: "worker-1", runId: pulled.work.runId });
  assert.equal(second.ok, false);
  assert.match(second.why, /уже submitted/);
});

test("шаг в ручном режиме считает выдачу и не выдаёт лишнего", async () => {
  const { service } = makeService({
    queue: [
      queueRow({ id: "q-1", role: "Technical Artist" }),
      queueRow({ id: "q-2", card: "c-2", role: "Godot World Engineer", at: "2026-11-26T10:01:00Z" }),
      queueRow({ id: "q-3", card: "c-3", role: "Technical Artist", at: "2026-11-26T10:02:00Z" }),
    ],
  });
  const step = await service.step({ origin: "panel" });
  assert.equal(step.ok, true);
  assert.ok(step.planned >= 1);
  // Предел из настроек — 2, слотов рабочих три: две карточки, не три.
  assert.ok(step.planned <= 2, `выдано ${step.planned}, предел 2`);
});

test("автоцикл не работает, пока режим ручной", async () => {
  const { service } = makeService({ queue: [queueRow({ id: "q-1" })] });
  const auto = await service.step({ origin: "auto" });
  assert.equal(auto.ok, true);
  assert.equal(auto.work, null);
  assert.match(auto.why, /режим ручной/);
});

test("пауза и снятие паузы видны в снимке и журнале", async () => {
  const { service, store } = makeService();
  await service.pause({ reason: "проверяю" });
  let shot = await service.snapshot();
  assert.equal(shot.paused, true);
  assert.equal(shot.pauseReason, "проверяю");

  await service.resume();
  shot = await service.snapshot();
  assert.equal(shot.paused, false);

  const ui = store.objects("events").filter((event) => event["Вид"] === "ui");
  assert.equal(ui.length, 2, "оба действия человека попали в журнал");
});

test("снимок показывает слоты, очередь и живые выдачи одним ответом", async () => {
  const { service } = makeService({
    queue: [queueRow({ id: "q-1", role: "Technical Artist" })],
  });
  await service.pull({ slotId: "worker-1" });
  const shot = await service.snapshot();
  assert.equal(shot.slots.length, 4);
  assert.equal(shot.counts.inFlight, 1);
  const busy = shot.slots.find((slot) => slot.slotId === "worker-1");
  assert.equal(busy.state, "работает");
  assert.equal(busy.runs.length, 1);
});

test("удар с молчанием короче стража не засоряет журнал", async () => {
  const { service, store } = makeService({ queue: [queueRow({ id: "q-1" })] });
  const pulled = await service.pull({ slotId: "worker-1" });
  await service.beat({ slotId: "worker-1", runId: pulled.work.runId, silentMs: 30000 });
  const guard = store.objects("events").filter((event) => event["Вид"] === "guard");
  assert.equal(guard.length, 0, "30 секунд — это не инцидент");

  await service.beat({ slotId: "worker-1", runId: pulled.work.runId, silentMs: 200000 });
  const after = store.objects("events").filter((event) => event["Вид"] === "guard");
  assert.equal(after.length, 1, "молчание дольше стража — событие");
});

test("неизвестный протокол отклоняется до исполнения", async () => {
  const { service, store } = makeService();
  const before = store.objects("events").length;
  const result = await service.handle({ action: "pull", v: 99, slotId: "worker-1" });
  assert.equal(result.ok, false);
  assert.match(result.why, /протокол/);
  assert.equal(store.objects("events").length, before, "отклонённый запрос ничего не пишет");
});

test("шаг действительно выдаёт: строка занята, выдача создана", async () => {
  const { service, store } = makeService({
    queue: [
      queueRow({ id: "q-1", card: "c-1", role: "Technical Artist" }),
      queueRow({ id: "q-2", card: "c-2", role: "Godot World Engineer", at: "2026-11-26T10:01:00Z" }),
    ],
  });
  const step = await service.step({ origin: "panel" });
  assert.equal(step.planned, 2);
  const runs = store.objects("runs");
  assert.equal(runs.length, 2, "выдачи записаны, а не только запланированы");
  const queue = store.objects("queue");
  assert.ok(queue.every((row) => row["Статус"] === "leased"), "строки помечены занятыми");
  assert.ok(queue.every((row) => row["Взял слот"]), "видно, кто взял");
});

test("вкладка не обходит предел одновременности", async () => {
  const { service } = makeService({
    queue: [
      queueRow({ id: "q-1", card: "c-1", role: "Technical Artist" }),
      queueRow({ id: "q-2", card: "c-2", role: "Godot World Engineer", at: "2026-11-26T10:01:00Z" }),
      queueRow({ id: "q-3", card: "c-3", role: "Tactical Bridge Engineer", at: "2026-11-26T10:02:00Z" }),
    ],
  });
  const first = await service.pull({ slotId: "worker-1" });
  const second = await service.pull({ slotId: "worker-2" });
  assert.equal(first.work !== null, true);
  assert.equal(second.work !== null, true);

  // Предел 2 исчерпан: третья вкладка получает «жди» с причиной.
  const third = await service.pull({ slotId: "worker-3" });
  assert.equal(third.work, null);
  assert.match(third.why, /предел одновременности: уже идёт 2 из 2/);
});

test("после отчёта одной вкладки третья получает работу", async () => {
  const { service } = makeService({
    queue: [
      queueRow({ id: "q-1", card: "c-1", role: "Technical Artist" }),
      queueRow({ id: "q-2", card: "c-2", role: "Godot World Engineer", at: "2026-11-26T10:01:00Z" }),
      queueRow({ id: "q-3", card: "c-3", role: "Tactical Bridge Engineer", at: "2026-11-26T10:02:00Z" }),
    ],
  });
  const first = await service.pull({ slotId: "worker-1" });
  await service.pull({ slotId: "worker-2" });
  await service.report({ slotId: "worker-1", payload: { runId: first.work.runId, markerRunId: first.work.runId } });
  const third = await service.pull({ slotId: "worker-3" });
  assert.equal(third.work.card, "c-3", "освободившееся место занимает следующая карточка");
});

test("снятая строка не выдаётся", async () => {
  const { service } = makeService({ queue: [queueRow({ id: "q-1", card: "c-1" })] });
  const cancelled = await service.cancel({ itemId: "q-1" });
  assert.equal(cancelled.ok, true);
  const pulled = await service.pull({ slotId: "worker-1" });
  assert.equal(pulled.work, null);
});

test("занятую строку нельзя снять — сначала отчёт", async () => {
  const { service } = makeService({ queue: [queueRow({ id: "q-1", card: "c-1", role: "Technical Artist" })] });
  await service.step({ origin: "panel" });
  const cancelled = await service.cancel({ itemId: "q-1" });
  assert.equal(cancelled.ok, false);
  assert.match(cancelled.why, /сначала нужен отчёт/);
});

test("карточка не ставится в очередь дважды", async () => {
  const { service } = makeService();
  const added = await service.enqueue({ card: "c-77", title: "Первая", role: "Technical Artist" });
  assert.equal(added.ok, true);
  const again = await service.enqueue({ card: "c-77", role: "Technical Artist" });
  assert.equal(again.ok, false);
  assert.match(again.why, /уже в очереди/);
});
