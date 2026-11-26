// Первичная настройка и разделение «база / расширенные».
//
// Главный тест здесь — не про удобство, а про инвариант, обещанный владельцу:
// **в расширенных настройках нет ничего, без чего цикл не работает**. Если
// такой ключ появится, тест упадёт и заставит перенести его в базу или дать
// значение по умолчанию.

import test from "node:test";
import assert from "node:assert/strict";
import { planSetup, applySetup, readiness, pickDatabase, discoverableKeys } from "../src/setup.mjs";
import { auditSettings, advancedKeys, basicKeys, parseSettings, SETTINGS, REQUIRED_KEYS } from "../src/settings.mjs";
import { createFakeStore, settingsRows, slotRows } from "./fake-sheets.mjs";

const databases = [
  { title: "Роли", dataSourceId: "ds-roles" },
  { title: "Слоты", dataSourceId: "ds-slots" },
  { title: "Запросы", dataSourceId: "ds-requests" },
  { title: "Что-то чужое", dataSourceId: "ds-other" },
];

test("мастер находит базы сам — ID вводить не нужно", () => {
  const plan = planSetup({ projectName: "WOTR", databases });
  assert.equal(plan.ok, true);
  assert.equal(plan.discovered["notion.rolesDb"], "ds-roles");
  assert.equal(plan.discovered["notion.slotsDb"], "ds-slots");
  assert.equal(plan.discovered["notion.requestsDb"], "ds-requests");
  assert.match(plan.why, /ключи и ID вводить не нужно/);
});

test("мастер не трогает расширенные настройки", () => {
  const plan = planSetup({ projectName: "WOTR", databases });
  const written = Object.keys(plan.discovered);
  assert.ok(written.every((key) => SETTINGS[key].group === "basic"), "мастер пишет только базовые ключи");
  assert.ok(plan.advancedLeftToDefaults > 0);
});

test("две базы с одинаковым названием — ошибка, а не выбор наугад", () => {
  const duplicate = [...databases, { title: "Роли", dataSourceId: "ds-roles-2" }];
  const plan = planSetup({ projectName: "WOTR", databases: duplicate });
  assert.equal(plan.ok, false);
  assert.match(plan.why, /несколько/);
});

test("похожее название подсказывается вместо пустого отказа", () => {
  const pick = pickDatabase([{ title: "Роли проекта", dataSourceId: "ds-x" }], "Роли");
  assert.equal(pick.ok, false);
  assert.match(pick.why, /похожие/);
});

test("без базы «Слоты» мастер не пропускает дальше и говорит, что делать", () => {
  const plan = planSetup({ projectName: "WOTR", databases: databases.filter((item) => item.title !== "Слоты") });
  assert.equal(plan.ok, false);
  assert.deepEqual(plan.requiredMissing, ["notion.slotsDb"]);
  const step = plan.steps.find((item) => item.key === "notion.slotsDb");
  assert.match(step.hint, /создайте базу/);
});

test("применение плана пишет найденные ключи в лист «Настройки»", async () => {
  const store = createFakeStore({ slots: slotRows(), settings: settingsRows() });
  const plan = planSetup({ projectName: "WOTR", databases });
  const result = await applySetup({ store, plan });
  assert.equal(result.ok, true);
  assert.ok(result.written.includes("notion.rolesDb"));

  const rows = store.objects("settings");
  const roles = rows.find((row) => row["Ключ"] === "notion.rolesDb");
  assert.equal(roles["Значение"], "ds-roles");
});

test("план без готовности не применяется", async () => {
  const store = createFakeStore({ settings: settingsRows() });
  const plan = planSetup({ projectName: "WOTR", databases: [] });
  const result = await applySetup({ store, plan });
  assert.equal(result.ok, false);
});

test("расширенные настройки необязательны — инвариант", () => {
  const problems = auditSettings();
  assert.deepEqual(problems, [], problems.join("; "));
  for (const key of advancedKeys()) {
    const spec = SETTINGS[key];
    assert.ok(spec.default !== undefined && spec.default !== "", `${key} требует ввода`);
  }
});

test("обязательные ключи лежат в базе, а не в расширенных", () => {
  for (const key of REQUIRED_KEYS) {
    assert.equal(SETTINGS[key].group, "basic", `${key} должен быть в базе`);
    assert.ok(basicKeys().includes(key));
    assert.ok(!advancedKeys().includes(key));
  }
});

test("пустая ячейка не стирает значение по умолчанию", () => {
  const values = parseSettings([["cycle.maxParallel", "", "number", "advanced", "2", ""]]);
  assert.equal(values["cycle.maxParallel"], 2);
});

test("числовая настройка приводится и ограничивается", () => {
  const values = parseSettings([
    ["cycle.maxParallel", "99", "number", "advanced", "2", ""],
    ["net.notionTimeoutMs", "0", "number", "advanced", "8000", ""],
  ]);
  assert.equal(values["cycle.maxParallel"], 8, "верхний предел соблюдается");
  assert.equal(values["net.notionTimeoutMs"], 2000, "нижний предел соблюдается");
});

test("неизвестный режим цикла откатывается к ручному", () => {
  const values = parseSettings([["cycle.mode", "турбо", "enum", "basic", "manual", ""]]);
  assert.equal(values["cycle.mode"], "manual");
});

test("готовность объясняет каждую нехватку по отдельности", () => {
  const bare = readiness({ settings: {}, slots: [] });
  assert.equal(bare.ok, false);
  assert.ok(bare.problems.some((line) => /«Роли»/.test(line)));
  assert.ok(bare.problems.some((line) => /активного слота/.test(line)));

  const ready = readiness({
    settings: parseSettings(settingsRows()),
    slots: [{ slotId: "admin", admin: true, enabled: true }, { slotId: "worker-1", admin: false, enabled: true }],
  });
  assert.equal(ready.ok, true, ready.problems.join("; "));
});

test("готовность замечает перекос: только рабочие слоты без административного", () => {
  const state = readiness({
    settings: parseSettings(settingsRows()),
    slots: [{ slotId: "worker-1", admin: false, enabled: true }],
  });
  assert.equal(state.ok, false);
  assert.ok(state.problems.some((line) => /административного слота/.test(line)));
});

test("мастер не пишет режим цикла — это решение человека", () => {
  assert.ok(!discoverableKeys().includes("cycle.mode"));
});
