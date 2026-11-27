// Ход цикла (D-025): Координатор → приёмка → конец, ровно как в ScriptCat.
//
// Служба исполняет машинерию хода: кто держит очередь решений, что происходит
// при next:"done" и при вердикте приёмки (accept/rework/master), и как шаг
// называет правду вместо «выдач 0». Маркеры читаются так же, как в вкладке
// (D-067): строгое имя → мягкое написание → характерные ключи; вердикт —
// только из закрытого списка.

import test from "node:test";
import assert from "node:assert/strict";
import { parseTurnMarker, REVIEW_VERDICTS } from "../src/markers.mjs";
import { createService } from "../src/service.mjs";
import { createFakeStore, settingsRows, slotRows, queueRow, knownAgentRows } from "./fake-sheets.mjs";

const makeService = (initial = {}) => {
  const store = createFakeStore({
    slots: slotRows(),
    settings: settingsRows(),
    queue: [],
    runs: [],
    events: [],
    // Координатор и приёмка живут в административном слоте: без экземпляров
    // pull честно ответил бы «создать агента», а не выдачей.
    agents: knownAgentRows(["Technical Artist", "Godot World Engineer", "Tactical Bridge Engineer", "Coordinator", "Reviewer"], ["worker-1", "worker-2", "worker-3", "admin"]),
    ...initial,
  });
  let clock = Date.now();
  const service = createService({
    store,
    now: () => clock,
    slotsCacheMs: 0,
    log: () => {},
  });
  return { store, service, advance: (ms) => { clock += ms; } };
};

const settingsValue = (store, key) => {
  // objects() отдаёт строки как словари по шапке листа: Ключ/Значение.
  const row = store.objects("settings").find((item) => item["Ключ"] === key);
  return row ? String(row["Значение"] ?? "") : "";
};

// ─── Разбор маркеров ────────────────────────────────────────────────────────

test("маркер Координатора: next: done передаёт миссию приёмке", () => {
  const raw = 'CF_COORDINATOR_RESULT mission_id "m-1", turn_id "t-1" {"next":"done"}';
  assert.deepEqual(parseTurnMarker(raw), { kind: "coordinator", next: "done" });
});

test("маркер Координатора читается и без имени — JSON сам по себе (D-067)", () => {
  // Живой случай вкладки: последняя строка — JSON без литерала маркера.
  assert.deepEqual(parseTurnMarker('{"next":"Godot World Engineer"}'), {
    kind: "coordinator",
    next: "Godot World Engineer",
  });
});

test("вопрос Координатора не затирает решение: главный объект — внешний", () => {
  const raw = 'CF_COORDINATOR_RESULT {"next":"done","question":{"id":"q-1","default":"оставить как есть"}}';
  assert.deepEqual(parseTurnMarker(raw), { kind: "coordinator", next: "done" });
});

test("вердикты приёмки: accept, rework, master — и только они", () => {
  for (const verdict of REVIEW_VERDICTS) {
    const raw = `CF_REVIEW_RESULT mission_id "m-1", turn_id "t-1" {"verdict":"${verdict}"}`;
    assert.deepEqual(parseTurnMarker(raw), { kind: "review", verdict }, verdict);
  }
  assert.equal(parseTurnMarker('CF_REVIEW_RESULT {"verdict":"pass"}'), null, "чужой вердикт не принимается");
});

test("арбитраж ход не двигает: verdict + action — это CF_ARBITER_RESULT", () => {
  const raw = 'CF_ARBITER_RESULT dispatch_id "d-1" {"verdict":"resolve","action":"rework","fix":"..."}';
  assert.equal(parseTurnMarker(raw), null);
});

test("сдача карточки и мусор ход не двигают", () => {
  assert.equal(parseTurnMarker('CF_AGENT_RESULT dispatch_id "d-1", run_id "r-1" {"status":"submitted"}'), null);
  assert.equal(parseTurnMarker("просто текст ответа"), null);
  assert.equal(parseTurnMarker(""), null);
});

