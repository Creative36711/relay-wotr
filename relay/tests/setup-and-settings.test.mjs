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
import { createDemoStore } from "../src/demo-store.mjs";
import { createService } from "../src/service.mjs";

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

test("две базы с одинаковым названием — не выбираем наугад и говорим об этом", () => {
  // Справочник ролей необязателен, поэтому цикл из-за неоднозначности не
  // останавливается. Но и записывать ID «какой-то из двух» нельзя: тогда
  // транспорт неделю читал бы чужую копию базы.
  const duplicate = [...databases, { title: "Роли", dataSourceId: "ds-roles-2" }];
  const plan = planSetup({ projectName: "WOTR", databases: duplicate });
  assert.equal(plan.discovered["notion.rolesDb"], undefined, "ID не записан");
  assert.ok(plan.notes.some((line) => /несколько/.test(line)), "причина названа");
  const step = plan.steps.find((item) => item.key === "notion.rolesDb");
  assert.equal(step.ok, false);
  assert.equal(step.required, false);
});

test("похожее название подсказывается вместо пустого отказа", () => {
  const pick = pickDatabase([{ title: "Роли проекта", dataSourceId: "ds-x" }], "Роли");
  assert.equal(pick.ok, false);
  assert.match(pick.why, /похожие/);
});

test("базы, которые транспорт не читает, не показываются как нехватка", () => {
  // `notion.slotsDb` и `notion.requestsDb` не читает ни одна строка службы:
  // слоты — лист книги, карточки приходят строкой очереди. Пока они висели в
  // плане с ✕, пульт выглядел сломанным при полностью рабочем цикле.
  const plan = planSetup({ projectName: "WOTR", databases: databases.filter((item) => !["Слоты", "Запросы"].includes(item.title)) });
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.requiredMissing, []);
  const keys = plan.steps.map((step) => step.key);
  assert.ok(!keys.includes("notion.slotsDb"), "нет шага про ненужную базу слотов");
  assert.ok(!keys.includes("notion.requestsDb"), "нет шага про ненужную базу запросов");
  assert.ok(!plan.notes.some((line) => /Запросы|Слоты/.test(line)), "и в замечаниях их нет");
});

test("демо-режим: мастер не советует чинить доступ, которого нет", () => {
  // Демо живёт в памяти: книга не подключена, Notion не ищется. Совет «дайте
  // интеграции доступ» здесь — ложный след: человек идёт проверять доступ там,
  // где доступа ещё нет вовсе.
  const plan = planSetup({ projectName: "WOTR", databases: [], demo: true });
  assert.equal(plan.ok, false);
  assert.match(plan.why, /демо-режиме/);
  assert.doesNotMatch(plan.why, /дайте интеграции доступ/);
});

test("пустой поиск назван отсутствием токена, а не доступом к странице", () => {
  // Транспорт без токена ищет не «и не находит», а не ищет вообще. Это разные
  // поломки и разные действия человека. Токен теперь вводится в пульте, и
  // причина называет именно это, а не переменную, которую надо передать при
  // запуске: перезапуск ради токена — лишний шаг.
  const plan = planSetup({ projectName: "WOTR", databases: [], searchable: false });
  assert.match(plan.why, /Notion не подключён/);
  assert.match(plan.why, /токен/i);
  assert.doesNotMatch(plan.why, /дайте интеграции доступ/);
  assert.doesNotMatch(plan.why, /NOTION_TOKEN/);
  // Токен есть, а базы не видно — это про доступ интеграции, и совет другой.
  const blind = planSetup({ projectName: "WOTR", databases: [], searchable: true });
  assert.match(blind.why, /дайте интеграции доступ/);
  assert.doesNotMatch(blind.why, /не знает токен/);
});

