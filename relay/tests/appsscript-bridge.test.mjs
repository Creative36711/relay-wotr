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
