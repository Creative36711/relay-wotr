// Поддельная книга состояний для тестов.
//
// Повторяет поведение настоящего хранилища там, где оно важно: чтение с
// шапкой, дописывание в конец, точечная перезапись строки. Сети нет, поэтому
// тесты быстрые и не зависят от токена.

import { SHEETS } from "../src/schema.mjs";

export function createFakeStore(initial = {}) {
  const sheets = {};
  for (const [key, spec] of Object.entries(SHEETS)) {
    sheets[key] = [spec.columns.slice(), ...((initial[key] || []).map((row) => row.slice()))];
  }

  const store = {
    sheets,
    writes: 0,
    appends: 0,
    async read(key) {
      // Как настоящий Sheets: чтение несуществующего листа — ошибка, а не
      // пустота. Иначе тест «лист создаётся сам» проходил бы на книге, где
      // листа нет, и не проверял бы ничего.
      if (!sheets[key]) throw new Error(`не удалось прочитать диапазон ${key}: листа нет`);
      const rows = sheets[key];
      return { header: rows[0] || [], rows: rows.slice(1) };
    },
    async write() {
      store.writes += 1;
      return { updatedCells: 0 };
    },
    async append(key, values) {
      store.appends += 1;
      for (const row of values) sheets[key].push(row.slice());
      return { updates: { updatedRows: values.length } };
    },
    async updateRange(key, startRow, values) {
      store.writes += 1;
      const target = sheets[key];
      if (!target) throw new Error(`нет листа ${key}`);
      values.forEach((row, offset) => {
        const index = startRow - 1 + offset;
        while (target.length <= index) target.push([]);
        const width = Math.max(target[index].length, row.length);
        const next = new Array(width).fill("");
        for (let c = 0; c < width; c += 1) next[c] = String(row[c] ?? target[index][c] ?? "");
        target[index] = next;
      });
      return { updatedCells: values.length * (values[0]?.length || 1) };
    },
    async meta() {
      return { sheets: Object.keys(sheets).map((key) => ({ properties: { title: SHEETS[key].name } })) };
    },
    async ensureSheet(key) {
      if (!SHEETS[key]) throw new Error(`листа ${key} нет в схеме`);
      if (sheets[key]) return { created: false, name: SHEETS[key].name };
      sheets[key] = [SHEETS[key].columns.slice()];
      return { created: true, name: SHEETS[key].name };
    },
    /** Строки листа как объекты — для утверждений в тестах. */
    objects(key) {
      const [header, ...rows] = sheets[key] || [[]];
      return rows.map((row) => {
        const out = {};
        header.forEach((column, index) => { out[column] = String(row[index] ?? ""); });
        return out;
      });
    },
  };
  return store;
}

export const settingsRows = (overrides = {}) => {
  const values = {
    "project.name": "WOTR Remaster",
    "notion.rolesDb": "ds-roles",
    "notion.slotsDb": "ds-slots",
    "notion.requestsDb": "ds-requests",
    "cycle.mode": "manual",
    "cycle.maxParallel": "2",
    "transport.version": "1.19.0",
    ...overrides,
  };
  return Object.entries(values).map(([key, value]) => [key, value, "text", "basic", "", ""]);
};

export const slotRows = (extra = []) => [
  ["admin", "arena-creative", "creative36711@gmail.com", "да", "активен", ""],
  ["worker-1", "arena-yandex", "Creative36711@yandex.ru", "нет", "активен", ""],
  ["worker-2", "arena-list", "creative36711@list.ru", "нет", "активен", ""],
  ["worker-3", "arena-textile", "textile33b@gmail.com", "нет", "активен", ""],
  ...extra,
];

export const queueRow = ({ id, card = "card-1", title = "Заголовок", role = "Technical Artist", slot = "", status = "waiting", at = "2026-11-26T10:00:00Z", kind = "dispatch" }) => [
  id, at, card, title, role, "Executor", slot, kind, status, "", "", "", "",
];

/** Строка листа «Экземпляры»: живой агент пары (роль, слот). */
export const agentRow = ({ role, slot, url = `https://arena.example/${slot}`, state = "создан", note = "" }) => [
  role, slot, url, state, "2026-11-26T09:00:00Z", "", "2026-11-26T10:00:00Z", note,
];

/** Экземпляры для тех ролей, что встречаются в тестах службы. */
export const knownAgentRows = (roles = ["Technical Artist", "Godot World Engineer", "Tactical Bridge Engineer"], slots = ["worker-1", "worker-2", "worker-3"]) =>
  roles.flatMap((role) => slots.map((slot) => agentRow({ role, slot })));

export const runRow = ({ runId, card = "card-1", slot = "worker-1", status = "issued", role = "Technical Artist", account = "", at = "2026-11-26T10:00:00Z" }) => [
  runId, card, "Заголовок", slot, account, role, "", status, at, at, "", "1", "", "",
];

export const eventRow = ({ at, slot = "", kind = "state", level = "info", text = "", card = "", runId = "", data = "" }) => [
  at, slot, "", "t1", kind, level, text, card, runId, "", data,
];
