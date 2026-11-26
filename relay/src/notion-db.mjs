// Поиск баз в Notion для мастера настройки.
//
// Мастер не спрашивает ID: он ищет базу по названию и показывает, что нашёл.
// Это работает только если транспорт видит то же, что интеграция, поэтому
// поиск намеренно узкий — по названию, с отказом при неоднозначности.
//
// Сеть здесь одна: `/v1/search`. Токен берётся у вызывающего, служба его не
// хранит.

const API = "https://api.notion.com/v1";
const VERSION = "2022-06-28";

/**
 * Сколько ждать Notion.
 *
 * 10 секунд было мало: первый TLS-запрос после сна, медленный DNS или VPN
 * укладываются в 12–15, и человек видел «не ответил за 10000 мс» при полностью
 * исправном токене. Минута — верхняя граница, после которой ждать бессмысленно.
 */
export const NOTION_TIMEOUT_MS = 30000;

/**
 * Результаты поиска приводятся к одному виду: `{ title, id, dataSourceId }`.
 *
 * В новых версиях Notion база — контейнер, а свойства живут в источнике данных
 * (data source). Транспорту нужен именно источник: по нему он читает строки.
 */
export function normalizeSearchResults(payload) {
  const results = Array.isArray(payload?.results) ? payload.results : [];
  return results
    .map((item) => {
      const title = Array.isArray(item?.title)
        ? item.title.map((part) => part?.plain_text ?? part?.text?.content ?? "").join("")
        : "";
      const sources = Array.isArray(item?.data_sources) ? item.data_sources : [];
      return {
        id: item?.id || "",
        title: title.trim(),
        object: item?.object || "",
        dataSourceId: sources[0]?.id || (item?.object === "data_source" ? item.id : ""),
        dataSourceCount: sources.length,
      };
    })
    .filter((item) => item.title);
}

/**
 * Проверка: доходит ли запрос до Notion вообще.
 *
 * Зачем отдельно от поиска. «Токен не принят» и «до Notion не дошли» — разные
 * поломки, и лечатся они в разных местах: первое в Notion, второе в сети.
 * Когда человек сидит за VPN, прокси или фильтром, любого уровня, запрос
 * умирает до всякой аутентификации, и по ответу поиска это не отличить.
 *
 * Здесь мы просто стучимся в сервер `api.notion.com` без токена и без своего
 * таймаута (свой таймаут у поиска — 30 с). Ответ 4xx — это уже успех: значит
 * соединение есть, и дело в токене или в доступе интеграции.
 */
/**
 * Человеческая причина сетевого отказа.
 *
 * `fetch failed` — это не диагноз, а обёртка: настоящая причина лежит в
 * `error.cause` (`ECONNRESET`, `ENOTFOUND`, `UNABLE_TO_VERIFY_LEAF_SIGNATURE`).
 * Без неё человек идёт перевыпускать токен вместо того, чтобы выключить VPN,
 * и мы с ним вдвоём ищем то, чего нет.
 */
export function networkReason(error) {
  const code = error?.cause?.code || error?.code || "";
  const message = String(error?.message || "");
  const raw = String(error?.cause?.message || error?.message || "");
  if (/UNABLE_TO_VERIFY_LEAF_SIGNATURE|SELF_SIGNED_CERT|CERT_|ERR_TLS/i.test(`${code} ${message} ${raw}`)) {
    return "сертификат подменён — так делает антивирус, корпоративный прокси или VPN";
  }
  if (/ECONNRESET|ECONNREFUSED|EPIPE/i.test(`${code} ${message}`)) {
    return "соединение оборвалось — обычно это прокси или фильтр и отбрасывает запрос";
  }
  if (/ENOTFOUND|EAI_AGAIN/i.test(`${code} ${message}`)) {
    return "имя api.notion.com не разрешилось — смотрите DNS или VPN";
  }
  if (/ETIMEDOUT|TIMEOUT|aborted/i.test(`${code} ${message}`)) {
    return "запрос ушёл и не вернулся — сеть слишком медленная или режется";
  }
  return "";
}

