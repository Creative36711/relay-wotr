// Пределы на роль и на карточку.
//
// Главное, что здесь проверяется, — это отказ. Промпт Координатора можно
// написать как угодно подробно, но выполнять его будет модель: она забудет,
// перепутает или решит, что «на этот раз особо». Транспорт же обязан
// отказать всегда и одинаково — и у отказа должна быть причина, которую можно
// показать человеку.

import test from "node:test";
import assert from "node:assert/strict";
import { roleLimits, liveRunsOfRole, limitNotes, isLiveRun, byAccountCost, accountUsage } from "../src/limits.mjs";
import { planOne, planBatch } from "../src/dispatch.mjs";

const run = (over = {}) => ({
  "Run ID": "r-1", "Карточка": "card-1", "Роль": "Integration Auditor",
  "Слот": "worker-1", "Статус": "issued", ...over,
});

const slot = (id, admin = false) => ({
  slotId: id, container: `c-${id}`, account: `${id}@mail`, admin,
  status: "активен", enabled: true, note: "",
});

const queueItem = (over = {}) => ({
  "ID": "q-1", "Создано": "2026-11-23T10:00:00Z", "Карточка": "card-2",
  "Заголовок": "Доделать", "Роль": "Integration Auditor", "Функция": "Auditor",
  "Слот": "", "Вид": "dispatch", "Статус": "waiting", ...over,
});

test("limits: вторая карточка той же роли не выдаётся, даже в другой слот", () => {
  const result = roleLimits({ role: "Integration Auditor", card: "card-2", runs: [run()] });
  assert.equal(result.ok, false);
  assert.equal(result.kind, "role-busy");
  // Причина обязана называть слот и карточку: по ней человек разбирается.
  assert.match(result.why, /worker-1/);
  assert.match(result.why, /card-1/);
});

test("limits: другая роль выдаётся свободно", () => {
  const result = roleLimits({ role: "Godot World", card: "card-2", runs: [run()] });
  assert.equal(result.ok, true);
});

test("limits: предел на роль поднимается осознанно, но не отменяется", () => {
  const runs = [run()];
  assert.equal(roleLimits({ role: "Integration Auditor", card: "c-2", runs, maxPerRole: 2 }).ok, true);
  assert.equal(roleLimits({ role: "Integration Auditor", card: "c-3", runs: [run(), run({ "Run ID": "r-2" })], maxPerRole: 2 }).ok, false);
});

test("limits: одна карточка не выдаётся дважды ни при каком лимите", () => {
  const result = roleLimits({ role: "Godot World", card: "card-1", runs: [run({ "Роль": "Godot World" })], maxPerRole: 99 });
  assert.equal(result.ok, false);
  assert.equal(result.kind, "card-busy");
  assert.match(result.why, /уже выдана/);
});

test("limits: закрытая выдача не считается занятостью", () => {
  const done = run({ "Статус": "submitted" });
  assert.equal(isLiveRun(done), false);
  assert.equal(roleLimits({ role: "Integration Auditor", card: "card-2", runs: [done] }).ok, true);
  assert.deepEqual(liveRunsOfRole([done], "Integration Auditor"), []);
});

test("limits: перевыдача той же карточки после возврата хода не блокируется собой", () => {
  // releaseAndRequeue оставляет выдачу в истории; проверка не должна считать
  // её занятостью, иначе карточка не вернётся в работу никогда.
  const abandoned = run({ "Статус": "abandoned" });
  const result = roleLimits({ role: "Integration Auditor", card: "card-1", runs: [abandoned] });
  assert.equal(result.ok, true);
});

test("limits: имя роли сравнивается без учёта регистра и пробелов", () => {
  const result = roleLimits({ role: "  integration auditor ", card: "card-2", runs: [run()] });
  assert.equal(result.ok, false, "«Integration Auditor» и « integration auditor » — одна роль");
});

test("limits: диспетчер отказывает до захвата строки", () => {
  // Это важнее, чем кажется: после `lease` строку пришлось бы возвращать, а
  // вкладка могла её уже увидеть. Отказ обязан быть ДО захвата.
  const slots = [slot("worker-1"), slot("worker-2")];
  const queue = [queueItem()];
  const plan = planOne({
    slots, queue, runs: [run()], roles: [], state: new Map(), maxPerRole: 1,
  });
  assert.equal(plan.ok, false);
  assert.match(plan.why, /уже идёт работа/);
  // Строка осталась свободной — захвата не было.
  assert.equal(queue[0]["Статус"], "waiting");
});

