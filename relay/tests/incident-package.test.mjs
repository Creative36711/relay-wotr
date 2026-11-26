// Пакет инцидента: то, чего Maintainer'у раньше не хватало.
//
// Проверяются три требования владельца:
//   • журнал из всех вкладок, а не из одной;
//   • действия пользователя видны отдельной дорожкой;
//   • видно, чей это run id, и что вообще в воздухе в момент поломки.

import test from "node:test";
import assert from "node:assert/strict";
import { buildIncidentPackage, runIdVerdict, liveRunsTable } from "../src/incident.mjs";
import { parseEvents, incidentWindow, splitLanes, makeEvent } from "../src/events.mjs";
import { parseRuns } from "../src/queue.mjs";
import { parseSlots } from "../src/slots.mjs";
import { eventRow, runRow, slotRows, queueRow } from "./fake-sheets.mjs";
import { parseQueue } from "../src/queue.mjs";

const T0 = Date.parse("2026-11-26T10:00:00Z");

const events = parseEvents([
  eventRow({ at: "2026-11-26T09:59:10Z", slot: "worker-1", kind: "net", level: "warn", text: "notion не ответил за 8000 мс" }),
  eventRow({ at: "2026-11-26T09:59:30Z", slot: "admin", kind: "ui", text: "нажата пауза", data: "" }),
  eventRow({ at: "2026-11-26T09:59:40Z", slot: "worker-2", kind: "dispatch", text: "выдача r-2 → worker-2", runId: "r-2", card: "c-2" }),
  eventRow({ at: "2026-11-26T10:00:00Z", slot: "worker-1", kind: "reply", level: "error", text: "маркер без run id", runId: "r-1", card: "c-1" }),
  eventRow({ at: "2026-11-26T08:00:00Z", slot: "worker-3", kind: "state", text: "старое событие вне окна" }),
]);

const runs = parseRuns([
  runRow({ runId: "r-1", card: "c-1", slot: "worker-1" }),
  runRow({ runId: "r-2", card: "c-2", slot: "worker-2" }),
  runRow({ runId: "r-3", card: "c-3", slot: "worker-3", status: "submitted" }),
]);

const slots = parseSlots(slotRows());

test("окно инцидента отсекает старое и сохраняет близкое", () => {
  const window = incidentWindow(events, { around: T0, windowMs: 600000 });
  assert.equal(window.length, 4, "событие двухчасовой давности не попадает в окно");
  assert.ok(window.every((event) => event.atMs >= T0 - 600000));
});

test("при переполнении первыми сохраняются ошибки и строки самого инцидента", () => {
  const many = Array.from({ length: 50 }, (_, index) => ({
    atMs: T0 - index * 1000,
    at: new Date(T0 - index * 1000).toISOString(),
    kind: "state", level: "info", text: `шум ${index}`, slot: "worker-2", card: "", runId: "",
  }));
  many.push({
    atMs: T0 - 400000, at: new Date(T0 - 400000).toISOString(),
    kind: "net", level: "error", text: "отказ шлюза", slot: "worker-3", card: "c-9", runId: "r-9",
  });
  const window = incidentWindow(many, { around: T0, windowMs: 600000, maxEvents: 5, card: "c-9", runId: "r-9" });
  assert.equal(window.length, 5);
  assert.ok(window.some((event) => event.text === "отказ шлюза"), "ошибка не вытесняется шумом");
});

test("дорожки разделены: что делал человек и что делал транспорт", () => {
  const { ui, transport } = splitLanes(incidentWindow(events, { around: T0, windowMs: 600000 }));
  assert.equal(ui.length, 1);
  assert.match(ui[0].text, /пауза/);
  assert.equal(transport.length, 3);
  assert.ok(!transport.some((event) => event.kind === "ui"));
});

test("пакет собирается с разделами, по которым можно разбирать", () => {
  const pack = buildIncidentPackage({
    incident: { kind: "маркер не разобран", cls: "transport", slot: "worker-1", card: "c-1", runId: "r-1", expectedRunId: "r-1", atMs: T0, reason: "ответ без run id" },
    events, runs, queue: parseQueue([queueRow({ id: "q-9", card: "c-9", status: "blocked" })]), slots, settings: { "transport.version": "1.19.0" }, now: T0,
  });
  for (const heading of [
    "Что видел пользователь",
    "Что делал транспорт",
    "Сторожевые и сетевые срабатывания",
    "Чей это run id",
    "Все живые выдачи",
    "Очередь на момент разбора",
    "Слоты",
  ]) {
    assert.ok(pack.text.includes(heading), `в пакете нет раздела «${heading}»`);
  }
  assert.match(pack.text, /нажата пауза/);
  assert.match(pack.text, /notion не ответил/);
  assert.match(pack.text, /r-1/);
  assert.equal(pack.facts.uiEvents, 1);
  assert.equal(pack.facts.liveRuns, 2);
});

test("пакет называет правило ответа Maintainer'а", () => {
  const pack = buildIncidentPackage({ incident: { kind: "проверка", atMs: T0 }, events, runs, queue: [], slots, settings: {}, now: T0 });
  assert.match(pack.text, /FIXED/);
  assert.match(pack.text, /NOTFIXED/);
});

test("чей run id: найден живой", () => {
  const verdict = runIdVerdict(runs, { runId: "r-1", card: "c-1" });
  assert.equal(verdict.verdict, "ok");
  assert.match(verdict.text, /жив/);
});

test("чей run id: принадлежит другой карточке", () => {
  const verdict = runIdVerdict(runs, { runId: "r-1", card: "c-7" });
  assert.equal(verdict.verdict, "foreign");
  assert.match(verdict.text, /принадлежит карточке c-1/);
});

test("чей run id: выдача уже закрыта", () => {
  const verdict = runIdVerdict(runs, { runId: "r-3", card: "c-3" });
  assert.equal(verdict.verdict, "closed");
  assert.match(verdict.text, /повторно или с опозданием/);
});

test("чей run id: не найден вовсе", () => {
  const verdict = runIdVerdict(runs, { runId: "r-несуществующий" });
  assert.equal(verdict.verdict, "unknown");
});

test("таблица живых выдач показывает, кто чем занят", () => {
  const table = liveRunsTable(runs).join("\n");
  assert.match(table, /r-1/);
  assert.match(table, /worker-2/);
  assert.ok(!table.includes("r-3"), "закрытая выдача в таблицу живых не попадает");
});

test("событие с данными сериализуется безопасно", () => {
  const cyclic = {};
  cyclic.self = cyclic;
  const event = makeEvent({ kind: "state", text: "проверка", data: cyclic });
  assert.ok(typeof event["Данные"] === "string");
});
