// Мост в Apps Script: контракт, который нельзя проверить «глазами».
//
// Сам Apps Script здесь не запускается — это чужой рантайм. Зато проверяемо
// то, что обычно и ломается молча:
//
//   1. Формат запроса. `Content-Type: text/plain` — не стилистика: обычный
//      `application/json` заставил бы браузер отправить предварительный
//      запрос CORS, на который Apps Script не отвечает.
//   2. Форма ответа. Служба ждёт `{header, rows}` и `{sheets:[{properties}]}`;
//      мост обязан отдавать именно это, иначе разница вылезет в бою.
//   3. Отказы. Неверный ключ, HTML вместо JSON (неверное развёртывание) и
//      недоступный адрес должны быть тремя разными сообщениями: человек ищет
//      причину по тексту.
//
// Код для книги (`apps-script/Code.gs`) проверяется отдельно — как текст: он
// должен делать те же действия и не выдавать данные без ключа.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createAppsScriptStore, BridgeError } from "../src/appsscript-bridge.mjs";

/** Поддельный Apps Script: те же действия, что в Code.gs, и та же проверка ключа. */
const fakeBridge = ({ key = "s3cret", htmlInstead = false } = {}) => {
  const book = {
    Слоты: [["Слот", "Контейнер", "Аккаунт", "Админский", "Статус", "Заметка"],
      ["worker-1", "arena-yandex", "a@b.c", "нет", "активен", ""]],
    Настройки: [["Ключ", "Значение", "Тип", "Группа", "По умолчанию", "Описание"]],
  };
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (htmlInstead) {
      return { ok: true, status: 200, text: async () => "<!doctype html><html>Войдите в аккаунт</html>" };
    }
    const body = JSON.parse(init.body);
    if (String(body.key) !== key) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ ok: false, why: "неверный ключ моста" }) };
    }
    const reply = (data) => ({ ok: true, status: 200, text: async () => JSON.stringify(data) });
    switch (body.action) {
      case "read": {
        const values = book[body.sheet];
        if (!values) return reply({ ok: false, why: `листа «${body.sheet}» нет в книге` });
        return reply({ ok: true, header: values[0] || [], rows: values.slice(1) });
      }
      case "append": {
        for (const row of body.values || []) book[body.sheet].push(row);
        return reply({ ok: true, appended: (body.values || []).length });
      }
      case "updateRange": {
        const sheet = book[body.sheet];
        const start = Number(body.startRow) - 1;
        (body.values || []).forEach((row, i) => { sheet[start + i] = row; });
        return reply({ ok: true, updated: (body.values || []).length });
      }
      case "meta":
        return reply({ ok: true, titles: Object.keys(book) });
      case "ensureSheet": {
        if (book[body.sheet]) return reply({ ok: true, created: false, name: body.sheet });
        book[body.sheet] = [body.columns || []];
        return reply({ ok: true, created: true, name: body.sheet });
      }
      default:
        return reply({ ok: false, why: `неизвестное действие «${body.action}»` });
    }
  };
  return { fetchImpl, book, calls };
};

test("мост читает лист в форме Sheets API: header + rows", async () => {
  const { fetchImpl } = fakeBridge();
  const store = createAppsScriptStore({ url: "https://bridge/exec", key: "s3cret", fetchImpl });
  const { header, rows } = await store.read("slots");
  assert.deepEqual(header, ["Слот", "Контейнер", "Аккаунт", "Админский", "Статус", "Заметка"]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0][0], "worker-1");
});

test("мост отправляет text/plain: иначе браузер добавит CORS-предзапрос", async () => {
  const { fetchImpl, calls } = fakeBridge();
  const store = createAppsScriptStore({ url: "https://bridge/exec", key: "s3cret", fetchImpl });
  await store.meta();
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers["Content-Type"], "text/plain;charset=utf-8");
  assert.equal(calls[0].init.redirect, "follow", "Apps Script отвечает редиректом на googleusercontent");
});