// ─── Шаг называет ход, а не «выдач 0» ───────────────────────────────────────

test("пустая очередь — планирующий ход Координатора, а не «выдач 0»", async () => {
  const { service, store } = makeService();
  const step = await service.step({ origin: "pulse" });
  assert.equal(step.ok, true);
  assert.equal(step.planned, 0);
  assert.match(step.why, /ход у Координатора: очередь пуста/);
  const journal = store.objects("events").map((event) => event["Текст"]);
  assert.ok(journal.some((text) => /шаг: ход у Координатора/.test(text)), "журнал называет ход");
  assert.ok(!journal.some((text) => /шаг: выдач 0/.test(text)), "старой формулировки «выдач 0» больше нет");
});

test("hello остаётся видимым пульту при локальной паузе и отражает её снятие", async () => {
  const { service } = makeService();
  await service.hello({ account: "creative36711@gmail.com", tab: "admin-paused", scriptVersion: "1.28.0", localPaused: true });
  let snapshot = await service.snapshot();
  let admin = snapshot.scriptClients.find((client) => client.slotId === "admin");
  assert.equal(admin.localPaused, true);
  assert.equal(admin.scriptVersion, "1.28.0");

  await service.hello({ account: "creative36711@gmail.com", tab: "admin-paused", scriptVersion: "1.28.0", localPaused: false });
  snapshot = await service.snapshot();
  admin = snapshot.scriptClients.find((client) => client.slotId === "admin");
  assert.equal(admin.localPaused, false);
});

test("кнопка пульта передаёт планирующий ход Coordinator-вкладке, ack можно повторить", async () => {
  const { service } = makeService();
  const step = await service.step({ origin: "panel" });
  assert.equal(step.turnRequested, true);
  assert.ok(step.turnRequestId);

  const oldClient = await service.pull({ slotId: "admin", tab: "old-admin", scriptVersion: "1.27.0" });
  assert.equal(oldClient.updateRequired, true, "предыдущий выпуск не получает сигнал/работу");
  const claimed = await service.pull({ slotId: "admin", tab: "admin-tab", scriptVersion: "1.28.0" });
  assert.equal(claimed.kind, "turn");
  assert.equal(claimed.turn, "coordinator");
  assert.equal(claimed.turnId, step.turnRequestId);
  const duplicateClaim = await service.pull({ slotId: "admin", tab: "admin-tab", scriptVersion: "1.28.0" });
  assert.notEqual(duplicateClaim.kind, "turn", "claim жив: повторный poll не запускает тот же план дважды");

  await service.report({ slotId: "admin", tab: "admin-tab", payload: { turnAck: true, turnRequestId: claimed.turnId, retry: true } });
  assert.equal(service.memory.coordinatorTurnRequest.claimedBy, "", "неуспешный запуск освобождает claim");
  const retried = await service.pull({ slotId: "admin", tab: "admin-tab", scriptVersion: "1.28.0" });
  assert.equal(retried.kind, "turn", "вкладка может повторить планирующий ход");
  await service.report({ slotId: "admin", tab: "admin-tab", payload: { turnAck: true, turnRequestId: retried.turnId } });
  assert.equal(service.memory.coordinatorTurnRequest, null, "успешный ack закрывает запрос");
});

test("ход приёмки: шаг ждёт вердикт, а не советует выдачу", async () => {
  const { service } = makeService({ settings: settingsRows({ "cycle.turn": "warden" }) });
  const step = await service.step({ origin: "pulse" });
  assert.match(step.why, /миссия у приёмки \(Warden\): ждёт accept или rework/);
});

test("ход завершён: шаг не выдаёт работу даже при живой очереди", async () => {
  const { service } = makeService({
    settings: settingsRows({ "cycle.turn": "done" }),
    queue: [queueRow({ id: "q-1", card: "c-1", role: "Technical Artist" })],
  });
  const step = await service.step({ origin: "pulse" });
  assert.equal(step.planned, 0, "после приёмки новых выдач нет");
  assert.match(step.why, /цикл завершён: миссия принята приёмкой/);
});

