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

test("мастер настройки ищет токеном из пульта, одноимённые базы названы описанием", async () => {
  // Токен, введённый в пульте, живёт в памяти службы, а не в окружении
  // процесса. Замыкание без параметра искало по env, молча возвращало
  // пустоту — и человек при принятом токене читал «интеграция не видит».
  // Роли заданы пустым значением: вручную вписанное (D-024) этот шаг
  // гасит, а здесь важен сам отказ про несколько баз.
  const seen = [];
  const service = createService({
    store: createFakeStore({ slots: slotRows(), settings: settingsRows({ "notion.rolesDb": "" }) }),
    notionFetch: async () => ({
      ok: true, status: 200,
      text: async () => JSON.stringify({ results: [{ id: "db-check", object: "database", title: [{ plain_text: "Роли" }] }] }),
    }),
    notionSearch: async ({ token } = {}) => {
      seen.push(token);
      return [
        { id: "41e6f0cf", title: "Роли", object: "database", dataSourceId: "", dataSourceCount: 0, description: "Состав команды WOTR Remaster" },
        { id: "024b7678", title: "Роли", object: "database", dataSourceId: "", dataSourceCount: 0, description: "Активные роли цикла Vault" },
      ];
    },
  });

  const accepted = await service.notionTokenSet({ token: "ntn_1234567890abcdef" });
  assert.equal(accepted.ok, true, accepted.why);

  const plan = await service.setup({});
  assert.deepEqual(seen, ["ntn_1234567890abcdef"], "поиск получил токен из памяти, а не пустой env");

  // Три «Роли» в рабочем пространстве — не повод молча выбрать первую.
  const step = plan.steps.find((item) => item.key === "notion.rolesDb");
  assert.equal(step.ok, false);
  assert.match(step.why, /несколько \(2\)/);
  assert.match(step.why, /WOTR Remaster/, "описание первой базы названо");
  assert.match(step.why, /Vault/, "описание второй базы названо");
  assert.match(step.why, /notion\.rolesDb/, "запасной путь — вписать id вручную");
});

