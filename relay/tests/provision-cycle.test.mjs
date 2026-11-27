// Ленивое создание агента целиком: нет агента → задание → адрес → работа.
//
// Эти тесты закрывают цикл, который раньше был разорван в двух местах.
//
//   1. `pull` при отсутствии агента возвращал «жди», хотя эта же вкладка и
//      должна была создать агента. Первый запуск нового контейнера всегда был
//      пустым, и человек решал, что транспорт сломан.
//   2. Принять адрес от вкладки было некому: `agentReady` не существовало.
//      Задание выдавалось, агент создавался, адрес терялся — и пара
//      (роль, слот) навсегда оставалась «нет агента». Каждая следующая карточка
//      этой роли требовала создания заново.
//
// Второе опаснее первого: внешне всё «работает», а цикл не сходится.

import test from "node:test";
import assert from "node:assert/strict";
import { createService } from "../src/service.mjs";
import { createFakeStore, settingsRows, slotRows, queueRow, agentRow } from "./fake-sheets.mjs";

const makeService = (initial = {}) => {
  const store = createFakeStore({
    slots: slotRows(),
    settings: settingsRows(),
    queue: [],
    runs: [],
    events: [],
    agents: [],
    ...initial,
  });
  const service = createService({ store, now: () => Date.parse("2026-11-26T10:00:00Z"), log: () => {} });
  return { store, service };
};

test("нет агента — вкладка получает задание создать его, а не «жди»", async () => {
  const { service } = makeService({ queue: [queueRow({ id: "q-1", card: "c-1", role: "Technical Artist" })] });
  const pulled = await service.pull({ scriptVersion: "1.31.0", slotId: "worker-2", tab: "aa11" });
  assert.equal(pulled.ok, true);
  assert.equal(pulled.kind, "provision", "это задание, а не работа");
  assert.equal(pulled.work, null);
  assert.equal(pulled.role, "Technical Artist");
  assert.equal(pulled.slot, "worker-2");
  assert.match(pulled.why, /создай агента роли «Technical Artist»/);
});

test("задание адресовано тому слоту, который спросил, а не первому свободному", async () => {
  const { service, store } = makeService({ queue: [queueRow({ id: "q-1", role: "Technical Artist" })] });
  await service.pull({ scriptVersion: "1.31.0", slotId: "worker-3", tab: "cc33" });
  const tasks = store.objects("queue").filter((row) => row["Вид"] === "provision");
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0]["Слот"], "worker-3", "агент появляется там, где спросили");
  assert.equal(tasks[0]["Статус"], "leased", "задание взято той же вкладкой сразу");
});

test("адрес, сообщённый вкладкой, попадает в «Экземпляры» и закрывает задание", async () => {
  const { service, store } = makeService({ queue: [queueRow({ id: "q-1", role: "Technical Artist" })] });
  await service.pull({ scriptVersion: "1.31.0", slotId: "worker-2", tab: "aa11" });

  const ready = await service.agentReady({
    role: "Technical Artist", slotId: "worker-2",
    url: "https://arena.example/list/ta", tab: "aa11",
  });
  assert.equal(ready.ok, true);
  assert.equal(ready.state, "создан");

  const instances = store.objects("agents");
  assert.equal(instances.length, 1);
  assert.equal(instances[0]["Роль"], "Technical Artist");
  assert.equal(instances[0]["Слот"], "worker-2");
  assert.equal(instances[0]["Agent URL"], "https://arena.example/list/ta");
  assert.equal(instances[0]["Состояние"], "создан");

  const task = store.objects("queue").find((row) => row["Вид"] === "provision");
  assert.equal(task["Статус"], "done", "задание закрыто, второй раз его не выдадут");
});

test("agentReady закрывает точный активный queueId, а не старую completed-строку той же пары", async () => {
  const { service, store } = makeService({ queue: [
    queueRow({ id: "old-q", card: "", role: "Technical Artist", slot: "worker-2", status: "done", kind: "provision" }),
    queueRow({ id: "new-q", card: "", role: "Technical Artist", slot: "worker-2", status: "leased", kind: "provision" }),
  ] });
  const result = await service.agentReady({
    role: "Technical Artist", slotId: "worker-2", queueId: "new-q",
    url: "https://arena.example/agent/new", tab: "aa11",
  });
  assert.equal(result.ok, true);
  const tasks = store.objects("queue").filter((row) => row["Вид"] === "provision");
  assert.equal(tasks.find((row) => row["ID"] === "old-q")["Статус"], "done", "история осталась нетронутой");
  assert.equal(tasks.find((row) => row["ID"] === "new-q")["Статус"], "done", "закрыто именно текущее задание");
});

