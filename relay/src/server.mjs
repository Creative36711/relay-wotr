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
import { mountPage } from "./mount-page.mjs";
import { createAppsScriptStore, bridgeReachability } from "./appsscript-bridge.mjs";
import { normalizeBridgeInput, writeBridgeFile } from "./bridge-config.mjs";
import { currentProxy } from "./notion-db.mjs";
import { normalizeProxy, writeProxyFile } from "./proxy-config.mjs";
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
  bridgeUrl = "",
  bridgeKey = "",
  version = "",
  // Куда записывать адрес и ключ моста, если владелец вводит их в браузере.
  // Пусто — запись недоступна, и страница честно скажет об этом вместо
  // «сохранено», после которого ничего не работает.
  bridgeFile = "",
  // Куда записать прокси, если владелец вводит его в пульте. Пусто — запись
  // недоступна, и страница честно скажет, что дописать.
  proxyFile = "",
  // Чем читать книгу, когда настроен мост. Отдельно от storeFactory: мост
  // может появиться на ходу (адрес ввели в браузере), а storeFactory уже
  // выбран при старте — под Google-токен или под что-то ещё.
  bridgeStoreFactory = ({ url, key }) => createAppsScriptStore({ url, key, fetchImpl }),
  onBridgeChange = null,
} = {}) {
  // Демо-режим — не игрушка, а первое знакомство: пульт показывается до того,
  // как заведена книга. Служба при этом та же, меняется только хранилище.
  // Демо — живое состояние, а не константа старта: как только владелец ввёл
  // адрес моста, книга появилась, и служба обязана выйти из демо сама.
  // Демо-хранилище создаётся один раз и переиспользуется: журнал, который
  // человек уже видел, не должен исчезнуть от ввода адреса.
  const demoStore = demo ? createDemoStore({ now }) : null;
  let demoNow = demo;
  // Адрес и ключ моста меняются на ходу: владелец вставляет их в браузере, и
  // заставлять его перезапускать службу ради этого — лишний шаг, который мы и
  // убираем. Поэтому они живут в изменяемой паре, а не в параметрах.
  let bridge = { url: bridgeUrl, key: bridgeKey };
  const bridgeReady = () => Boolean(bridge.url);
  if (!spreadsheetId && !demo) throw new Error("не задан spreadsheetId: службе негде хранить состояние");

  const tokenFor = async () => {
    if (tokenProvider) return tokenProvider();
    return token;
  };

  // Токен берётся на каждый запрос: он короткоживущий, и кэшировать его на
  // всё время жизни процесса — значит умереть через час.
  const store = {
    get demo() { return demoNow && !bridgeReady(); },
    read: async (key) => (await getStore()).read(key),
    write: async (...args) => (await getStore()).write(...args),
    append: async (...args) => (await getStore()).append(...args),
    updateRange: async (...args) => (await getStore()).updateRange(...args),
    meta: async () => (await getStore()).meta(),
    // Самовосстановление листа: книга владельца живёт с прошлой версии, и
    // нового листа («Экземпляры», 1.20.0) в ней может не быть вовсе.
    ensureSheet: async (...args) => (await getStore()).ensureSheet(...args),
  };
  let cachedStore = null;
  let cachedToken = "";
  const getStore = async () => {
    // Мост первым: если он настроен, книга есть, и демо больше не при чём.
    if (bridgeReady()) {
      if (!cachedStore) {
        cachedStore = bridgeStoreFactory({ url: bridge.url, key: bridge.key });
      }
      return cachedStore;
    }
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
  //
  // Токен спрашивается на каждый поиск, а не берётся при старте: владелец
  // вставляет его в пульте, и «перезапустите с переменной» — шаг, который
  // откладывают. Пустой ответ — это «нечего искать», а не ошибка.
  const notionToken = NOTION_TOKEN || process.env.NOTION_TOKEN || process.env.RELAY_NOTION_TOKEN || "";
  const notionSearch = () => {
    const token = notionToken || process.env.NOTION_TOKEN || process.env.RELAY_NOTION_TOKEN || "";
    if (!token) return Promise.resolve([]);
    return searchDatabases({ token, fetchImpl, query: "" });
  };

  // Токен передаётся явно, а не читается службой из окружения: иначе тесты и
  // вложенные вызовы незаметно ходили бы в настоящий Notion.
  const service = createService({ store, now, log, notionSearch, notionToken });

  const server = createServer(async (request, response) => {
    allowOrigin(response);
    const url = new URL(request.url || "/", "http://localhost");

    if (request.method === "OPTIONS") return send(response, 204, "");

    try {
      // Страница установки моста: адрес, куда вставлять код, и сам код.
      // Отдельный путь, а не файл в web/: кода моста в статике нет, он
      // читается из apps-script/Code.gs — одна копия, не две.
      if (url.pathname === "/api/mount") {
        return send(response, 200, mountPage({
          existing: bridge.url,
          version,
          file: bridgeFile,
          canSave: Boolean(bridgeFile),
        }), {
          "Content-Type": "text/html; charset=utf-8",
        });
      }

      // Сохранение адреса и ключа из браузера: пишем bridge.txt и сразу
      // перечитываем. Владелец вставил два значения — и книга подключена, без
      // перезапуска и без ручного формата файла.
      if (url.pathname === "/api/bridge-config" && request.method === "POST") {
        // readBody уже отдаёт разобранный объект (см. его определение): второй
        // JSON.parse превращал его в "[object Object]" и отвечал «не valid JSON».
        const body = (await readBody(request)) || {};
        const check = normalizeBridgeInput({ url: body.url, key: body.key });
        if (!check.ok) return send(response, 200, { ok: false, why: check.why });
        if (!bridgeFile) {
          return send(response, 200, {
            ok: false,
            why: `Записать файл служба не может. Допишите в bridge.txt строкой ${check.url}=ваш-ключ и перезапустите службу.`,
          });
        }
        try {
          writeBridgeFile(bridgeFile, check);
        } catch (error) {
          return send(response, 200, { ok: false, why: `файл не записался: ${error.message}` });
        }
        bridge = { url: check.url, key: check.key };
        // Хранилище пересобирается на следующем обращении: адрес другой.
        cachedStore = null;
        cachedToken = "";
        try {
          const probe = bridgeStoreFactory({ url: bridge.url, key: bridge.key });
          const meta = await probe.meta();
          const titles = (meta.sheets || []).map((item) => item.properties.title).filter(Boolean);
          if (typeof onBridgeChange === "function") await onBridgeChange({ url: bridge.url });
          return send(response, 200, {
            ok: true,
            why: `Сохранено в ${bridgeFile}. Мост отвечает, в книге листов: ${titles.length}. ` +
              "Обновите пульт — демо-режим снят.",
            url: bridge.url,
            titles,
          });
        } catch (error) {
          // Файл уже записан: адрес мог быть верным, а развёртывание — ещё нет.
          return send(response, 200, {
            ok: false,
            why: `Файл записан, но мост не ответил: ${error.message}. ` +
              "Проверьте, что веб-приложение развёрнуто с доступом «Все».",
            saved: true,
          });
        }
      }

      // Диагностика в одном окне: Notion, книга и то, каким путём служба ходит.
      //
      // Зачем вместе. У владельца одновременно «мост не ответил» и «до Notion
      // не дошли» — это один симптом (нет исходящего HTTPS), а не две поломки.
      // Пока проверки раздельны, лечится то, что виднее, и результата нет.
      if (url.pathname === "/api/net-doctor" && request.method === "GET") {
        const [notion, book] = await Promise.all([
          service.notionNet(),
          bridgeReady()
            ? bridgeReachability({ url: bridge.url })
            : Promise.resolve({ ok: false, why: "мост не настроен: книга не подключена" }),
        ]);
        return send(response, 200, {
          ok: notion.ok && book.ok,
          notion,
          bridge: book,
          proxy: currentProxy(),
          // Вывод, а не ещё одно поле: человеку нужен следующий шаг.
          why: notion.ok && book.ok
            ? "служба видит интернет: и Notion, и адрес книги отвечают"
            : !notion.ok && !book.ok
              ? "наружу не проходит ни один запрос — это сеть или прокси, а не токены. Смотрите «Прокси службы» ниже"
              : notion.ok
                ? "интернет есть, не отвечает только книга — смотрите развёртывание моста и доступ «Все»"
                : "интернет есть, не отвечает только Notion — смотрите его доступность",
        });
      }

      // Прокси из пульта: применить сейчас и запомнить для следующего запуска.
      //
      // Почему это в продукте, а не в инструкции. Настройка прокси в Node —
      // это переменная окружения плюс флаг `--use-env-proxy`, о котором знают
      // немногие. Человек, у которого «в браузере всё работает, а служба не
      // дозванивается», хочет одну строку и одну кнопку.
      if (url.pathname === "/api/proxy" && request.method === "POST") {
        const body = (await readBody(request)) || {};
        const check = normalizeProxy(body.proxy);
        if (!check.ok) return send(response, 200, { ok: false, why: check.why });
        if (!proxyFile) {
          return send(response, 200, {
            ok: false,
            why: `Записать прокси служба не может. Запустите транспорт и укажите "${check.url}" на вопрос о прокси.`,
          });
        }
        try {
          writeProxyFile(proxyFile, check.url);
        } catch (error) {
          return send(response, 200, { ok: false, why: `файл прокси не записался: ${error.message}` });
        }
        // Применяем сразу: переменная окружения процесса — то, что читает
        // `EnvHttpProxyAgent` при следующем запросе.
        process.env.HTTPS_PROXY = check.url;
        process.env.HTTP_PROXY = check.url;
        process.env.https_proxy = check.url;
        process.env.http_proxy = check.url;
        // Не `await bridgeReady() ? …`: приоритет операторов делает `reach`
        // промисом, и ответ уходил с `why: undefined`.
        const reach = bridgeReady()
          ? await bridgeReachability({ url: bridge.url })
          : { ok: false, why: "мост не настроен: книга не подключена" };
        await service.record({
          kind: "ui", level: reach.ok ? "info" : "warn",
          text: `прокси ${check.url}: ${reach.ok ? "книга отвечает" : reach.why}`,
        });
        return send(response, 200, {
          ok: true,
          proxy: currentProxy(),
          bridge: reach,
          // Честно про границу: без флага `--use-env-proxy` применённый на
          // ходу прокси подействует только после перезапуска — и это
          // единственное место, где перезапуск действительно нужен.
          why: reach.ok
            ? `прокси ${check.url} работает: книга отвечает. Запомнил для следующего запуска`
            : `прокси ${check.url} записан, но книга всё ещё не отвечает: ${reach.why}`,
          // Прокси, введённый в уже запущенную службу, — единственная
          // настройка, которой нужен перезапуск: Node читает переменные
          // окружения только с флагом `--use-env-proxy`, а флаг задаётся при
          // старте. Обещать «применилось» без этого — обманывать.
          needsRestart: !process.execArgv.includes("--use-env-proxy") && !/--use-env-proxy/.test(process.env.NODE_OPTIONS || ""),
        });
      }

      // Токен Notion из пульта. Отдельный маршрут, а не «настройка»: ключ и
      // его проверка — одна операция, и человек ждёт ответа сразу («видно
      // баз: 3»), а не после нажатия второй кнопки.
      if (url.pathname === "/api/notion-token" && request.method === "POST") {
        const body = (await readBody(request)) || {};
        return send(response, 200, await service.notionTokenSet({ token: body.token }));
      }

      // Проверка сети до Notion. Отдельно от токена: «нет ответа» и «токен не
      // принят» лечатся в разных местах, и путать их дорого.
      if (url.pathname === "/api/notion-net" && request.method === "GET") {
        return send(response, 200, await service.notionNet());
      }

      // Проверка связи с мостом. Владелец должен узнать «не тот адрес» или
      // «доступ не Все» здесь, а не по пульту с кодами ошибок.
      if (url.pathname === "/api/bridge-probe") {
        if (!bridgeReady()) {
          return send(response, 200, {
            ok: false,
            why: "Мост не настроен: служба в демо-режиме. Пройдите шаги на этой странице.",
          });
        }
        try {
          const probe = bridgeStoreFactory({ url: bridge.url, key: bridge.key });
          const meta = await probe.meta();
          const titles = (meta.sheets || []).map((item) => item.properties.title).filter(Boolean);
          return send(response, 200, {
            ok: true,
            why: `Мост отвечает. В книге листов: ${titles.length}${titles.length ? ` (${titles.join(", ")})` : ""}`,
            titles,
          });
        } catch (error) {
          return send(response, 200, { ok: false, why: `Мост не отвечает: ${error.message}` });
        }
      }

      if (url.pathname === "/api/health") {
        return send(response, 200, {
          ok: true, at: new Date(now()).toISOString(), service: "relay-wotr",
          // Демо — состояние сейчас, а не на старте: после ввода адреса в
          // браузере книга уже есть, и health не должен врать ни «в памяти»,
          // ни пустым идентификатором (при мосте его и нет).
          demo: store.demo,
          spreadsheet: store.demo ? "в памяти" : bridgeReady() ? "книга через мост" : spreadsheetId,
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
      // Отказ хранилища — это не поломка службы. Пульт показывал «служба не
      // отвечает», хотя служба отвечает и честно говорит, что не смогла
      // прочитать книгу; человек шёл перезапускать процесс.
      const network = /не ответил за|не дозвонились|fetch failed|ECONNRESET|ETIMEDOUT|ECONNREFUSED|aborted/i
        .test(String(error.message));
      if (network) {
        return send(response, 504, {
          ok: false,
          network: true,
          why: `книга не ответила: ${error.message}. Служба работает — не отвечает сеть до Google. ` +
            "Нажмите «Проверить сеть» в настройке",
        });
      }
      return send(response, 500, { ok: false, why: error.message });
    }
  });

  return { server, service, store };
}

/** Готовность к запуску в человекочитаемом виде: этим отвечает пульт. */
export async function serverReadiness({ service }) {
  try {
    const data = await service.loadAll();
    // Листы книги — вторая половина готовности: без «Экземпляров» адрес агента
    // некуда записать, а цикл при этом выглядит живым (1.24.0).
    let sheets = null;
    try {
      const meta = await service.sheetTitles();
      sheets = Array.isArray(meta) ? meta : null;
    } catch {
      sheets = null;
    }
    return readiness({ settings: data.settings, slots: data.slots, sheets });
  } catch (error) {
    return { ok: false, problems: [`таблица состояния недоступна: ${error.message}`] };
  }
}

