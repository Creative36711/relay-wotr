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

export async function searchDatabases({ token, fetchImpl = globalThis.fetch, query = "", timeoutMs = 10000 } = {}) {
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
    if (error.name === "AbortError") throw new Error(`Notion не ответил за ${timeoutMs} мс`);
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
  token, dataSourceId, fetchImpl = globalThis.fetch, timeoutMs = 10000, pageSize = 100,
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