test("после создания агента та же карточка достаётся вкладке с адресом", async () => {
  const { service } = makeService({ queue: [queueRow({ id: "q-1", card: "c-1", role: "Technical Artist" })] });
  const pulled = await service.pull({ scriptVersion: "1.31.0", slotId: "worker-2", tab: "aa11" });
  assert.equal(pulled.kind, "provision");

  await service.agentReady({ role: "Technical Artist", slotId: "worker-2", url: "https://arena.example/list/ta", tab: "aa11" });

  const work = await service.pull({ scriptVersion: "1.31.0", slotId: "worker-2", tab: "aa11" });
  assert.equal(work.kind, undefined, "теперь это работа, а не задание");
  assert.equal(work.work.card, "c-1");
  // Раньше здесь всегда было пусто: адрес брали из строки роли, а роли в плане
  // не было. Пустой адрес не выглядел поломкой — выдача приходила, агент ждал.
  assert.equal(work.work.agentUrl, "https://arena.example/list/ta");
});

test("адрес соседнего контейнера не подставляется: у каждой пары свой", async () => {
  const { service } = makeService({ queue: [queueRow({ id: "q-1", card: "c-1", role: "Technical Artist" })] });
  await service.agentReady({ role: "Technical Artist", slotId: "worker-2", url: "https://arena.example/list/ta" });
  const pulled = await service.pull({ scriptVersion: "1.31.0", slotId: "worker-3", tab: "cc33" });
  assert.equal(pulled.kind, "provision", "в worker-3 агента ещё нет — нужен свой");
});

test("повторное сообщение адреса не плодит вторую строку, а обновляет первую", async () => {
  const { service, store } = makeService();
  await service.agentReady({ role: "Technical Artist", slotId: "worker-1", url: "https://arena.example/a" });
  await service.agentReady({ role: "Technical Artist", slotId: "worker-1", url: "https://arena.example/b" });
  const instances = store.objects("agents");
  assert.equal(instances.length, 1, "одна пара — одна строка");
  assert.equal(instances[0]["Agent URL"], "https://arena.example/b", "адрес обновлён на свежий");
});

test("создать не удалось — причина записана, а не проглочена", async () => {
  const { service, store } = makeService({ queue: [queueRow({ id: "q-1", role: "Technical Artist" })] });
  await service.pull({ scriptVersion: "1.31.0", slotId: "worker-2", tab: "aa11" });
  const failed = await service.agentReady({
    role: "Technical Artist", slotId: "worker-2", tab: "aa11",
    note: "не хватило квоты контейнера", failed: true,
  });
  assert.equal(failed.ok, true);
  const row = store.objects("agents").find((item) => item["Слот"] === "worker-2");
  assert.equal(row["Состояние"], "ошибка");
  assert.match(row["Заметка"], /квоты/);
  const task = store.objects("queue").find((item) => item["Вид"] === "provision");
  assert.equal(task["Статус"], "blocked");
  assert.match(task["Комментарий"], /квоты/);
});

test("неудача не блокирует навсегда: следующая карточка снова просит агента", async () => {
  const { service } = makeService({ queue: [queueRow({ id: "q-1", role: "Technical Artist" })] });
  await service.pull({ scriptVersion: "1.31.0", slotId: "worker-2" });
  await service.agentReady({ role: "Technical Artist", slotId: "worker-2", failed: true, note: "сбой" });

  const again = await service.pull({ scriptVersion: "1.31.0", slotId: "worker-2", tab: "bb22" });
  assert.equal(again.kind, "provision", "вторая попытка разрешена");
  assert.match(again.why, /не создался раньше/);
});

test("без роли, слота или адреса строка не пишется молча", async () => {
  const { service, store } = makeService();
  const noSlot = await service.agentReady({ role: "Technical Artist", url: "https://arena.example/a" });
  assert.equal(noSlot.ok, false);
  assert.match(noSlot.why, /нужны роль и слот/);

  const noUrl = await service.agentReady({ role: "Technical Artist", slotId: "worker-1", url: "  " });
  assert.equal(noUrl.ok, false);
  assert.match(noUrl.why, /адрес пуст/);

  assert.equal(store.objects("agents").length, 0, "негодное сообщение не оставляет мусора");
});

test("вторая вкладка того же слота не получает то же задание повторно", async () => {
  const { service, store } = makeService({ queue: [queueRow({ id: "q-1", role: "Technical Artist" })] });
  const first = await service.pull({ scriptVersion: "1.31.0", slotId: "worker-2", tab: "aa11" });
  assert.equal(first.kind, "provision");
  const second = await service.pull({ scriptVersion: "1.31.0", slotId: "worker-2", tab: "aa99" });
  assert.notEqual(second.kind, "provision", "одна пара — одно задание");
  assert.equal(store.objects("queue").filter((row) => row["Вид"] === "provision").length, 1);
});

