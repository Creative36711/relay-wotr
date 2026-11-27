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
import { currentProxy, deepDiagnose } from "./notion-db.mjs";
import { createService } from "./service.mjs";
import { readiness } from "./setup.mjs";
import { searchDatabases, createNotionFetch } from "./notion-db.mjs";
import { createDemoStore } from "./demo-store.mjs";
import { createProjectConfigStore } from "./project-config.mjs";

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

function privateProjectRequest(request, { allowArena = false } = {}) {
  const origin = String(request.headers.origin || "");
  const host = String(request.headers.host || "");
  const remote = String(request.socket.remoteAddress || "");
  const loopback = remote === "127.0.0.1" || remote === "::1" || remote === "::ffff:127.0.0.1";
  if (!origin) return loopback;
  try {
    const parsed = new URL(origin);
    const localUi = host && parsed.host === host && ["http:", "https:"].includes(parsed.protocol);
    const arena = allowArena && ["https://arena.ai", "https://www.arena.ai"].includes(parsed.origin);
    return Boolean(localUi || arena);
  } catch { return false; }
}

function privateCorsHeaders(request) {
  const origin = String(request.headers.origin || "");
  return origin ? {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "content-type, authorization",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    Vary: "Origin",
  } : { "Access-Control-Allow-Origin": "null" };
}

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
  // Чем читать книгу, когда настроен мост. Отдельно от storeFactory: мост
  // может появиться на ходу (адрес ввели в браузере), а storeFactory уже
  // выбран при старте — под Google-токен или под что-то ещё.
  bridgeStoreFactory = ({ url, key, timeoutMs = 45000 }) => createAppsScriptStore({ url, key, fetchImpl, timeoutMs }),
  onBridgeChange = null,
  // Куда положить принятый из пульта токен Notion (пусто — только память).
  saveNotionToken = null,
  projectConfigFile = "",
  projectConfigStore: suppliedProjectConfigStore = null,
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
  // Первый запрос к Settings ещё не знает значения из книги; используем тот
  // же безопасный дефолт 45 с, затем loadSettings применит net.gmTimeoutMs.
  let bridgeTimeoutMs = 45000;
  const bridgeReady = () => Boolean(bridge.url);
  // Рабочие запросы к Notion — через мост, когда он настроен: прямой путь с
  // машины владельца может резаться VPN или фильтром по домену, а мост живёт
  // в Google. `bridge` читается на каждый запрос — адрес меняется на ходу,
  // когда владелец вставляет его в пульте. Проверка сети и диагностика
  // этим fetch не пользуются: им нужен именно прямой путь.
  const notionDataFetch = createNotionFetch({ bridge: () => bridge, fetchImpl, log });
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
    setTimeoutMs: (value) => {
      const numeric = Number(value);
      bridgeTimeoutMs = Number.isFinite(numeric) ? Math.min(180000, Math.max(5000, Math.floor(numeric))) : 45000;
      cachedStore?.setTimeoutMs?.(bridgeTimeoutMs);
      return bridgeTimeoutMs;
    },
  };
  let cachedStore = null;
  let cachedToken = "";
  const getStore = async () => {
    // Мост первым: если он настроен, книга есть, и демо больше не при чём.
    if (bridgeReady()) {
      if (!cachedStore) {
        cachedStore = bridgeStoreFactory({ url: bridge.url, key: bridge.key, timeoutMs: bridgeTimeoutMs });
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
  // Токен передаётся вызывающим: токен, введённый в пульте, живёт в памяти
  // службы, а не в окружении этого процесса — замыкание без параметра искало
  // бы только по env и молча возвращало пустоту («база не видна» при
  // принятом токене). Память старше окружения, окружение — запасной путь.
  const notionSearch = (options = {}) => {
    const token = options.token || notionToken || process.env.NOTION_TOKEN || process.env.RELAY_NOTION_TOKEN || "";
    if (!token) return Promise.resolve([]);
    return searchDatabases({ token, fetchImpl: notionDataFetch, query: options.query || "" });
  };

  // Токен передаётся явно, а не читается службой из окружения: иначе тесты и
  // вложенные вызовы незаметно ходили бы в настоящий Notion.
  const service = createService({ store, now, log, notionSearch, notionToken, notionDataFetch, saveNotionToken });
  const projectConfigStore = suppliedProjectConfigStore || createProjectConfigStore({ file: projectConfigFile });

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

      // Диагностика по звеньям: DNS → TCP → TLS → ответ → токен. Печатает
      // отпечаток сертификата и сырой ответ, поэтому «сеть или токен» решается
      // без догадок и без переписки.
      if (url.pathname === "/api/net-deep" && request.method === "GET") {
        const token = NOTION_TOKEN || process.env.NOTION_TOKEN || process.env.RELAY_NOTION_TOKEN
          || service?.memory?.notionToken || "";
        return send(response, 200, await deepDiagnose({
          token,
          fetchImpl,
          book: bridgeReady() ? { url: bridge.url } : null,
          proxy: currentProxy(),
        }));
      }

      // Роли в книгу: после этого Notion для работы не нужен.
      if (url.pathname === "/api/roles-to-book" && request.method === "POST") {
        return send(response, 200, await service.rolesToBook());
      }

      // Замер книги: цифры вместо «медленно».
      if (url.pathname === "/api/book-speed" && request.method === "GET") {
        return send(response, 200, await service.measureBook());
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
        if (!privateProjectRequest(request, { allowArena: true }))
          return send(response, 403, { ok: false, why: "Протокол ScriptCat разрешён только локальному Relay и вкладкам Arena." });
        const body = await readBody(request);
        if (body.action === "pull" && body.projectId) {
          const activeProjectId = await projectConfigStore.activeProjectId();
          if (activeProjectId && String(body.projectId).toLowerCase() !== String(activeProjectId).toLowerCase()) {
            body.projectApproved = false;
            body.projectBlockReason = "inactive-project";
          }
        }
        // Sync project metadata and move any credentials already saved in the
        // local ScriptCat profile into Relay's local file. This intentionally
        // does not rely on the old settings marker: older versions could set it
        // after an incomplete response. Existing Relay values win; runtime
        // queues are never included.
        if (body.action === "hello" && body.projectProfile && body.projectProfile.id === body.projectId) {
          try {
            const existing = await projectConfigStore.get(body.projectId);
            const localCredentials = body.projectCredentials && typeof body.projectCredentials === "object"
              ? body.projectCredentials : {};
            // Автоматически переносим секреты из уже настроенного профиля
            // ScriptCat в локальный Relay. Заполненное в Relay значение всегда
            // главнее; пустые/невалидные значения не сохраняются.
            const secrets = { ...(existing?.secrets || {}) };
            for (const key of ["notion", "gwUrl", "gwKey", "github", "ntfyToken"]) {
              if (!secrets[key] && typeof localCredentials[key] === "string" && localCredentials[key].trim())
                secrets[key] = localCredentials[key].trim();
            }
            if (!secrets.notion && typeof notionToken === "string" && /^(ntn_|secret_)/.test(notionToken))
              secrets.notion = notionToken;
            if (!existing || Object.entries(secrets).some(([key, value]) => value && !existing.secrets?.[key])) {
              await projectConfigStore.save({ profile: existing?.profile || body.projectProfile, secrets });
            }
          } catch (error) {
            log(`профиль проекта не импортирован из Arena-вкладки: ${error.message}`);
          }
        }
        let projectSettings = null;
        let projectSelection = null;
        let projectSettingsUnavailable = null;
        if (body.action === "hello" && body.projectId) {
          await projectConfigStore.ensureActiveProject(body.projectId);
          const activeProjectId = await projectConfigStore.activeProjectId();
          const entry = activeProjectId ? await projectConfigStore.get(activeProjectId) : null;
          const ready = Boolean(entry?.secrets?.notion && entry?.secrets?.gwUrl && entry?.secrets?.gwKey);
          if (entry && String(body.projectId).toLowerCase() !== String(activeProjectId).toLowerCase() &&
              entry.secrets?.notion && entry.secrets?.gwUrl && entry.secrets?.gwKey) {
            // Relay's selected profile is authoritative. Hold new work on all
            // tabs until each is idle and has switched to the same profile.
            body.projectApproved = false;
            body.projectBlockReason = "inactive-project";
            projectSelection = {
              ok: true, project: entry.profile, credentials: entry.secrets,
              secretsMigrated: true, updatedAt: entry.updatedAt,
            };
          } else if (entry && String(body.projectId).toLowerCase() === String(activeProjectId).toLowerCase()) {
            if (entry.secrets?.notion && entry.secrets?.gwUrl && entry.secrets?.gwKey) {
              projectSettings = {
                ok: true, project: entry.profile, credentials: entry.secrets,
                secretsMigrated: true, updatedAt: entry.updatedAt,
              };
              if (String(body.projectConfigUpdatedAt || "") !== String(entry.updatedAt || "")) {
                body.projectApproved = false;
                body.projectBlockReason = "unapproved";
                body.projectApprovalFailure = "";
              }
            } else {
              body.projectApproved = false;
              body.projectBlockReason = "credentials-missing";
              body.projectApprovalFailure = "";
              projectSettingsUnavailable = { projectId: entry.profile.id, updatedAt: entry.updatedAt || "" };
            }
          }
        }
        const result = await service.handle(body);
        if (body.action === "pull" && result?.work) {
          await service.record({
            slot: body.slotId || "", tab: body.tab || "", kind: "dispatch",
            text: `вкладка забрала выдачу ${result.work.runId}`, runId: result.work.runId, card: result.work.card,
          }).catch(() => {});
        }
        // Настройки проекта уезжают во вкладку всегда, в том числе когда она
        // держит ход (`localBusy`). Раньше они откладывались до «свободного»
        // hello — и вкладка, ждущая `expect:plan`, не получала их никогда:
        // шаг упирался в «Relay ещё не синхронизировал credentials», пульт
        // советовал «дожать», «дожать» упирался в тот же гейт. Тумблер
        // «применять настройки только на простое» оставлен в клиенте: он
        // решает, когда менять профиль и перезагружать страницу, а не
        // получать уже сохранённые значения. Переключение профиля
        // (`projectSelection`) по-прежнему ждёт простоя: оно перезагружает
        // страницу и не должно обрывать ход.
        const responseResult = {
          ...result,
          ...(projectSettings ? { projectSettings } : {}),
          ...(projectSelection && !body.localBusy ? { projectSelection } : {}),
          ...(projectSettingsUnavailable && !body.localBusy ? { projectSettingsUnavailable } : {}),
        };
        return send(response, result.ok === false && result.why?.includes("нет в таблице") ? 404 : 200,
          responseResult, projectSettings || projectSelection || projectSettingsUnavailable ? privateCorsHeaders(request) : {});
      }

      if (url.pathname === "/api/snapshot" && request.method === "GET") {
        // version — из этого процесса, а не из книги: владелец обновляет
        // файлы (GitHub Desktop), но службу перезапускает сам, и без цифры
        // в шапке нельзя отличить свежую сборку от бегущей старой.
        const shot = await service.snapshot();
        return send(response, 200, { ...shot, version });
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

      if (url.pathname === "/api/projects" && request.method === "GET") {
        if (!privateProjectRequest(request))
          return send(response, 403, { ok: false, why: "Список проектов доступен только локальному пульту." });
        return send(response, 200, {
          ok: true, profiles: await projectConfigStore.list(),
          activeProjectId: await projectConfigStore.activeProjectId(),
        });
      }

      if (url.pathname === "/api/projects" && request.method === "POST") {
        if (!privateProjectRequest(request))
          return send(response, 403, { ok: false, why: "Настройки проектов можно менять только из локального пульта." });
        const body = await readBody(request);
        try {
          const existing = await projectConfigStore.get(body.profile?.id);
          const secrets = { ...(body.secrets || {}) };
          // A BAT-provided Notion token is already a valid local credential.
          // Seed new profiles from it rather than making the owner paste it a
          // second time; never replace an existing project-specific token.
          if (!secrets.notion && !existing?.secrets?.notion && /^(ntn_|secret_)/.test(String(notionToken || "")))
            secrets.notion = notionToken;
          const profile = await projectConfigStore.save({
            profile: body.profile, secrets, clearSecrets: body.clearSecrets === true,
          });
          return send(response, 200, { ok: true, profile }, privateCorsHeaders(request));
        } catch (error) {
          return send(response, 400, { ok: false, why: error.message }, privateCorsHeaders(request));
        }
      }

      if (url.pathname === "/api/projects/active" && request.method === "POST") {
        if (!privateProjectRequest(request))
          return send(response, 403, { ok: false, why: "Переключить активный проект можно только из локального пульта." });
        const body = await readBody(request);
        try {
          const profile = await projectConfigStore.setActiveProject(body.projectId);
          return send(response, 200, {
            ok: true, activeProjectId: profile.id,
            why: `Активен профиль «${profile.name}». Открытые вкладки переключатся после завершения локальной работы; автоцикл не включается.`,
          }, privateCorsHeaders(request));
        } catch (error) {
          return send(response, 400, { ok: false, why: error.message }, privateCorsHeaders(request));
        }
      }

      if (url.pathname === "/api/project-approval" && request.method === "POST") {
        // This grants project work after local credentials are validated in an
        // Arena tab. Do not expose that capability to arbitrary websites via
        // the server's otherwise permissive CORS policy.
        const origin = String(request.headers.origin || "");
        const host = String(request.headers.host || "");
        let sameOrigin = false;
        try {
          const parsed = new URL(origin);
          sameOrigin = Boolean(origin && host && parsed.host === host && ["http:", "https:"].includes(parsed.protocol));
        } catch { /* rejected below */ }
        const remote = String(request.socket.remoteAddress || "");
        const loopback = remote === "127.0.0.1" || remote === "::1" || remote === "::ffff:127.0.0.1";
        if (origin ? !sameOrigin : !loopback)
          return send(response, 403, { ok: false, why: "Запрос проверки допуска разрешён только с пульта на этом же компьютере." });
        const body = await readBody(request);
        return send(response, 200, await service.requestProjectApproval({ projectId: body.projectId }));
      }

      // Пульт: статика. Отдаётся и при GET / — человек открывает адрес и
      // сразу видит состояние, без отдельной страницы входа.
      if (request.method === "GET" && !url.pathname.startsWith("/api/")) {
        const rel = url.pathname === "/" ? "index.html" : url.pathname.replace(/^\/+/, "");
        const safe = normalize(rel).replace(/^\.\.(\/|\\|$)/, "");
        const file = join(WEB_ROOT, safe);
        try {
          const data = await readFile(file);
          // Пульт — не сборка, а живые файлы: после обновления репозитория
          // человек перезапускает службу и открывает страницу, а браузер без
          // этой строки показывал старый app.js из кэша. Тогда новая кнопка
          // «есть в коде» и «нет на экране» — и это снова выглядит как «ничего
          // не изменилось».
          return send(response, 200, data.toString("utf8"), {
            "Content-Type": MIME[extname(file)] || "application/octet-stream",
            "Cache-Control": "no-store, must-revalidate",
          });
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

