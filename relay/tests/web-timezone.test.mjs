import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const app = await readFile(new URL("../web/app.js", import.meta.url), "utf8");
const html = await readFile(new URL("../web/index.html", import.meta.url), "utf8");
const start = app.indexOf("const fmtTime = (iso) => {");
const end = app.indexOf("\n};", start) + 3;
assert.ok(start >= 0 && end > start, "formatter is present");
const fmtTime = new Function(`${app.slice(start, end)}; return fmtTime;`)();

test("пульт показывает время журнала по Москве, а не по timezone машины", () => {
  assert.equal(fmtTime("2026-11-27T09:00:00.000Z"), "27.11 12:00:00 МСК");
});

test("всплывающие сообщения пульта остаются в локальной истории после исчезновения баннера", () => {
  const start = app.indexOf("function bannerHistoryNext(");
  const end = app.indexOf("\n}", start) + 2;
  assert.ok(start >= 0 && end > start, "pure history reducer is present");
  const next = new Function(`${app.slice(start, end)}; return bannerHistoryNext;`)();
  let entries = next([], "admin не опрашивает Relay", 1000);
  entries = next(entries, "admin не опрашивает Relay", 5000);
  assert.equal(entries.length, 1, "одинаковая плашка не засоряет журнал");
  assert.equal(entries[0].count, 2, "число повторов сохранено");
  entries = next(entries, "следующая причина", 25000);
  assert.equal(entries.length, 2, "новая причина остаётся отдельной записью");
  for (let i = 0; i < 60; i += 1) entries = next(entries, `ошибка ${i}`, 30000 + i);
  assert.equal(entries.length, 50, "история ограничена последними 50 сообщениями");
  assert.match(app, /localStorage\.setItem\(BANNER_HISTORY_KEY/);
  assert.match(app, /rememberBanner\(text\)/);
  assert.match(html, /id="banner-history-wrap"/);
});
