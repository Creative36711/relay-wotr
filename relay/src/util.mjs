// Мелкие общие функции. Отдельным файлом, потому что ими пользуются все
// модули, и дублировать их — верный способ разойтись в поведении.

/** Убрать пустые строки сверху и справа: Sheets отдаёт их как `[]`. */
export function trimRows(rows = []) {
  return rows.filter((row) => Array.isArray(row) && row.some((cell) => String(cell ?? "").trim()));
}

/** Лист «ключ → значение» в карту. Первая колонка — ключ, вторая — значение. */
export function arrayToMap(rows = []) {
  const map = {};
  for (const row of trimRows(rows)) {
    const key = String(row?.[0] ?? "").trim();
    if (!key) continue;
    map[key] = String(row?.[1] ?? "").trim();
  }
  return map;
}

/** ISO-время без миллисекунд: так оно короче и одинаково сортируется. */
export function isoNow(now = Date.now()) {
  return new Date(now).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** Идентификатор вкладки: короткий, чтобы не засорять журнал. */
export function shortTabId(seed = Math.random()) {
  return Math.random().toString(36).slice(2, 6) + String(seed).slice(-2);
}

/** Сон, который не мешает отмене: используется в ограниченных ожиданиях. */
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));

/** Сравнение без учёта регистра и пробелов: ID из Notion приходят в разном виде. */
export const norm = (value) => String(value ?? "").trim().toLowerCase();

/** Телеграм-подобное усечение с многоточием. */
export const clip = (text, limit = 200) => {
  const value = String(text ?? "");
  return value.length > limit ? `${value.slice(0, limit)}…` : value;
};