test("мост переводит имена листов из схемы и отдаёт meta в форме Sheets", async () => {
  const { fetchImpl, calls } = fakeBridge();
  const store = createAppsScriptStore({ url: "https://bridge/exec", key: "s3cret", fetchImpl });
  const meta = await store.meta();
  assert.deepEqual(meta.sheets.map((item) => item.properties.title), ["Слоты", "Настройки"]);
  await store.read("slots");
  const readCall = calls.find((call) => JSON.parse(call.init.body).action === "read");
  assert.equal(JSON.parse(readCall.init.body).sheet, "Слоты", "в книгу уходит русское имя, а не ключ схемы");
});

test("мост дописывает строки и правит диапазон по номеру", async () => {
  const { fetchImpl, book } = fakeBridge();
  const store = createAppsScriptStore({ url: "https://bridge/exec", key: "s3cret", fetchImpl });
  await store.append("slots", [["worker-2", "arena-list", "c@d.e", "нет", "активен", ""]]);
  assert.equal(book["Слоты"].length, 3);
  await store.updateRange("settings", 2, [["project.name", "WOTR", "text", "basic", "", ""]]);
  assert.equal(book["Настройки"][1][1], "WOTR");
});

test("мост создаёт недостающий лист с шапкой из схемы — как Sheets-хранилище", async () => {
  const { fetchImpl, book } = fakeBridge();
  const store = createAppsScriptStore({ url: "https://bridge/exec", key: "s3cret", fetchImpl });
  const made = await store.ensureSheet("agents");
  assert.equal(made.created, true);
  assert.equal(made.name, "Экземпляры");
  assert.ok(book["Экземпляры"][0].includes("Agent URL"), "шапка пришла из схемы, а не из воздуха");
  const again = await store.ensureSheet("agents");
  assert.equal(again.created, false, "идемпотентно: второй раз не пересоздаёт");
});

test("неверный ключ — ошибка с понятным текстом", async () => {
  const { fetchImpl } = fakeBridge({ key: "другой" });
  const store = createAppsScriptStore({ url: "https://bridge/exec", key: "s3cret", fetchImpl });
  await assert.rejects(() => store.read("slots"), (error) => {
    assert.ok(error instanceof BridgeError);
    assert.match(error.message, /неверный ключ/);
    return true;
  });
});

test("HTML вместо JSON назван своей причиной: доступ «Все» у веб-приложения", async () => {
  // Самая частая ошибка развёртывания: адрес открыт не для всех, и вместо
  // JSON приходит страница входа. «Unexpected token <» тут не помогает.
  const { fetchImpl } = fakeBridge({ htmlInstead: true });
  const store = createAppsScriptStore({ url: "https://bridge/exec", key: "s3cret", fetchImpl });
  await assert.rejects(() => store.read("slots"), (error) => {
    assert.match(error.message, /не JSON/);
    assert.match(error.message, /«Все»/);
    return true;
  });
});

test("Notion вернул HTML — назван посредник, а не «Unexpected token»", async () => {
  // Живой случай: владелец вставил рабочий токен и получил
  // «Unexpected token '<'». Токен был ни при чём — ответила чужая страница.
  const { describeNonJson } = await import("../src/notion-db.mjs");
  const html = describeNonJson({
    status: 200,
    url: "https://api.notion.com/v1/search",
    headers: { server: "cloudflare" },
    text: "<!DOCTYPE html><html><head><title>Checking your browser</title></head></html>",
  });
  assert.equal(html.server, "cloudflare", "видно, кто ответил");
  assert.match(html.why, /не Notion/);
  assert.match(html.why, /Токен тут не при чём/);
  assert.match(html.kind, /фильтр|капча/);
  assert.doesNotMatch(html.why, /</, "HTML не вываливается в сообщение");

  // Настоящий JSON подменой не считается: иначе обычный ответ ломался бы.
  assert.equal(describeNonJson({ status: 200, text: '{"results":[]}' }), null);
  assert.equal(describeNonJson({ status: 200, text: '  [1,2]' }), null);
});

test("поиск в Notion: подменённый ответ — отказ с причиной, а не падение JSON", async () => {
  const { searchDatabases } = await import("../src/notion-db.mjs");
  const fetchImpl = async () => ({
    ok: true, status: 200, url: "https://api.notion.com/v1/search",
    headers: { entries: () => [["server", "nginx"]] },
    text: async () => "<html><body>Доступ ограничен</body></html>",
  });
  await assert.rejects(() => searchDatabases({ token: "ntn_x", fetchImpl }), (error) => {
    assert.match(error.message, /вернул не данные/);
    assert.match(error.message, /nginx/);
    return true;
  });
});

