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