export async function pingNotion({ fetchImpl = globalThis.fetch, timeoutMs = 15000 } = {}) {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${API}/users/me`, {
      method: "GET",
      signal: controller.signal,
      headers: { "Notion-Version": VERSION },
    });
    const ms = Date.now() - started;
    // 401 без токена — это ровно то, что нужно: сервер ответил.
    return {
      ok: true,
      ms,
      status: response.status,
      why: `Notion отвечает за ${ms} мс (HTTP ${response.status} без токена — так и должно быть). ` +
        "Сеть в порядке, дело не в ней",
    };
  } catch (error) {
    const ms = Date.now() - started;
    if (error.name === "AbortError") {
      return {
        ok: false,
        ms,
        why: `Notion не ответил за ${Math.round(timeoutMs / 1000)} с: запрос не доходит. ` +
          "Это VPN, прокси или фильтрация — токен тут не при чём",
      };
    }
    const reason = networkReason(error);
    const code = error?.cause?.code || error?.code || "";
    return {
      ok: false,
      ms,
      code,
      why: `до api.notion.com не дозвонились${code ? ` (${code})` : ""}: ` +
        `${reason || "это сеть, VPN или прокси"}. Токен тут не при чём — исправьте сеть и нажмите ещё раз`,
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function searchDatabases({ token, fetchImpl = globalThis.fetch, query = "", timeoutMs = NOTION_TIMEOUT_MS } = {}) {
  if (!token) throw new Error("нет токена Notion: мастер не может искать базы");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${API}/search`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "Notion-Version": VERSION,
      },
      body: JSON.stringify({
        query: query || "",
        filter: { value: "database", property: "object" },
        page_size: 100,
      }),
    });
    const text = await response.text();
    const data = text ? JSON.parse(text) : {};
    if (!response.ok) {
      throw new Error(data?.message || `Notion ответил ${response.status}`);
    }
    return normalizeSearchResults(data);
  } catch (error) {
    if (error.name === "AbortError") {
      // Долгое ожидание — это почти всегда сеть: VPN, прокси, «Notion
      // заблокирован», а не токен. Об этом и говорим, иначе человек идёт
      // перевыпускать ключ, который рабочий.
      throw new Error(
        `Notion не ответил за ${Math.round(timeoutMs / 1000)} с: запрос не доходит. ` +
        "Это VPN, прокси или фильтрация — токен тут не при чём. Нажмите «Проверить сеть»",
      );
    }
    // `fetch failed` — это тоже не «токен плохой», а «до Notion не дошли».
    if (/fetch failed|network|ENOTFOUND|EAI_AGAIN|ECONNRESET|certificate/i.test(
      `${error.message} ${error?.cause?.code || ""} ${error?.cause?.message || ""}`,
    )) {
      const code = error?.cause?.code || "";
      const reason = networkReason(error);
      throw new Error(
        `до Notion не дозвонились${code ? ` (${code})` : ""}: ${reason || "проверьте интернет или VPN"}. Токен тут не при чём`,
      );
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/** Токен Notion для мастера: берётся из окружения или настройки, но не хранится в книге. */
export const notionTokenFrom = (env = {}) => env.NOTION_TOKEN || env.RELAY_NOTION_TOKEN || "";

/**
 * Чтение базы «Роли» из Notion.
 *
 * Зачем это нужно службе. Все правила выдачи держатся на свойствах роли:
 * административность (по `Функция` и имени), репозиторий, готовность строки.
 * Пока строки приходили только в строке очереди, служба не могла ответить на
 * вопрос «кто вообще вправе взять эту карточку» и не могла построить пары
 * «роль × слот». Тест на `pull` это и показал: карточка роли Technical Artist
 * получала отказ, потому что справочника ролей у службы не было вовсе.
 *
 * Чтение терпимое: недоступный Notion не должен останавливать цикл. Без
 * справочника работают правила по строке очереди (там есть `Функция`), просто
 * административность определяется чуть грубее.
 */
export function normalizeRoleRow(page) {
  const props = page?.properties || {};
  const text = (value) => {
    if (!value) return "";
    if (value.type === "title") return (value.title || []).map((part) => part?.plain_text || "").join("").trim();
    if (value.type === "rich_text") return (value.rich_text || []).map((part) => part?.plain_text || "").join("").trim();
    if (value.type === "select") return value.select?.name || "";
    if (value.type === "url") return value.url || "";
    return "";
  };
  return {
    pageId: page?.id || "",
    name: text(props["Роль"]),
    fn: text(props["Функция"]),
    status: text(props["Статус"]),
    url: text(props["Agent URL"]),
    repo: text(props["Репозиторий"]),
    agentAdmin: props["Agent Admin"]?.checkbox === true,
    agentState: text(props["Agent State"]) || "не требуется",
  };
}

export async function fetchRoles({
  token, dataSourceId, fetchImpl = globalThis.fetch, timeoutMs = NOTION_TIMEOUT_MS, pageSize = 100,
} = {}) {
  if (!token) throw new Error("нет токена Notion: справочник ролей не прочитать");
  if (!dataSourceId) throw new Error("не задан источник ролей (notion.rolesDb)");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const rows = [];
  try {
    let cursor = "";
    for (let guard = 0; guard < 20; guard += 1) {
      const response = await fetchImpl(`${API}/databases/${encodeURIComponent(dataSourceId)}/query`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "Notion-Version": VERSION,
        },
        body: JSON.stringify({ page_size: pageSize, ...(cursor ? { start_cursor: cursor } : {}) }),
      });
      const body = await response.text();
      const data = body ? JSON.parse(body) : {};
      if (!response.ok) throw new Error(data?.message || `Notion ответил ${response.status}`);
      for (const page of data.results || []) {
        const row = normalizeRoleRow(page);
        if (row.name) rows.push(row);
      }
      if (!data.has_more || !data.next_cursor) break;
      cursor = data.next_cursor;
    }
    return rows;
  } catch (error) {
    if (error.name === "AbortError") throw new Error(`Notion не ответил за ${timeoutMs} мс`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