test("limits: диспетчер разрешает другую роль в свободный слот", () => {
  const slots = [slot("worker-1"), slot("worker-2")];
  const queue = [queueItem({ "Роль": "Godot World", "Функция": "Executor" })];
  const plan = planOne({ slots, queue, runs: [run()], roles: [], state: new Map(), maxPerRole: 1 });
  assert.equal(plan.ok, true, plan.why);
  // worker-1 занят выдачей Integration Auditor, поэтому берётся свободный
  // worker-2. Это и есть асинхронность: новая роль не ждёт, пока освободится
  // именно тот контейнер, где шла предыдущая работа.
  assert.equal(plan.slot.slotId, "worker-2");
});

test("limits: примечание для промпта называет занятые и свободные роли", () => {
  const notes = limitNotes({
    roles: [{ name: "Integration Auditor" }, { name: "Godot World" }],
    runs: [run()], maxPerRole: 1, maxParallel: 2,
  });
  assert.deepEqual(notes.busy.map((item) => item.role), ["Integration Auditor"]);
  assert.deepEqual(notes.free, ["Godot World"]);
  assert.match(notes.text, /транспорт откажет/);
  assert.match(notes.text, /не больше 2/);
});

// ── Раскладка по квотам аккаунтов ───────────────────────────────────────────
//
// Владелец: «квота на аккаунт, а не на агента… на каждом аккаунте будут
// дублироваться все роли». Отсюда: роль доступна в нескольких слотах, и
// выбирать надо тот аккаунт, который сейчас дешевле потратить.

const accountSlot = (id, account, admin = false) => ({
  slotId: id, container: `c-${id}`, account, admin, status: "активен", enabled: true,
});

test("квоты: роль есть на всех аккаунтах — занятость одного слота не отказ", () => {
  const slots = [accountSlot("w1", "a@m"), accountSlot("w2", "b@m"), accountSlot("w3", "c@m")];
  const queue = [queueItem({ "Роль": "Godot World", "Функция": "Executor" })];
  const plan = planOne({
    slots, queue, runs: [run({ "Роль": "Integration Auditor", "Слот": "w1", "Аккаунт": "a@m" })],
    roles: [], state: new Map(), maxPerRole: 1,
  });
  assert.equal(plan.ok, true, plan.why);
  assert.notEqual(plan.slot.slotId, "w1", "занятый слот не выбран");
});

test("квоты: расход раскидывается ровно, а не сваливается на первый аккаунт", () => {
  const slots = [accountSlot("w1", "a@m"), accountSlot("w2", "b@m"), accountSlot("w3", "c@m")];
  // Первая выдача — на любой слот; вторая и третья обязаны пойти на другие
  // аккаунты, иначе первый сгорит за день, а остальные будут простаивать.
  const first = planOne({ slots, queue: [queueItem({ "ID": "q-1", "Карточка": "c1", "Роль": "R1" })], runs: [], state: new Map() });
  assert.equal(first.ok, true, first.why);
  const used = [first.slot.slotId];

  const second = planOne({
    slots, queue: [queueItem({ "ID": "q-2", "Карточка": "c2", "Роль": "R2" })],
    runs: [run({ "Слот": used[0], "Аккаунт": slots.find((s) => s.slotId === used[0]).account, "Роль": "R1", "Карточка": "c1" })],
    state: new Map(),
  });
  assert.equal(second.ok, true, second.why);
  assert.notEqual(second.slot.slotId, used[0], "второй аккаунт, а не тот же самый");
});

test("квоты: аккаунт с отметкой лимита берётся последним", () => {
  const slots = [accountSlot("w1", "a@m"), accountSlot("w2", "b@m")];
  const state = new Map([["a@m", { limited: true, until: Date.parse("2026-11-24T00:00:00Z") }]]);
  const order = byAccountCost(slots, { runs: [], state });
  assert.equal(order[0].slot.slotId, "w2", "лимитированный аккаунт уступает место");
  assert.equal(order[1].limited, true);
});

