import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const app = await readFile(new URL("../web/app.js", import.meta.url), "utf8");
const start = app.indexOf("const fmtTime = (iso) => {");
const end = app.indexOf("\n};", start) + 3;
assert.ok(start >= 0 && end > start, "formatter is present");
const fmtTime = new Function(`${app.slice(start, end)}; return fmtTime;`)();

test("пульт показывает время журнала по Москве, а не по timezone машины", () => {
  assert.equal(fmtTime("2026-11-27T09:00:00.000Z"), "27.11 12:00:00 МСК");
});