test("недоступный адрес называет три причины, а не «fetch failed»", async () => {
  const fetchImpl = async () => { throw new Error("fetch failed"); };
  const store = createAppsScriptStore({ url: "https://bridge/exec", key: "s3cret", fetchImpl });
  await assert.rejects(() => store.read("slots"), (error) => {
    assert.match(error.message, /недоступен/);
    assert.match(error.message, /доступ «Все»/);
    return true;
  });
});

test("страница установки: говорит, куда вставлять и куда НЕ вставлять", async () => {
  const { mountPage, bridgeCode } = await import("../src/mount-page.mjs");
  const html = mountPage({ version: "1.25.0" });
  // Владелец уже принял Gateway за нужный скрипт: разница должна быть на
  // странице, а не в переписке.
  assert.match(html, /Gateway/);
  assert.match(html, /Не сюда/);
  assert.match(html, /Расширения/);
  // Шаг авторизации в порядке установки: без него действие notion отказывает
  // «нет разрешения на вызов UrlFetchApp.fetch», и владелец ищет не там.
  assert.match(html, /authorize/, "порядок шагов содержит авторизацию внешнего HTTP");
  assert.match(html, /script\.external_request/, "право названо на странице");
  // Кода две копии быть не должно: страница читает тот же файл, что и README.
  assert.ok(bridgeCode().includes("doPost"), "код моста читается из файла");
  assert.ok(html.includes(bridgeCode().split("\n")[0]), "текст кода вставлен в страницу");
  assert.match(html, /Скопировать код/, "кнопка копирования: файл искать не нужно");
});

test("страница установки: два поля вместо файла и сообщение об уже настроенном мосте", async () => {
  const { mountPage } = await import("../src/mount-page.mjs");
  const configurable = mountPage({ version: "1.25.0", file: "/tmp/bridge.txt", canSave: true });
  // Владелец просил вставлять адрес «при запуске приложения», а не писать
  // файл руками: значит на странице должны быть именно поля ввода.
  assert.match(configurable, /id="url"/, "поле адреса есть");
  assert.match(configurable, /id="key"/, "поле ключа есть");
  assert.match(configurable, /api\/bridge-config/, "форма отправляет адрес службе, а не в файл вручную");
  assert.match(configurable, /\/exec/, "подсказка, что нужен адрес веб-приложения");
  // Демо снимается без перезапуска — иначе после «Сохранено» пульт остался бы
  // пустым. На странице за это отвечает кнопка проверки связи.
  assert.match(configurable, /Проверить связь/);
  assert.match(configurable, /api\/bridge-probe/);
  // Идентификатор развёртывания службе не нужен, и это должно быть сказано.
  assert.match(configurable, /развёртывания/);

  // Файл писать некуда (например, служба запущена из чужой папки) — страница
  // не притворяется, что сохранит.
  const readOnly = mountPage({ version: "1.25.0", file: "", canSave: false });
  assert.doesNotMatch(readOnly, /id="url"/, "без файла полей ввода нет");
  assert.match(readOnly, /bridge\.txt/, "и человеку сказано, что дописать");

  // Мост уже настроен: адрес показан, ставить заново не предлагается.
  const existing = mountPage({ version: "1.25.0", existing: "https://script.google.com/macros/s/X/exec", file: "/tmp/bridge.txt", canSave: true });
  assert.match(existing, /value="https:\/\/script\.google\.com\/macros\/s\/X\/exec"/);
});

