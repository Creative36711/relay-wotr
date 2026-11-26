// Единственный интерфейс транспорта: пульт и служба в одном процессе.
//
// Интерфейс ScriptCat больше не нужен: настройка, шаг, пауза и очередь живут
// здесь. Вкладка осталась исполнителем — она умеет только разговаривать с
// арена-страницей, и это правильно: браузерный код нельзя перезапустить, а
// службу можно.
//
// Три правила, задающие форму файла:
//   1. Служба ничего не хранит в памяти, что должно пережить перезапуск.
//      Поэтому состояние — таблица, а память процесса только ускоряет чтение.
//   2. Любой отказ возвращается человеку словами, а не кодом.
//   3. Пульт — статическая страница без сборки: он должен открываться, даже
//      когда транспорт сломан, иначе чинить будет нечем.

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { createSheetsStore } from "./store.mjs";
import { createService } from "./service.mjs";
import { readiness } from "./setup.mjs";
import { searchDatabases } from "./notion-db.mjs";
import { createDemoStore } from "./demo-store.mjs";

const here = fileURLToPath(new URL(".", import.meta.url));
const WEB_ROOT = join(here, "..", "web");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

const readBody = (request, limit = 1024 * 1024) =>
  new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("запрос слишком большой"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      if (!text) return resolve({});
      try {
        resolve(JSON.parse(text));
      } catch {
        reject(new Error("тело запроса не разобрано как JSON"));
      }
    });
    request.on("error", reject);
  });

const send = (response, status, data, headers = {}) => {
  const body = typeof data === "string" ? data : JSON.stringify(data);
  response.writeHead(status, {
    "Content-Type": typeof data === "string" ? "text/plain; charset=utf-8" : "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    ...headers,
  });
  response.end(body);
};

/**
 * Домен, на котором живёт пульт.
 *
 * Вкладка работает на `arena.ai`, служба — на своём адресе, поэтому запросы
 * идут с чужим Origin. Разрешаем всем: пульт не хранит секретов и не имеет
 * прав, которых нет у токена в запросе. Если понадобится ограничить — это
 * делается списком хостов в настройках, а не молчаливым отказом.
 */
const allowOrigin = (response) => {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Headers", "content-type, authorization");
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
};

export function createTransportServer({
  spreadsheetId,
  token = "",
  tokenProvider = null,
  fetchImpl = globalThis.fetch,
  now = () => Date.now(),
  log = () => {},
  storeFactory = createSheetsStore,
  NOTION_TOKEN = "",
  demo = false,
} = {}) {
  // Демо-режим — не игрушка, а первое знакомство: пульт показывается до того,
  // как заведена книга. Служба при этом та же, меняется только хранилище.
  const demoStore = demo ? createDemoStore({ now }) : null;
  if (!spreadsheetId && !demo) throw new Error("не задан spreadsheetId: службе негде хранить состояние");

  const tokenFor = async () => {
    if (tokenProvider) return tokenProvider();
    return token;
  };

  // Токен берётся на каждый запрос: он короткоживущий, и кэшировать его на
  // всё время жизни процесса — значит умереть через час.
  const store = {
    demo,
    read: async (key) => (await getStore()).read(key),
    write: async (...args) => (await getStore()).write(...args),
    append: async (...args) => (await getStore()).append(...args),
    updateRange: async (...args) => (await getStore()).updateRange(...args),
    meta: async () => (await getStore()).meta(),
  };
  let cachedStore = null;
  let cachedToken = "";
  const getStore = async () => {
    if (demoStore) return demoStore;
    const current = await tokenFor();
    if (!cachedStore || current !== cachedToken) {
      cachedStore = storeFactory({ spreadsheetId, token: current, fetchImpl });
      cachedToken = current;
    }
    return cachedStore;
  };

  // Мастер ищет базы тем же токеном, что и всё остальное: отдельного секрета
  // для настройки нет, иначе «минимум ввода» превратится в «ещё один ключ».
  const notionToken = NOTION_TOKEN || process.env.NOTION_TOKEN || process.env.RELAY_NOTION_TOKEN || "";
  const notionSearch = notionToken
    ? () => searchDatabases({ token: notionToken, fetchImpl, query: "" })
    : null;

  const service = createService({ store, now, log, notionSearch });

  const server = createServer(async (request, response) => {
    allowOrigin(response);
    const url = new URL(request.url || "/", "http://localhost");

    if (request.method === "OPTIONS") return send(response, 204, "");

    try {
      if (url.pathname === "/api/health") {
        return send(response, 200, {
          ok: true, at: new Date(now()).toISOString(), service: "relay-wotr",
          demo, spreadsheet: demo ? "в памяти" : spreadsheetId,
        });
      }

      // Протокол вкладки. Отдельный путь, чтобы вкладке не нужно было знать
      // про пульт, а польту — про вкладку.
      if (url.pathname === "/api/agent" && request.method === "POST") {
        const body = await readBody(request);
        const result = await service.handle(body);
        if (body.action === "pull" && result?.work) {
          await service.record({
            slot: body.slotId || "", tab: body.tab || "", kind: "dispatch",
            text: `вкладка забрала выдачу ${result.work.runId}`, runId: result.work.runId, card: result.work.card,
          }).catch(() => {});
        }
        return send(response, result.ok === false && result.why?.includes("нет в таблице") ? 404 : 200, result);
      }

      if (url.pathname === "/api/snapshot" && request.method === "GET") {
        return send(response, 200, await service.snapshot());
      }

      if (url.pathname === "/api/incident" && request.method === "POST") {
        const body = await readBody(request);
        return send(response, 200, await service.incidentPackage({
          card: body.card, runId: body.runId, slot: body.slot, aroundMs: body.aroundMs,
        }));
      }

      if (url.pathname === "/api/control" && request.method === "POST") {
        const body = await readBody(request);
        return send(response, 200, await service.handle(body));
      }

      // Пульт: статика. Отдаётся и при GET / — человек открывает адрес и
      // сразу видит состояние, без отдельной страницы входа.
      if (request.method === "GET" && !url.pathname.startsWith("/api/")) {
        const rel = url.pathname === "/" ? "index.html" : url.pathname.replace(/^\/+/, "");
        const safe = normalize(rel).replace(/^\.\.(\/|\\|$)/, "");
        const file = join(WEB_ROOT, safe);
        try {
          const data = await readFile(file);
          return send(response, 200, data.toString("utf8"), { "Content-Type": MIME[extname(file)] || "application/octet-stream" });
        } catch {
          if (url.pathname !== "/") return send(response, 404, { ok: false, why: `нет файла ${safe}` });
        }
      }

      return send(response, 404, { ok: false, why: `неизвестный путь ${url.pathname}` });
    } catch (error) {
      log(`ошибка запроса ${url.pathname}: ${error.message}`);
      return send(response, 500, { ok: false, why: error.message });
    }
  });

  return { server, service, store };
}

/** Готовность к запуску в человекочитаемом виде: этим отвечает пульт. */
export async function serverReadiness({ service }) {
  try {
    const data = await service.loadAll();
    return readiness({ settings: data.settings, slots: data.slots });
  } catch (error) {
    return { ok: false, problems: [`таблица состояния недоступна: ${error.message}`] };
  }
}

