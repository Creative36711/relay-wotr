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
  for (const action of ["read", "write", "append", "updateRange", "meta", "ensureSheet"]) {
    assert.ok(code.includes(`'${action}'`), `мост умеет действие ${action}`);
  }
  assert.match(code, /body\.key \|\| ''\) !== String\(SECRET\)/, "ключ проверяется до любого действия");
  assert.match(code, /ЗАМЕНИТЕ-ЭТУ-СТРОКУ/, "ключ по умолчанию очевидно нерабочий");
  // GET не должен читать книгу: иначе адрес веб-приложения стал бы обходом ключа.
  const getBlock = code.slice(code.indexOf("function doGet()"));
  assert.doesNotMatch(getBlock, /readValues_|getDataRange/, "GET не отдаёт содержимое книги");
  assert.match(code, /SpreadsheetApp\.getActiveSpreadsheet/, "скрипт живёт внутри книги, а не ищет её по ID");
});