test("страница установки: скрипт разбирается — иначе кнопки молча не работают", async () => {
  // Обратные слэши в шаблонной строке съедаются при подстановке, и регулярка
  // вида /^https:\/\// превращается в синтаксическую ошибку, из-за которой не
  // работают ни «Скопировать», ни «Сохранить» — без единого сообщения.
  const { mountPage } = await import("../src/mount-page.mjs");
  const html = mountPage({ version: "1.25.0", file: "/tmp/bridge.txt", canSave: true });
  const script = html.slice(html.indexOf("<script>") + 8, html.lastIndexOf("</script>"));
  assert.doesNotThrow(() => new Function(script), "скрипт страницы — валидный JS");

  // Проверка адреса должна принимать /exec и отвергать идентификатор
  // развёртывания — эту же проверку делает служба. Ищем строку в самом
  // скрипте: если её форма изменится, тест скажет об этом, а не промолчит.
  const line = script.split("\n").find((row) => row.includes(".test(url)"));
  assert.ok(line, "проверка адреса на месте");
  const regex = eval(line.trim().replace(/^if \(!?/, "").replace(/\.test\(url\)\)?\s*\{?$/, ""));
  assert.equal(regex.test("https://script.google.com/macros/s/ABC/exec"), true);
  assert.equal(regex.test("https://script.google.com/macros/s/ABC/deve"), false);
});

test("код для книги: те же действия, ключ обязателен, данных без ключа нет", () => {
  const code = readFileSync(new URL("../apps-script/Code.gs", import.meta.url), "utf8");
  for (const action of ["read", "write", "append", "updateRange", "meta", "ensureSheet", "notion"]) {
    assert.ok(code.includes(`'${action}'`), `мост умеет действие ${action}`);
  }
  assert.match(code, /body\.key \|\| ''\) !== String\(SECRET\)/, "ключ проверяется до любого действия");
  assert.match(code, /ЗАМЕНИТЕ-ЭТУ-СТРОКУ/, "ключ по умолчанию очевидно нерабочий");
  // GET не должен читать книгу: иначе адрес веб-приложения стал бы обходом ключа.
  const getBlock = code.slice(code.indexOf("function doGet()"));
  assert.doesNotMatch(getBlock, /readValues_|getDataRange/, "GET не отдаёт содержимое книги");
  assert.match(code, /SpreadsheetApp\.getActiveSpreadsheet/, "скрипт живёт внутри книги, а не ищет её по ID");
  // Без authorize() действие notion отказывает: веб-приложение не показывает
  // окно согласия, и право script.external_request выдаётся только из редактора.
  assert.match(code, /function authorize\(\)/, "функция авторизации на месте");
  assert.match(code, /UrlFetchApp\.fetch\('https:\/\/api\.notion\.com\/v1\/users\/me'/,
    "authorize вызывает внешний HTTP — это и есть повод для согласия");
  assert.match(code, /script\.external_request/, "название права названо в коде");
});

test("действие «notion»: путь ограничен /v1/, токен обязателен, хост зашит в скрипт", () => {
  const code = readFileSync(new URL("../apps-script/Code.gs", import.meta.url), "utf8");
  const block = code.slice(code.indexOf("case 'notion':"), code.indexOf("default:", code.indexOf("case 'notion':")));
  assert.ok(block, "блок notion на месте");
  assert.match(block, /\/\^\\\/v1\\\/\//, "путь проверяется на /v1/");
  assert.match(block, /нет токена Notion/, "без токена запроса нет");
  assert.match(block, /api\.notion\.com/, "хост Notion зашит в скрипт, а не берётся из запроса");
  assert.match(block, /muteHttpExceptions: true/, "статус Notion доходит как есть");
  assert.match(block, /followRedirects: false/, "редирект не скрывается за следованием");
  // Область видимости: ключ проверяется до switch, значит и до notion.
  assert.ok(code.indexOf("String(body.key || '') !== String(SECRET)") < code.indexOf("case 'notion':"),
    "ключ проверяется до действия notion");
});

test("Notion через мост: рабочий запрос идёт по адресу моста, а не напрямую", async () => {
  const { createNotionFetch, searchDatabases } = await import("../src/notion-db.mjs");
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init });
    if (String(url).includes("bridge")) {
      const body = JSON.parse(init.body);
      assert.equal(body.action, "notion");
      assert.equal(body.path, "/v1/search");
      assert.equal(body.token, "ntn_x");
      assert.equal(body.method, "POST");
      return {
        ok: true, status: 200,
        text: async () => JSON.stringify({ ok: true, status: 200, text: JSON.stringify({ results: [] }) }),
      };
    }
    throw new Error("прямой запрос не должен состояться: мост ответил");
  };
  const notionFetch = createNotionFetch({ bridge: { url: "https://bridge/exec", key: "k" }, fetchImpl });
  const found = await searchDatabases({ token: "ntn_x", fetchImpl: notionFetch });
  assert.deepEqual(found, [], "пустой поиск — пустой список, мост ответил данными");
  assert.equal(calls.length, 1, "ровно один запрос — к мосту");
  assert.ok(calls[0].url.includes("bridge"));
});

