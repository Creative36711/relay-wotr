// Хранилище состояния в Google Sheets.
//
// Всё, что раньше лежало в памяти одной вкладки (`GM_setValue`) и умирало
// вместе с ней, теперь лежит здесь. Поэтому:
//   • две вкладки видят одну очередь и одни выдачи;
//   • «кто что нажимал» — это строки, а не воспоминание;
//   • Maintainer получает историю, а не последние 12 строк из буфера.
//
// Чтение всегда с `valueRenderOption=FORMATTED_VALUE`: Sheets сам приводит
// «да/нет» и числа к строке, а мы разбираем строки — значит, формат должен
// быть одинаковым у всех, кто пишет.

import { SHEETS } from "./schema.mjs";

const API = "https://sheets.googleapis.com/v4/spreadsheets";

export class SheetsError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "SheetsError";
    this.status = Number(status) || 0;
  }
}

/** Клиент таблицы. Токен берётся у вызывающего: служба не хранит секретов сама. */
export function createSheetsStore({ spreadsheetId, token, fetchImpl = globalThis.fetch, timeoutMs = 15000 }) {
  if (!spreadsheetId) throw new SheetsError("не задан spreadsheetId", 400);
  if (typeof fetchImpl !== "function") throw new SheetsError("нет fetch", 500);

  const auth = () => {
    if (!token) throw new SheetsError("нет токена доступа к таблице", 401);
    return { Authorization: `Bearer ${token}` };
  };

  async function call(path, init = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(`${API}/${spreadsheetId}${path}`, {
        ...init,
        signal: controller.signal,
        headers: { "Content-Type": "application/json", ...auth(), ...(init.headers || {}) },
      });
      const text = await response.text();
      const data = text ? JSON.parse(text) : {};
      if (!response.ok) {
        throw new SheetsError(data?.error?.message || `HTTP ${response.status}`, response.status);
      }
      return data;
    } catch (error) {
      if (error.name === "AbortError") throw new SheetsError(`таблица не ответила за ${timeoutMs} мс`, 408);
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  const quote = (name) => `'${String(name).replace(/'/g, "''")}'`;

  /** Прочитать лист целиком, без шапки. */
  async function read(sheetKey) {
    const { name } = SHEETS[sheetKey];
    const data = await call(`/values/${encodeURIComponent(quote(name))}?valueRenderOption=FORMATTED_VALUE`);
    const rows = Array.isArray(data.values) ? data.values : [];
    return { header: rows[0] || [], rows: rows.slice(1) };
  }

  /** Записать прямоугольник значений, начиная с указанной ячейки. */
  async function write(sheetKey, values, { range = "A1", valueInputOption = "RAW" } = {}) {
    const { name } = SHEETS[sheetKey];
    const target = `${quote(name)}!${range}`;
    return call(`/values/${encodeURIComponent(target)}?valueInputOption=${valueInputOption}`, {
      method: "PUT",
      body: JSON.stringify({ range: target, majorDimension: "ROWS", values }),
    });
  }

  /** Дописать строки в конец листа. */
  async function append(sheetKey, values, { valueInputOption = "RAW" } = {}) {
    const { name } = SHEETS[sheetKey];
    const target = `${quote(name)}!A1`;
    return call(
      `/values/${encodeURIComponent(target)}:append?valueInputOption=${valueInputOption}&insertDataOption=INSERT_ROWS`,
      { method: "POST", body: JSON.stringify({ range: target, majorDimension: "ROWS", values }) },
    );
  }

  /**
   * Перезаписать диапазон с известными границами.
   *
   * Нужен там, где важна позиция: обновление строки очереди или выдачи по
   * номеру. Append для этого не годится — он всегда в конец.
   */
  async function updateRange(sheetKey, startRow, values, { startColumn = "A" } = {}) {
    const { name } = SHEETS[sheetKey];
    const width = Math.max(...values.map((row) => row.length));
    const lastColumn = columnLetter(String(startColumn).charCodeAt(0) - 65 + width);
    const range = `${startColumn}${startRow}:${lastColumn}${startRow + values.length - 1}`;
    const target = `${quote(name)}!${range}`;
    return call(`/values/${encodeURIComponent(target)}?valueInputOption=RAW`, {
      method: "PUT",
      body: JSON.stringify({ range: target, majorDimension: "ROWS", values }),
    });
  }

  /** Метаданные книги: нужны, чтобы понять номера строк и наличие листов. */
  async function meta() {
    return call("?fields=sheets.properties(title,sheetId,index),properties(title)");
  }

  return { read, write, append, updateRange, meta, call, spreadsheetId };
}

/** A→A, B→B, …, Z→Z, AA→AA. Нужен для диапазонов записи. */
export function columnLetter(index) {
  let n = Number(index);
  let out = "";
  do {
    const rem = n % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

/**
 * Найти номер строки по значению первой колонки.
 *
 * Возвращает номер строки в таблице (1 — шапка), чтобы вызывающий мог писать
 * точечно. `null` — строки нет; это не ошибка, а «ещё не создана».
 */
export function rowIndexOf(rows, sheetKey, predicate) {
  const { columns } = SHEETS[sheetKey];
  for (let i = 0; i < rows.length; i += 1) {
    const obj = {};
    for (let c = 0; c < columns.length; c += 1) obj[columns[c]] = String(rows[i]?.[c] ?? "");
    if (predicate(obj)) return { row: i + 2, object: obj };
  }
  return null;
}