// ─── Маркеры двигают ход ────────────────────────────────────────────────────

const reportWith = async (service, markerRaw) => {
  // Строка очереди → выдача → принятый ответ с маркером хода.
  await service.enqueue({ card: "mission-card", title: "Миссия", role: "Coordinator", fn: "Coordinator", slotId: "admin" });
  const pulled = await service.pull({ scriptVersion: "1.28.0", slotId: "admin", tab: "admin-tab" });
  assert.equal(pulled.ok, true, pulled.why);
  return service.report({
    slotId: "admin",
    tab: "admin-tab",
    payload: {
      runId: pulled.work.runId,
      markerRunId: pulled.work.runId,
      markerCard: pulled.work.card,
      markerRaw,
      answer: "готово",
    },
  });
};

test("next: done переводит ход в приёмку", async () => {
  const { service, store } = makeService();
  const report = await reportWith(service, 'CF_COORDINATOR_RESULT {"next":"done"}');
  assert.equal(report.ok, true, report.why);
  assert.equal(settingsValue(store, "cycle.turn"), "warden");
  const journal = store.objects("events").map((event) => event["Текст"]);
  assert.ok(journal.some((text) => /передана приёмке \(Warden\)/.test(text)));
  assert.ok(store.objects("queue").some((item) => item["Статус"] === "done"), "принятый ответ закрывает строку очереди");
});

test("accept завершает цикл, rework возвращает Координатору с кругом", async () => {
  // Вердикт приёмки применяется, только когда ход у приёмки (FSM).
  const accepted = makeService({ settings: settingsRows({ "cycle.turn": "warden" }) });
  await reportWith(accepted.service, 'CF_REVIEW_RESULT {"verdict":"accept"}');
  assert.equal(settingsValue(accepted.store, "cycle.turn"), "done");
  assert.ok(accepted.store.objects("events").some((event) => /миссия принята — цикл завершён/.test(event["Текст"])));

  // Первый возврат: круг 1, ход Координатору.
  const returned = makeService({ settings: settingsRows({ "cycle.turn": "warden" }) });
  await reportWith(returned.service, 'CF_REVIEW_RESULT {"verdict":"rework"}');
  assert.equal(settingsValue(returned.store, "cycle.turn"), "coordinator");
  assert.equal(settingsValue(returned.store, "cycle.round"), "1");
  assert.ok(returned.store.objects("events").some((event) => /возврат \(круг 1\) — ход Координатору/.test(event["Текст"])));
});

test("четвёртый возврат будит Мастера: пауза с причиной, как во вкладке", async () => {
  const { service, store } = makeService({ settings: settingsRows({ "cycle.turn": "warden", "cycle.round": "3" }) });
  await reportWith(service, 'CF_REVIEW_RESULT {"verdict":"rework"}');
  assert.equal(settingsValue(store, "cycle.turn"), "coordinator");
  assert.equal(settingsValue(store, "cycle.round"), "4");
  const events = store.objects("events");
  assert.ok(events.some((event) => /лимит доработок \(3\), нужен Мастер/.test(event["Текст"])), "пауза названа причиной");
  const snapshot = await service.snapshot();
  assert.equal(snapshot.paused, true);
});

test("master ставит цикл на паузу: без владельца не продолжить", async () => {
  const { service, store } = makeService({ settings: settingsRows({ "cycle.turn": "warden" }) });
  await reportWith(service, 'CF_REVIEW_RESULT {"verdict":"master"}');
  const snapshot = await service.snapshot();
  assert.equal(snapshot.paused, true);
  assert.match(snapshot.pauseReason, /master — без владельца не продолжить/);
  assert.notEqual(snapshot.cycle.turn, "done", "мастер не закрывает миссию сам");
});