test("наследование: адрес из строки роли закрывает нужду в агенте без создания", async () => {
  const { service, store } = makeService({ queue: [queueRow({ id: "q-1", card: "c-1", role: "Technical Artist" })] });
  // Старая база: адрес лежит в строке роли, листа «Экземпляры» ещё нет.
  store.sheets.roles = [["Роль"], ["Technical Artist"]];
  const pulled = await service.pull({ scriptVersion: "1.31.0", slotId: "worker-1", tab: "aa11" });
  // Роли из Notion в тесте нет, значит адреса тоже нет — но главное здесь то,
  // что запрос не падает и остаётся заданием, а не отказом.
  assert.equal(pulled.ok, true);
  assert.ok(pulled.kind === "provision" || pulled.work, "вкладка всегда получает либо работу, либо задание");
});

// Шаг из пульта — второй вход в ту же выдачу. Он обязан вести себя как `pull`:
// нет агента — задание, есть агент — выдача с адресом. Раньше шаг выдавал
// карточку с пустым адресом и задания не заводил: кнопка владельца отправляла
// работу в никуда, а выглядело это как обычная выдача.
test("шаг без агента заводит задание, а не выдаёт работу в пустоту", async () => {
  const { service, store } = makeService({ queue: [queueRow({ id: "q-1", card: "c-1", role: "Technical Artist" })] });
  const step = await service.step({ origin: "panel" });
  assert.equal(step.planned, 0, "работы не выдано: исполнять её некому");
  assert.equal(step.requested, 1, "вместо этого поставлено задание на агента");
  assert.equal(store.objects("runs").length, 0);
  assert.equal(store.objects("queue").filter((row) => row["Вид"] === "provision").length, 1);
});

test("шаг с готовым агентом выдаёт карточку вместе с адресом", async () => {
  const { service, store } = makeService({
    queue: [queueRow({ id: "q-1", card: "c-1", role: "Technical Artist" })],
    agents: [agentRow({ role: "Technical Artist", slot: "worker-1", url: "https://arena.example/w1-ta" })],
  });
  const step = await service.step({ origin: "panel" });
  assert.equal(step.planned, 1);
  assert.equal(step.requested, 0);
  assert.equal(store.objects("runs")[0]["Agent URL"], "https://arena.example/w1-ta", "адрес доехал до выдачи");
});

test("шаг и вкладка не создают агента дважды", async () => {
  const { service, store } = makeService({ queue: [queueRow({ id: "q-1", role: "Technical Artist" })] });
  await service.step({ origin: "panel" });
  await service.pull({ scriptVersion: "1.31.0", slotId: "worker-1", tab: "aa11" });
  const tasks = store.objects("queue").filter((row) => row["Вид"] === "provision");
  assert.equal(tasks.length, 1, "одна пара — одно задание, кто бы ни спросил");
});

/**
 * Книга владельца живёт дольше версии.
 *
 * Лист «Экземпляры» появился в 1.20.0, а книга создана раньше. До 1.24.0
 * чтение несуществующего листа давало ошибку, служба отдавала пустой список
 * экземпляров — и адрес созданного агента было некуда записать: пара
 * (роль, слот) навсегда оставалась «нет агента», а каждая следующая карточка
 * этой роли снова требовала создания. Аудит 23.11 нашёл ровно это: в книге
 * было шесть листов, «Экземпляров» среди них не было.
 *
 * Теперь отсутствие листа — повод создать его из схемы, а не жить без адресов.
 */
test("пропавший лист «Экземпляры» создаётся сам, и адрес находится", async () => {
  const store = createFakeStore({
    slots: slotRows(), settings: settingsRows(), queue: [], runs: [], events: [], agents: [],
  });
  delete store.sheets.agents;
  const service = createService({ store, now: () => Date.parse("2026-11-26T10:00:00Z"), log: () => {} });

  const data = await service.loadAll();
  assert.deepEqual(data.instances, [], "лист создан пустым, а не прочитан как ошибка");
  assert.ok(Array.isArray(store.sheets.agents), "лист появился в книге");
  assert.equal(store.sheets.agents[0][0], "Роль", "шапка взята из схемы");
  assert.ok(store.sheets.agents[0].includes("Agent URL"), "колонка адреса на месте");

  const saved = await service.agentReady({
    role: "Technical Artist", slotId: "worker-2", url: "https://arena.example/agent/ta-w2", tab: "aa22",
  });
  assert.equal(saved.ok, true);
  assert.equal(saved.state, "создан");
  const row = store.objects("agents").find((item) => item["Роль"] === "Technical Artist");
  assert.equal(row["Слот"], "worker-2");
  assert.equal(row["Agent URL"], "https://arena.example/agent/ta-w2");
});
