// Хранилище в памяти — для демонстрации пульта и для тестов вручную.
//
// Зачем это в продукте, а не только в тестах: человек должен увидеть пульт до
// того, как заведёт книгу. Иначе «настройка» начинается со страницы, которая
// ничего не показывает, и первый опыт — это ошибка.
//
// Реализует тот же интерфейс, что и Sheets-хранилище: read/append/updateRange/
// meta/write. Ничего лишнего, чтобы подмена была незаметной для службы.

import { SHEETS } from "./schema.mjs";

const DEMO_SLOTS = [
  ["admin", "arena-creative", "creative36711@gmail.com", "да", "активен", "только административные роли"],
  ["worker-1", "arena-yandex", "Creative36711@yandex.ru", "нет", "активен", ""],
  ["worker-2", "arena-list", "creative36711@list.ru", "нет", "активен", ""],
  ["worker-3", "arena-textile", "textile33b@gmail.com", "нет", "активен", ""],
];

const DEMO_SETTINGS = [
  ["project.name", "WOTR Remaster", "text", "basic", "", ""],
  ["notion.rolesDb", "ds-roles", "text", "basic", "", ""],
  ["notion.slotsDb", "ds-slots", "text", "basic", "", ""],
  ["notion.requestsDb", "ds-requests", "text", "basic", "", ""],
  ["cycle.mode", "manual", "enum", "basic", "manual", ""],
  ["cycle.maxParallel", "2", "number", "advanced", "2", ""],
  ["transport.version", "1.22.0", "text", "basic", "1.22.0", ""],
];

export function createDemoStore({ now = () => Date.now() } = {}) {
  const sheets = {};
  for (const [key, spec] of Object.entries(SHEETS)) sheets[key] = [spec.columns.slice()];

  const push = (key, row) => sheets[key].push(row.map((cell) => String(cell ?? "")));
  for (const row of DEMO_SLOTS) push("slots", row);
  for (const row of DEMO_SETTINGS) push("settings", row);

  // Пара событий, чтобы пульт не выглядел пустым: человек видит форму журнала.
  push("events", ["2026-11-26T09:20:00Z", "admin", "", "t1", "ui", "info", "открыт пульт (демо-режим)", "", "", "", ""]);
  push("events", ["2026-11-26T09:21:00Z", "worker-1", "creative36711@yandex.ru", "t1", "state", "info", "слот worker-1 опознан", "", "", "", ""]);

  return {
    demo: true,
    sheets,
    async read(key) {
      const rows = sheets[key] || [];
      return { header: rows[0] || [], rows: rows.slice(1) };
    },
    async write() {
      return { updatedCells: 0 };
    },
    async append(key, values) {
      for (const row of values) push(key, row);
      return { updates: { updatedRows: values.length } };
    },
    async updateRange(key, startRow, values) {
      const target = sheets[key];
      if (!target) throw new Error(`нет листа ${key}`);
      values.forEach((row, offset) => {
        const index = startRow - 1 + offset;
        while (target.length <= index) target.push([]);
        target[index] = row.map((cell) => String(cell ?? ""));
      });
      return { updatedCells: values.length * (values[0]?.length || 1) };
    },
    async meta() {
      return { sheets: Object.keys(sheets).map((key) => ({ properties: { title: SHEETS[key].name } })) };
    },
    now,
  };
}