test("снапшот говорит, что служба в демо-режиме", async () => {
  const service = createService({ store: createDemoStore() });
  const shot = await service.snapshot();
  assert.equal(shot.demo, true, "пульт не должен угадывать демо по пустому журналу");
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

test("план без обязательного шага не применяется", async () => {
  const store = createFakeStore({ settings: [] });
  // Название проекта — единственное обязательное: без него карточки и отчёты
  // подписываются безымянно. Справочник ролей обязательным больше не является.
  const plan = planSetup({ projectName: "", settings: {}, databases: [] });
  assert.equal(plan.ok, false);
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
  // Нехватка слота — отказ: работать некому. Отсутствие справочника ролей —
  // замечание: роль и функция есть в строке очереди.
  assert.ok(bare.problems.some((line) => /активного слота/.test(line)));
  assert.ok(!bare.problems.some((line) => /«Роли»/.test(line)), "справочник не блокирует");
  assert.ok(bare.notes.some((line) => /справочник ролей/.test(line)), "но и не замалчивается");

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

test("токен Notion из пульта: проверяется сразу и включает справочник ролей", async () => {
  // Владелец получает токен в Notion, а не в командной строке. Значит токен
  // принимается в пульте, проверяется тем же поиском и начинает действовать
  // без перезапуска службы.
  const calls = [];
  const service = createService({
    store: createFakeStore({ slots: slotRows(), settings: settingsRows() }),
    notionFetch: async (url, init) => {
      calls.push({ url, auth: init.headers.Authorization });
      return {
        ok: true, status: 200,
        text: async () => JSON.stringify({ results: [
          { id: "db-1", object: "database", title: [{ plain_text: "Роли" }], data_sources: [{ id: "ds-roles" }] },
        ] }),
      };
    },
  });

  const bad = await service.notionTokenSet({ token: "мусор" });
  assert.equal(bad.ok, false, "не тот текст отвергается до сети");
  assert.match(bad.why, /ntn_|secret_/);
  assert.equal(calls.length, 0, "и в сеть не ходит");

  const ok = await service.notionTokenSet({ token: "ntn_1234567890abcdef" });
  assert.equal(ok.ok, true, ok.why);
  assert.match(ok.why, /Видно баз: 1/);
  assert.equal(calls[0].auth, "Bearer ntn_1234567890abcdef");
  assert.equal(service.memory.notionToken, "ntn_1234567890abcdef");

  // Токен действует: «Найти и применить» видит базы без окружения.
  const plan = await service.setup({});
  assert.equal(plan.ok, true, plan.why);
  assert.equal(plan.hasNotionToken, true, "мастер работает тем токеном, что ввели в пульте");
  // Роли записаны: тот же ID, что видела проверка токена.
  const settings = await service.loadAll();
  assert.equal(settings.settings["notion.rolesDb"], "ds-roles");
});

test("токен, который Notion не принял, не запоминается", async () => {
  const service = createService({
    store: createFakeStore({ slots: slotRows(), settings: settingsRows() }),
    notionFetch: async () => ({ ok: false, status: 401, text: async () => JSON.stringify({ message: "API token is invalid." }) }),
  });
  const result = await service.notionTokenSet({ token: "ntn_плохой" });
  assert.equal(result.ok, false);
  assert.match(result.why, /не принял/);
  assert.equal(service.memory.notionToken, "", "недействующий токен не сохраняется");
});

test("сеть недоступна — так и сказано, а не «токен плохой»", async () => {
  // `fetch failed` не значит «неверный токен». Одинаковый текст на два разных
  // случая заставляет перевыпускать рабочий токен вместо проверки VPN.
  const service = createService({
    store: createFakeStore({ slots: slotRows(), settings: settingsRows() }),
    notionFetch: async () => { throw new Error("fetch failed"); },
  });
  const result = await service.notionTokenSet({ token: "ntn_1234567890abcdef" });
  assert.equal(result.ok, false);
  assert.match(result.why, /не дозвонились/);
  assert.doesNotMatch(result.why, /неверн|плохой|invalid/i);
});

test("проверка сети: «не дозвонились» не выдаёт себя за «токен плохой»", async () => {
  const service = createService({
    store: createFakeStore({ slots: slotRows(), settings: settingsRows() }),
    notionFetch: async () => {
      const error = new Error("fetch failed");
      error.cause = { code: "ECONNRESET" };
      throw error;
    },
  });
  const net = await service.notionNet();
  assert.equal(net.ok, false);
  assert.equal(net.code, "ECONNRESET", "код виден человеку: по нему он найдёт причину");
  assert.match(net.why, /ECONNRESET/);
  assert.match(net.why, /прокси/i);
  assert.match(net.why, /Токен тут не при чём/);

  const token = await service.notionTokenSet({ token: "ntn_1234567890abcdef" });
  assert.equal(token.ok, false);
  assert.equal(token.network, true, "отказ помечен как сетевой");
  assert.doesNotMatch(token.why, /не принял токен/, "не обвиняем ключ в сетевой поломке");
});

test("проверка сети: сертификат подменён антивирусом — так и названо", async () => {
  const service = createService({
    store: createFakeStore({ slots: slotRows(), settings: settingsRows() }),
    notionFetch: async () => {
      const error = new Error("fetch failed");
      error.cause = { code: "UNABLE_TO_VERIFY_LEAF_SIGNATURE" };
      throw error;
    },
  });
  const net = await service.notionNet();
  assert.match(net.why, /сертификат подменён/);
  assert.match(net.why, /антивирус/i);
});

test("справочник ролей читается: настройки не теряются в кеше", async () => {
  // Прежняя ошибка: `loadRoles` брал настройки из памяти, а память никто не
  // заполнял. В итоге ID ролей был в книге, токен был в окружении, а
  // справочник не читался никогда — и «почему роль без адреса» искали наугад.
  const queries = [];
  const service = createService({
    store: createFakeStore({ slots: slotRows(), settings: settingsRows() }),
    notionToken: "ntn_из_окружения",
    notionFetch: async (url) => {
      queries.push(url);
      if (url.includes("/search")) {
        return { ok: true, status: 200, text: async () => JSON.stringify({ results: [] }) };
      }
      return {
        ok: true, status: 200,
        text: async () => JSON.stringify({
          results: [{ id: "p1", properties: {
            "Роль": { title: [{ plain_text: "Executor" }] },
            "Функция": { select: { name: "Executor" } },
            "Статус": { select: { name: "активна" } },
          } }],
          has_more: false,
        }),
      };
    },
  });
  const data = await service.loadAll();
  assert.equal(data.settings["notion.rolesDb"], "ds-roles", "настройки прочитаны");

  // Справочник читается там, где нужен, — при выдаче работы: без него нельзя
  // понять, административная роль или нет. `snapshot` его не тянет и не должен.
  await service.pull({ slotId: "worker-1", tab: "t1" });
  assert.ok(queries.some((url) => url.includes("databases/ds-roles/query")), "справочник ролей запрошен");
  const shot = await service.snapshot();
  assert.equal(shot.notion.ready, true);
});

test("мастер не пишет режим цикла — это решение человека", () => {
  assert.ok(!discoverableKeys().includes("cycle.mode"));
});

/**
 * Готовность видит недостающий лист.
 *
 * Аудит 23.11: в книге владельца не было листа «Экземпляры», а готовность
 * отвечала «ok». Цена — адрес созданного агента некуда записать, и каждая
 * карточка роли заново требует создания. Лист теперь создаёт служба, но
 * молчать о доступе всё равно нельзя: «лист создан сам» и «лист не создан,
 * потому что нет прав» — разные новости для владельца.
 */
test("готовность называет недостающие листы книги", async () => {
  const settings = parseSettings(settingsRows());
  const slots = [
    { slotId: "admin", admin: true, enabled: true },
    { slotId: "worker-1", admin: false, enabled: true },
  ];
  const full = await import("../src/schema.mjs").then(({ SHEETS }) =>
    Object.values(SHEETS).map((sheet) => sheet.name));
  const intact = readiness({ settings, slots, sheets: full });
  assert.equal(intact.ok, true, intact.problems.join("; "));
  assert.ok(!intact.problems.some((line) => /нет листов/.test(line)), "полная книга молчит");

  const missing = readiness({ settings, slots, sheets: full.filter((name) => name !== "Экземпляры") });
  assert.equal(missing.ok, false);
  assert.ok(missing.problems.some((line) => /нет листов: Экземпляры/.test(line)));
  assert.ok(missing.problems.some((line) => /создаст их при первом чтении/.test(line)),
    "сказано, что лист появится сам, а не «создайте руками»");

  // Лист «Состояние» схема описывает, но служба его не читает и не пишет:
  // единственная строка состояния живёт в «Настройках». Требовать его —
  // отправлять владельца создавать лист без пользы.
  const withoutState = readiness({ settings, slots, sheets: full.filter((name) => name !== "Состояние") });
  assert.equal(withoutState.ok, true, withoutState.problems.join("; "));
});