test("вписанное вручную notion.rolesDb мастер не переспрашивает", () => {
  // Живой случай: три базы «Роли» — мастер просит оставить одну; владелец
  // вписал id главной в лист «Настройки». Повторный «Найти и применить»
  // не должен показывать ту же ошибку: сделанное не должно выглядеть
  // как несделанное, а ручное значение — затираться пустым.
  const ambiguous = [
    { id: "db-1", title: "Роли", dataSourceId: "", description: "Состав команды WOTR Remaster" },
    { id: "db-2", title: "Роли", dataSourceId: "", description: "Активные роли цикла Vault" },
    { id: "db-3", title: "Роли", dataSourceId: "", description: "Активные роли цикла Synapse" },
  ];
  const plan = planSetup({
    projectName: "WOTR",
    settings: { "notion.rolesDb": "41e6f0cf-5705-81cf-9ea9-f7564f42f77c" },
    databases: ambiguous,
  });
  const step = plan.steps.find((item) => item.key === "notion.rolesDb");
  assert.equal(step.ok, true, step.why);
  assert.match(step.why, /задано вручную в листе «Настройки»/);
  assert.equal(step.value, "41e6f0cf-5705-81cf-9ea9-f7564f42f77c");
  assert.equal(plan.discovered["notion.rolesDb"], undefined, "вручную заданное не попадает в запись — не затрётся");
  assert.ok(!plan.notes.some((line) => line.includes("notion.rolesDb")), "и в замечаниях его нет");
  assert.equal(plan.ok, true, plan.why);

  // Без ручного значения отказ остаётся прежним — путаницы «всё зелёное»
  // там, где настроек нет, быть не должно.
  const empty = planSetup({ projectName: "WOTR", settings: {}, databases: ambiguous });
  const emptyStep = empty.steps.find((item) => item.key === "notion.rolesDb");
  assert.equal(emptyStep.ok, false);
  assert.match(emptyStep.why, /несколько \(3\)/);
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

test("net.gmTimeoutMs из книги передаётся адаптеру Apps Script", async () => {
  const store = createFakeStore({
    slots: slotRows(),
    settings: settingsRows({ "net.gmTimeoutMs": "67000" }),
  });
  let applied = 0;
  store.setTimeoutMs = (value) => { applied = value; };
  const service = createService({ store });
  await service.loadAll();
  assert.equal(applied, 67000, "значение настройки управляет timeout bridge, а не только отображается в таблице");
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
  const saved = [];
  const service = createService({
    store: createFakeStore({ slots: slotRows(), settings: settingsRows() }),
    saveNotionToken: (value) => { saved.push(value); return { ok: true, path: "/tmp/notion-token.txt" }; },
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
  // Принятый токен уходит в локальное сохранение — перезапуск без ввода.
  assert.deepEqual(saved, ["ntn_1234567890abcdef"]);
  assert.match(ok.why, /сохранён локально/);

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
  assert.match(net.why, /VPN|фильтр|режут/i);
  assert.match(net.why, /Токен и ключи тут не при чём|Токен тут не при чём/);

  const token = await service.notionTokenSet({ token: "ntn_1234567890abcdef" });
  assert.equal(token.ok, false);
  assert.equal(token.network, true, "отказ помечен как сетевой");
  assert.doesNotMatch(token.why, /не принял токен/, "не обвиняем ключ в сетевой поломке");
});

test("проверка сети: IPv4 доходит, IPv6 нет — назван виновник, а не «медленно»", async () => {
  // Сценарий владельца: VPN отдаёт IPv6-адрес Notion и не пропускает трафик.
  // В Firefox это незаметно (он переключается сам), в Node — обрыв по
  // таймауту. Проверка обязана сказать «IPv6», а не «сеть медленная».
  const service = createService({
    store: createFakeStore({ slots: slotRows(), settings: settingsRows() }),
    notionFetch: async () => {
      const error = new Error("fetch failed");
      error.cause = { code: "UND_ERR_CONNECT_TIMEOUT" };
      throw error;
    },
  });
  const net = await service.notionNet();
  assert.ok(Array.isArray(net.probes), "видно, какое семейство адресов проверено");
  assert.ok(Array.isArray(net.addresses), "и какие адреса отдал DNS");
  // В этой сети IPv4 обязан быть живым, иначе тест ничего не проверяет.
  const v4 = net.probes.find((item) => item.family === 4);
  assert.ok(v4 && v4.ok, "IPv4 проверен и доступен");
  assert.match(net.why, /IPv6|IPv4|соединение/, "причина названа по существу");
  assert.doesNotMatch(net.why, /сертификат/, "не сваливаем на сертификат");
});

test("проверка сети: книга отвечает, Notion нет — виновник назван отдельно", async () => {
  // Сценарий владельца: мост к Google отвечает за 825 мс, а Notion не отвечает
  // вовсе. Значит интернет есть, и «дело в VPN» — уже неверный ответ.
  const service = createService({
    store: createFakeStore({ slots: slotRows(), settings: settingsRows() }),
    notionFetch: async () => {
      const error = new Error("fetch failed");
      error.cause = { code: "UND_ERR_CONNECT_TIMEOUT" };
      throw error;
    },
  });
  const net = await service.notionNet();
  assert.equal(net.ok, false);
  // Пробы по конкретным адресам отличают блокировку по имени от мёртвого
  // маршрута: без них остаётся один текст «проверьте сеть».
  assert.ok(Array.isArray(net.byAddress), "есть проба по адресу, а не только по имени");
  assert.ok(net.addresses.length > 0, "видно, какие адреса отдал DNS");
});

test("токен: подменённый ответ не выдаётся за неверный ключ", async () => {
  // Ровно сценарий владельца: рабочий токен, ответ — HTML-страница.
  const service = createService({
    store: createFakeStore({ slots: slotRows(), settings: settingsRows() }),
    notionFetch: async () => ({
      ok: true, status: 200, url: "https://api.notion.com/v1/search",
      headers: { entries: () => [["server", "cloudflare"]] },
      text: async () => "<!DOCTYPE html><html>Checking your browser</html>",
    }),
  });
  const result = await service.notionTokenSet({ token: "ntn_1234567890abcdef" });
  assert.equal(result.ok, false);
  assert.equal(result.substituted, true, "помечено как подмена, а не как неверный токен");
  assert.match(result.why, /cloudflare/);
  assert.doesNotMatch(result.why, /не принял токен|Unexpected token/);
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
  // Соединение проходит, но TLS рвётся — это подмена или фильтр; тест держит
  // отказ в области «сеть», а не «токен».
  assert.equal(net.ok, false);
  assert.match(net.why, /VPN|антивирус|фильтр|режут|сеть/i);
  assert.doesNotMatch(net.why, /не принял токен/);
});

test("роли читаются из книги: Notion для работы не нужен", async () => {
  // Переломный момент подхода: пока роли жили только в Notion, недоступный
  // Notion делал цикл «не настроенным» при полностью живой книге.
  const store = createFakeStore({ slots: slotRows(), settings: settingsRows() });
  store.sheets.roles = [
    ["Роль", "Функция", "Статус", "Agent URL", "Репозиторий", "Не требуется", "Заметка"],
    ["Executor", "Executor", "активна", "", "wotr", "нет", ""],
    ["Coordinator", "Coordinator", "активна", "https://agent.example/c", "wotr", "нет", "админ"],
  ];
  const service = createService({ store });  // ни токена, ни сети
  const data = await service.loadAll();
  assert.equal(data.settings["notion.rolesDb"], "ds-roles");
  // Роли достаются тем же вызовом, что и при выдаче.
  const pull = await service.pull({ slotId: "worker-1", tab: "t1" });
  assert.equal(pull.ok, true, pull.why);
  const roles = service.memory.rolesCache || [];
  assert.ok(Array.isArray(roles));
});

test("Notion недоступен, но книга жива: перенос ролей не падает, а объясняет", async () => {
  const store = createFakeStore({ slots: slotRows(), settings: settingsRows() });
  const service = createService({ store });  // токена нет
  const result = await service.rolesToBook();
  assert.equal(result.ok, false);
  assert.match(result.why, /лист «Роли»/, "человеку сказано, что делать без Notion");
  assert.doesNotMatch(result.why, /Unexpected|undefined/);
});

test("замер книги отвечает цифрами, а не «медленно»", async () => {
  const service = createService({ store: createFakeStore({ slots: slotRows(), settings: settingsRows() }) });
  const result = await service.measureBook();
  assert.equal(result.ok, true, result.why);
  assert.equal(typeof result.timings.readSlotsMs, "number");
  assert.equal(typeof result.timings.appendMs, "number");
  assert.match(result.why, /книга читается за/);
  assert.match(result.why, /Один шаг цикла/);
});

test("Таблица ролей в книге: схема совпадает со списком колонок", async () => {
  const { SHEETS } = await import("../src/schema.mjs");
  assert.deepEqual(SHEETS.roles.columns,
    ["Роль", "Функция", "Статус", "Agent URL", "Репозиторий", "Не требуется", "Заметка"]);
  assert.equal(SHEETS.roles.name, "Роли");
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

  // «Роли» служба создаёт сама, как и «Экземпляры»: тревога о ней отправляла
  // бы человека добавлять лист руками.
  const withoutRoles = readiness({ settings, slots, sheets: full.filter((name) => name !== "Роли") });
  assert.equal(withoutRoles.ok, true, withoutRoles.problems.join("; "));
});