test("после завершённого цикла новая карточка в очереди открывает его заново", async () => {
  const { service, store } = makeService({ settings: settingsRows({ "cycle.turn": "done" }) });
  const queued = await service.enqueue({ card: "new-card", title: "Новая работа", role: "Technical Artist" });
  assert.equal(queued.ok, true);
  assert.equal(settingsValue(store, "cycle.turn"), "coordinator");
  assert.ok(store.objects("events").some((event) => /ход возвращён Координатору/.test(event["Текст"])));
});

test("снимок пульта несёт ход: строка запуска показывает, кто держит цикл", async () => {
  const { service } = makeService({ settings: settingsRows({ "cycle.turn": "warden", "cycle.round": "2" }) });
  const snapshot = await service.snapshot();
  assert.deepEqual(snapshot.cycle, { turn: "warden", round: 2 });
});

// ─── D-026: отчёты без выдачи и путь «выдача не состоялась» ─────────────────

test("маркер хода без выдачи (markerOnly): план и приёмка двигают FSM", async () => {
  const { service, store } = makeService();
  // Координатор: next done → приёмка.
  let res = await service.report({ slotId: "admin", tab: "t1", payload: { markerOnly: true, markerRaw: 'CF_COORDINATOR_RESULT {"next":"done"}' } });
  assert.equal(res.ok, true);
  assert.equal(res.applied, true);
  assert.equal(settingsValue(store, "cycle.turn"), "warden");
  // Повтор того же маркера — не дубль (FSM).
  res = await service.report({ slotId: "admin", tab: "t1", payload: { markerOnly: true, markerRaw: 'CF_COORDINATOR_RESULT {"next":"done"}' } });
  assert.equal(res.applied, false, "повторный done при ходе «warden» не применяется");
  // Приёмка: accept → цикл завершён.
  res = await service.report({ slotId: "admin", tab: "t1", payload: { markerOnly: true, markerRaw: 'CF_REVIEW_RESULT {"verdict":"accept"}' } });
  assert.equal(res.applied, true);
  assert.equal(settingsValue(store, "cycle.turn"), "done");
  // Вердикт вне хода приёмки — молча отклонён.
  res = await service.report({ slotId: "admin", tab: "t1", payload: { markerOnly: true, markerRaw: 'CF_REVIEW_RESULT {"verdict":"rework"}' } });
  assert.equal(res.applied, false, "rework при «done» не применяется");
  assert.equal(settingsValue(store, "cycle.turn"), "done");
  // Маркер без решения хода — ок, но ничего не двигает.
  res = await service.report({ slotId: "admin", tab: "t1", payload: { markerOnly: true, markerRaw: "просто текст" } });
  assert.equal(res.ok, true);
  assert.equal(res.applied, false);
});

test("выдача не состоялась: run failed, строка в blocked, слот свободен", async () => {
  const { service, store } = makeService({
    queue: [queueRow({ id: "q-1", card: "mission-card", role: "Technical Artist" })],
  });
  const pulled = await service.pull({ scriptVersion: "1.28.0", slotId: "worker-1" });
  assert.equal(pulled.ok, true);
  const res = await service.report({
    slotId: "worker-1",
    payload: { runId: pulled.work.runId, failed: true, why: "карточка не привязана к активной миссии" },
  });
  assert.equal(res.ok, false);
  assert.equal(res.failed, true);
  assert.match(res.why, /не состоялась/);
  const run = store.objects("runs").find((item) => item["Run ID"] === pulled.work.runId);
  assert.equal(run["Статус"], "failed");
  const row = store.objects("queue").find((item) => item["ID"] === "q-1");
  assert.equal(row["Статус"], "blocked");
  assert.match(String(row["Комментарий"]), /не привязана/);
  assert.equal(res.freedSlot, "worker-1", "слот освобождён — phantom'а нет");
  const journal = store.objects("events").map((event) => event["Текст"]);
  assert.ok(journal.some((text) => /выдача .* не состоялась/.test(text)));
});