test("квоты: расход считается по аккаунту, а не по слоту", () => {
  const slots = [accountSlot("w1", "a@m"), accountSlot("w1b", "a@m"), accountSlot("w2", "b@m")];
  // Два слота одного аккаунта — это одна квота: две работы на a@m дороже,
  // чем одна, даже если они в разных контейнерах.
  const usage = accountUsage({ slots, runs: [
    run({ "Слот": "w1", "Аккаунт": "a@m" }),
    run({ "Run ID": "r-2", "Слот": "w1b", "Аккаунт": "a@m" }),
  ] });
  assert.equal(usage.get("a@m").live, 2);
  assert.equal(usage.get("b@m").live, 0);
  assert.deepEqual(usage.get("a@m").slots.sort(), ["w1", "w1b"]);
});

test("квоты: закрытые выдачи квоту не тратят", () => {
  const usage = accountUsage({ slots: [accountSlot("w1", "a@m")], runs: [run({ "Статус": "submitted", "Аккаунт": "a@m" })] });
  assert.equal(usage.get("a@m").live, 0);
});

// ── Пакетная выдача ────────────────────────────────────────────────────────
//
// Здесь был настоящий баг, и он был невидимым: `planOne` по отдельности каждую
// карточку запрещал, а `planBatch` выдавал три карточки одной роли в три слота.
// Причина — в «занятые» переносился только номер слота, без роли и карточки,
// поэтому проверка пределов внутри пакета не видела ни того, ни другого.
//
// Цена ошибки ровно та, от которой владелец просил защитить: три агента одной
// роли правят один файл в трёх контейнерах.

test("пакет: три карточки одной роли не расходятся по трём слотам", () => {
  const slots = [accountSlot("w1", "a@m"), accountSlot("w2", "b@m"), accountSlot("w3", "c@m")];
  const queue = [1, 2, 3].map((i) => queueItem({
    "ID": `q-${i}`, "Карточка": `card-${i}`, "Создано": `2026-11-23T10:0${i}:00Z`,
    "Роль": "Integration Auditor", "Функция": "Auditor",
  }));
  const batch = planBatch({
    slots, queue, runs: [], state: new Map(), maxParallel: 3, maxPerRole: 1,
  });
  assert.equal(batch.plans.length, 1, "выдана ровно одна карточка этой роли");
  assert.equal(batch.plans[0].item["Роль"], "Integration Auditor");
});

test("пакет: разные роли по-прежнему едут параллельно", () => {
  const slots = [accountSlot("w1", "a@m"), accountSlot("w2", "b@m"), accountSlot("w3", "c@m")];
  const queue = [
    queueItem({ "ID": "q-1", "Карточка": "card-1", "Создано": "2026-11-23T10:01:00Z", "Роль": "Godot World" }),
    queueItem({ "ID": "q-2", "Карточка": "card-2", "Создано": "2026-11-23T10:02:00Z", "Роль": "Campaign Editor" }),
    queueItem({ "ID": "q-3", "Карточка": "card-3", "Создано": "2026-11-23T10:03:00Z", "Роль": "Technical Artist" }),
  ];
  const batch = planBatch({ slots, queue, runs: [], state: new Map(), maxParallel: 3, maxPerRole: 1 });
  assert.equal(batch.plans.length, 3, "три разные роли — три выдачи");
  assert.equal(new Set(batch.plans.map((p) => p.slot.slotId)).size, 3, "разные аккаунты");
});

test("пакет: одна карточка не выдаётся дважды внутри пакета", () => {
  const slots = [accountSlot("w1", "a@m"), accountSlot("w2", "b@m")];
  const queue = [
    queueItem({ "ID": "q-1", "Карточка": "card-7", "Создано": "2026-11-23T10:01:00Z", "Роль": "Godot World" }),
    queueItem({ "ID": "q-2", "Карточка": "card-7", "Создано": "2026-11-23T10:02:00Z", "Роль": "Campaign Editor" }),
  ];
  const batch = planBatch({ slots, queue, runs: [], state: new Map(), maxParallel: 2, maxPerRole: 1 });
  assert.equal(batch.plans.length, 1, "дубль карточки в очереди не даёт второй выдачи");
});
