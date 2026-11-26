// Хранилище состояния через мост в Apps Script — без ключа Google.
//
// Зачем ещё один способ. Прежний вход в книгу требовал сервисного аккаунта:
// проект в Google Cloud, Sheets API, ключ JSON, скачивание файла, адрес
// робота — и только потом доступ к книге. Владелец сформулировал это точно:
// «такая система — мучение». Ключи, которые он готов дать сам (Notion, GitHub),
// ничем не мешали; мешал именно Google-ключ, потому что его нельзя «просто
// получить» — его надо собрать из четырёх шагов в чужой консоли.
//
// Мост убирает все четыре. В книге открывается «Расширения → Apps Script»,
// туда вставляется готовый код (relay/apps-script/Code.gs), публикуется как
// веб-приложение — и владелец получает адрес и пароль. Эти два значения и есть
// весь вход: они вводятся один раз, дальше транспорт ходит к книге через них.
//
// Что это меняет по сути: доступ к таблице даёт не ключ, а сам скрипт, живущий
// внутри книги. Он работает от имени владельца, поэтому «добавьте адрес робота
// в редакторы» тоже больше не нужно.
//
// Формат запросов. Тело — JSON, но `Content-Type: text/plain`: Apps Script не
// отвечает на предварительный запрос CORS (`OPTIONS`), и обычный
// `application/json` заставил бы браузер его отправить. `text/plain` — это
// «простой запрос», предварительного нет, и doPost получает тело целиком.

import { SHEETS } from "./schema.mjs";

export class BridgeError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.name = "BridgeError";
    this.status = Number(status) || 0;
  }
}

/**
 * Клиент моста.
 *
 * Повторяет контракт `createSheetsStore` один в один — служба не должна знать,
 * откуда пришли строки. Это не удобство, а условие: иначе каждая новая
 * функция состояния писалась бы дважды и расходилась бы в поведении.
 */
export function createAppsScriptStore({
  url,
  key = "",
  fetchImpl = globalThis.fetch,
  timeoutMs = 20000,
} = {}) {
  if (!url) throw new BridgeError("не задан адрес моста Apps Script", 400);
  if (typeof fetchImpl !== "function") throw new BridgeError("нет fetch", 500);

  const sheetName = (sheetKey) => {
    const sheet = SHEETS[sheetKey];
    if (!sheet) throw new BridgeError(`листа ${sheetKey} нет в схеме`, 500);
    return sheet.name;
  };

  async function call(action, payload = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let text = "";
    try {
      const response = await fetchImpl(url, {
        method: "POST",
        // См. комментарий в шапке: text/plain не вызывает предварительный запрос.
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ action, key, ...payload }),
        signal: controller.signal,
        redirect: "follow",
      });
      text = await response.text();
      if (!response.ok) throw new BridgeError(`мост ответил HTTP ${response.status}`, response.status);
      let data = null;
      try {
        data = JSON.parse(text);
      } catch {
        // Apps Script при неверном развёртывании отдаёт HTML страницы входа.
        // Это самая частая ошибка («не тот доступ у веб-приложения»), и
        // «ответ не JSON» без подсказки ищется очень долго.
        throw new BridgeError(
          "мост вернул не JSON: обычно это значит, что веб-приложение открыто не для всех — " +
            "разверните заново с доступом «Все»",
          response.status,
        );
      }
      if (data && data.ok === false) throw new BridgeError(data.why || "мост отказал", 400);
      return data && typeof data === "object" ? data : {};
    } catch (error) {
      if (error.name === "AbortError") throw new BridgeError(`мост не ответил за ${timeoutMs} мс`, 408);
      if (error instanceof BridgeError) throw error;
      // Сетевая ошибка в браузере не говорит, что именно не так: адрес, CORS
      // или развёртывание. Называем три причины, чтобы не гадать.
      throw new BridgeError(
        `мост недоступен (${error.message}): проверьте адрес, доступ «Все» у веб-приложения и интернет`,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  async function read(sheetKey) {
    const data = await call("read", { sheet: sheetName(sheetKey) });
    return { header: Array.isArray(data.header) ? data.header : [], rows: Array.isArray(data.rows) ? data.rows : [] };
  }

  async function write(sheetKey, values, { range = "A1", valueInputOption = "RAW" } = {}) {
    return call("write", { sheet: sheetName(sheetKey), values, range, valueInputOption });
  }

  async function append(sheetKey, values, { valueInputOption = "RAW" } = {}) {
    return call("append", { sheet: sheetName(sheetKey), values, valueInputOption });
  }

  async function updateRange(sheetKey, startRow, values, { startColumn = "A" } = {}) {
    return call("updateRange", { sheet: sheetName(sheetKey), startRow, values, startColumn });
  }

  /** Метаданные в форме, которую ждёт служба: `{ sheets: [{ properties: { title } }] }`. */
  async function meta() {
    const data = await call("meta");
    const titles = Array.isArray(data.titles) ? data.titles : [];
    return { sheets: titles.map((title) => ({ properties: { title } })) };
  }

  async function ensureSheet(sheetKey) {
    const name = sheetName(sheetKey);
    const data = await call("ensureSheet", { sheet: name, columns: SHEETS[sheetKey].columns });
    return { created: data.created === true, name: data.name || name };
  }

  return { read, write, append, updateRange, meta, ensureSheet, call, bridge: url };
}