test("Notion через мост: мост недоступен — откат на прямой путь", async () => {
  const { createNotionFetch } = await import("../src/notion-db.mjs");
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    if (String(url).includes("bridge")) throw new Error("fetch failed");
    return {
      ok: true, status: 200, url: "https://api.notion.com/v1/users/me",
      headers: { entries: () => [] },
      text: async () => '{"object":"user"}',
    };
  };
  const notionFetch = createNotionFetch({ bridge: { url: "https://bridge/exec", key: "k" }, fetchImpl });
  const response = await notionFetch("https://api.notion.com/v1/users/me", {
    headers: { Authorization: "Bearer ntn_x" },
  });
  assert.equal(response.status, 200);
  assert.ok(calls.includes("https://bridge/exec"), "мост пробовался первым");
  assert.ok(calls.includes("https://api.notion.com/v1/users/me"), "прямой путь остался запасным");
});

test("Notion через мост: старый код в книге называет причину, а не прячет её в сетевой ошибке", async () => {
  const { createNotionFetch, searchDatabases } = await import("../src/notion-db.mjs");
  const fetchImpl = async (url) => {
    if (String(url).includes("bridge")) {
      // Так отвечает Code.gs без действия «notion» — до обновления книги.
      return { ok: true, status: 200, text: async () => JSON.stringify({ ok: false, why: "неизвестное действие «notion»" }) };
    }
    throw new Error("fetch failed");
  };
  const notionFetch = createNotionFetch({ bridge: { url: "https://bridge/exec", key: "k" }, fetchImpl });
  await assert.rejects(() => searchDatabases({ token: "ntn_x", fetchImpl: notionFetch }), (error) => {
    assert.match(error.message, /устарел/);
    assert.match(error.message, /Code\.gs/);
    return true;
  });
});

test("Notion через мост: отказ Notion (401) доходит как есть, без отката на прямой путь", async () => {
  const { createNotionFetch, searchDatabases } = await import("../src/notion-db.mjs");
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    if (String(url).includes("bridge")) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ ok: true, status: 401, text: '{"object":"error","message":"Could not authenticate"}' }) };
    }
    throw new Error("прямой путь не нужен: Notion уже ответил через мост");
  };
  const notionFetch = createNotionFetch({ bridge: { url: "https://bridge/exec", key: "k" }, fetchImpl });
  await assert.rejects(() => searchDatabases({ token: "ntn_bad", fetchImpl: notionFetch }), (error) => {
    assert.match(error.message, /Could not authenticate/);
    return true;
  });
  assert.equal(calls.filter((url) => url.includes("api.notion.com")).length, 0, "прямой запрос не делался");
});

test("Notion через мост: моста нет или нет токена — обычный прямой fetch", async () => {
  const { createNotionFetch } = await import("../src/notion-db.mjs");
  const direct = async (url) => ({
    ok: true, status: 200, url: String(url),
    headers: { entries: () => [] },
    text: async () => "{}",
  });

  const withoutBridge = createNotionFetch({ bridge: null, fetchImpl: direct });
  const a = await withoutBridge("https://api.notion.com/v1/users/me", { headers: { Authorization: "Bearer ntn_x" } });
  assert.equal(a.status, 200);

  // Проверка сети не носит токена — она должна идти напрямую и без моста.
  const calls = [];
  const tracked = async (url) => { calls.push(String(url)); return direct(url); };
  const withBridge = createNotionFetch({ bridge: { url: "https://bridge/exec", key: "k" }, fetchImpl: tracked });
  const b = await withBridge("https://api.notion.com/v1/users/me", { headers: { "Notion-Version": "2022-06-28" } });
  assert.equal(b.status, 200);
  assert.deepEqual(calls, ["https://api.notion.com/v1/users/me"], "без токена мост не спрашивается");
});
