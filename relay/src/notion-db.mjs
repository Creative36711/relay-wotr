// Поиск баз в Notion для мастера настройки.
//
// Мастер не спрашивает ID: он ищет базу по названию и показывает, что нашёл.
// Это работает только если транспорт видит то же, что интеграция, поэтому
// поиск намеренно узкий — по названию, с отказом при неоднозначности.
//
// Сеть здесь одна: `/v1/search`. Токен берётся у вызывающего, служба его не
// хранит.

import { setDefaultResultOrder } from "node:dns";
import { lookup } from "node:dns/promises";
import { connect } from "node:net";
import { connect as tlsConnect } from "node:tls";

const API = "https://api.notion.com/v1";
const VERSION = "2022-06-28";
const NOTION_HOST = "api.notion.com";

/**
 * IPv4 вперёд при разрешении имён.
 *
 * Владелец сидит за VPN, который отдаёт IPv6-адрес Notion, но не пропускает
 * трафик по нему. Браузер это переживает (Happy Eyeballs), Node — не всегда:
 * запрос уходит в мёртвое семейство и умирает по `UND_ERR_CONNECT_TIMEOUT`.
 * Поэтому порядок адресов фиксируем здесь, один раз, а не просим человека
 * помнить про `NODE_OPTIONS`.
 *
 * `dns.setDefaultResultOrder` влияет на весь процесс, и это осознанно: та же
 * проблема ждёт любой внешний запрос службы, а не только Notion.
 */
try {
  setDefaultResultOrder("ipv4first");
} catch {
  // Старая версия Node: остаётся поведение по умолчанию, и диагностика
  // назовёт причину словами.
}

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

/**
 * Через какой прокси идёт служба — своими словами.
 *
 * `(не задан)` здесь важнее адреса: пока человек думает, что прокси «уже
 * настроен» (он задал его в Firefox или в Windows), а Node о нём не знает,
 * любой текст про сеть читается как «сломано». Одна строка снимает этот спор.
 *
 * Пустое окружение ещё не значит «напрямую»: без флага `--use-env-proxy`
 * Node 22 переменные просто игнорирует, поэтому отдельно говорим и про это.
 */
export function currentProxy(env = process.env) {
  const value = env.HTTPS_PROXY || env.https_proxy || env.HTTP_PROXY || env.http_proxy || "";
  const flag = (process.execArgv || []).includes("--use-env-proxy")
    || /--use-env-proxy/.test(env.NODE_OPTIONS || "");
  if (!value) {
    return { url: "", used: false, text: "(не задан) — служба ходит напрямую, без прокси" };
  }
  if (!flag) {
    return {
      url: value,
      used: false,
      text: `задан (${value}), но не применяется: Node читает прокси только с флагом --use-env-proxy`,
    };
  }
  return { url: value, used: true, text: value };
}

/**
 * Запрос по конкретному адресу, но с именем в TLS (SNI) и с Host Notion.
 *
 * Нужен, чтобы отличить две разные блокировки:
 *   • режут по имени — соединение к IP проходит, а запрос с `Host:
 *     api.notion.com` умирает или подменяется;
 *   • режут по адресу — не проходит даже TCP.
 *
 * Обычный `fetch` этого не покажет: он всегда идёт «по имени». Здесь мы
 * соединяемся с найденным адресом, а имя передаём в TLS — как это делает
 * браузер, когда имя и адрес уже известны.
 */
async function fetchToAddress({ address, host = NOTION_HOST, path = "/v1/users/me", timeoutMs = 8000 } = {}) {
  const started = Date.now();
  return new Promise((resolve) => {
    const socket = connect({ host: address, port: 443, timeout: timeoutMs });
    let settled = false;
    const done = (result) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({ ...result, address, ms: Date.now() - started });
    };
    socket.once("timeout", () => done({ ok: false, code: "TIMEOUT" }));
    socket.once("error", (error) => done({ ok: false, code: error.code || "ERROR" }));
    socket.once("connect", () => {
      const tls = tlsConnect({ socket, servername: host, timeout: timeoutMs });
      // `close` наступает раньше `error`, и без явной проверки «молчаливое
      // закрытие» выдавало себя за пустой ответ вместо причины.
      tls.once("timeout", () => done({ ok: false, code: "TLS-TIMEOUT" }));
      tls.once("close", (hadError) => done({ ok: false, code: hadError ? "СБРОС TLS" : "ЗАКРЫТО" }));
      tls.once("error", (error) => done({ ok: false, code: error.code || "TLS-ERROR" }));
      tls.once("secureConnect", () => {
        // Минимальный HTTP/1.1: нужен только код ответа.
        tls.write(
          `GET ${path} HTTP/1.1\r\nHost: ${host}\r\nNotion-Version: ${VERSION}\r\n` +
          "Connection: close\r\nUser-Agent: relay-wotr\r\n\r\n",
        );
      });
      let text = "";
      tls.on("data", (chunk) => {
        text += chunk.toString("latin1");
        const line = text.split("\r\n")[0];
        if (/^HTTP\/1\.[01] \d{3}/.test(line)) {
          done({ ok: true, code: line.split(" ")[1] || "", status: Number(line.split(" ")[1]) || 0 });
        }
      });
      // Ошибка TLS (сертификат, сброс рукопожатия) ловится обработчиком выше:
      // второй на то же событие давал гонку и «ПУСТО» успевало раньше кода.
    });
  });
}

/**
 * Диагностика «до Notion не дошли»: проверяем каждое звено отдельно.
 *
 * Зачем так подробно. Владелец видел `UND_ERR_CONNECT_TIMEOUT` при живом
 * VPN — и это не «медленная сеть», а конкретный обрыв на конкретном шаге.
 * Одна фраза «проверьте сеть» на четыре разные поломки не помогает; код
 * Node при этом прячет причину в `error.cause`, а браузер — нет.
 *
 * Проверяем то, что видит **служба**, а не браузер: у Node своё разрешение
 * имён и свои сокеты, поэтому настройки Firefox (включая выключенный WebRTC —
 * он про UDP и браузерные соединения) на него не действуют. Одинаковый запрос
 * в браузере и в службе идёт разными путями, и это первое, что нужно
 * показать.
 */
/** Локальный или служебный адрес: значит, имя подменили. */
export function isPrivateAddress(address = "") {
  const value = String(address);
  if (value.includes(":")) {
    // IPv6: ::1, fe80::/10, fc00::/7
    return /^::1$/.test(value) || /^fe[89ab]/i.test(value) || /^f[cd]/i.test(value);
  }
  const parts = value.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) return false;
  const [a, b] = parts;
  return a === 10 || a === 127 || a === 0
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 169 && b === 254)
    || (a === 100 && b >= 64 && b <= 127);
}

export async function pingNotion({ fetchImpl = globalThis.fetch, timeoutMs = 15000, probeMs = 5000 } = {}) {
  const addresses = [];
  const probes = [];
  try {
    const found = await lookup(NOTION_HOST, { all: true });
    for (const item of found) addresses.push({ address: item.address, family: item.family });
  } catch (error) {
    return {
      ok: false,
      code: error.code || "DNS",
      addresses,
      probes,
      why: `имя ${NOTION_HOST} не разрешилось (${error.code || error.message}): это DNS или VPN. Токен тут не при чём`,
    };
  }

  // Подмена DNS: VPN или фильтр отдаёт «свой» адрес, и запрос уходит не в
  // Notion. В браузере это может не проявиться (у Firefox свой DoH и своя
  // таблица), а служба идёт по системному DNS — и молча стучится не туда.
  const suspicious = addresses.filter((item) => isPrivateAddress(item.address));
  if (suspicious.length) {
    return {
      ok: false,
      code: "DNS-HIJACK",
      proxy: currentProxy(),
      addresses,
      probes,
      why: `системный DNS отдал для ${NOTION_HOST} локальные адреса ` +
        `(${suspicious.map((item) => item.address).join(", ")}). Так делает VPN, роутер или фильтр. ` +
        "В Firefox может работать: там свой DNS-over-HTTPS. Это про сеть, а не про токен",
    };
  }

  for (const family of [4, 6]) {
    const target = addresses.find((item) => item.family === family);
    if (!target) continue;
    const started = Date.now();
    const result = await new Promise((resolve) => {
      const socket = connect({ host: target.address, port: 443, timeout: probeMs });
      socket.once("connect", () => { socket.destroy(); resolve({ ok: true }); });
      socket.once("timeout", () => { socket.destroy(); resolve({ ok: false, code: "TIMEOUT" }); });
      socket.once("error", (error) => resolve({ ok: false, code: error.code || "ERROR" }));
    });
    probes.push({ family, address: target.address, ms: Date.now() - started, ...result });
  }

  // Код ниже объясняет отказ. Он не должен противоречить собственному зонду:
  // IPv6 может не работать, пока итоговый запрос проходит по IPv4 — тогда
  // ищем настоящую причину, а не валим всё на семейство адресов.
  // Проба «по адресу, но с именем Notion»: 401 — это успех, сервер ответил.
  // Отличает блокировку по имени от мёртвого маршрута.
  const byAddress = [];
  for (const item of probes.filter((probe) => probe.ok).slice(0, 4)) {
    byAddress.push(await fetchToAddress({ address: item.address, timeoutMs: Math.min(probeMs * 2, 10000) }));
  }
  const answered = byAddress.filter((item) => item.ok);

  const reachable = probes.filter((item) => item.ok);
  const started = Date.now();
  try {
    const response = await fetchImpl(`${API}/users/me`, {
      method: "GET",
      headers: { "Notion-Version": VERSION },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const ms = Date.now() - started;
    // 401 без токена — это ровно то, что нужно: сервер ответил.
    return {
      ok: true,
      ms,
      status: response.status,
      addresses,
      probes,
      byAddress,
      proxy: currentProxy(),
      why: `Notion отвечает за ${ms} мс (HTTP ${response.status} без токена — так и должно быть). ` +
        "Сеть в порядке, дело не в ней",
    };
  } catch (error) {
    const ms = Date.now() - started;
    const code = error?.cause?.code || error?.code || "";
    const ipv6 = probes.find((item) => item.family === 6);
    const ipv4 = probes.find((item) => item.family === 4);

    // Отдельный случай: IPv6 в системе есть, но наружу не ходит, и итоговый
    // запрос из-за этого умер. Браузер в такой сети выживает на IPv4, служба
    // может упереться в IPv6 — это частая причина «в браузере работает, в
    // службе нет».
    if (!reachable.length && ipv6 && !ipv6.ok && ipv4 && ipv4.ok) {
      return {
        ok: false,
        code: code || "IPv6",
        addresses,
        probes,
        proxy: currentProxy(),
        why: `IPv6 до Notion не доходит (${ipv6.code}), а IPv4 доходит (${ipv4.ms} мс). ` +
          "Служба пробует IPv6 первым и ждёт впустую; браузер в такой сети сам переходит на IPv4. " +
          "Это про сеть/VPN, а не про токен. Попробуйте выключить IPv6 в VPN или запустить службу с " +
          "NODE_OPTIONS=--dns-result-order=ipv4first",
      };
    }
    if (!reachable.length) {
      const codes = probes.map((item) => `IPv${item.family}: ${item.code || "нет ответа"}`).join(", ");
      return {
        ok: false,
        code: code || "сеть",
        addresses,
        probes,
        byAddress,
        proxy: currentProxy(),
        why: `до ${NOTION_HOST} не дозвонились вообще (${codes}): это сеть, VPN или фильтр, ` +
          "а не токен. В браузере тот же адрес может работать: у Firefox свой прокси и своё переключение IPv4/IPv6",
      };
    }
    // Соединение есть, а запрос по имени — нет. Если при этом по адресу Notion
    // отвечает, значит режут имя: VPN, антивирус или фильтр по домену.
    if (answered.length) {
      return {
        ok: false,
        code: code || "FILTER",
        addresses,
        probes,
        byAddress,
        proxy: currentProxy(),
        why: `имя ${NOTION_HOST} режется, а сам сервер доступен: по адресу ` +
          `${answered[0].address} Notion ответил (HTTP ${answered[0].status}). ` +
          "Это фильтр по домену — VPN, антивирус или «умный» DNS. Токен тут не при чём",
      };
    }
    return {
      ok: false,
      code: code || "сеть",
      addresses,
      probes,
      byAddress,
      proxy: currentProxy(),
      why: `соединение с ${NOTION_HOST} есть (${probes.filter((item) => item.ok).map((item) => `IPv${item.family} ${item.ms} мс`).join(", ")}), ` +
        `но запрос не прошёл${code ? ` (${code})` : ""}. ` +
        "Всё остальное наружу уходит (книга отвечает), значит режут именно Notion: " +
        "правило в VPN-клиенте, антивирус или фильтр по домену. Токен и ключи тут не при чём",
    };
  }
}

/**
 * Разобрать ответ, который Notion не писал.
 *
 * История, из-за которой это появилось. Владелец вставил рабочий токен и
 * получил «Unexpected token '<'»: вместо данных пришла HTML-страница. Токен
 * тут не при чём — но по такому сообщению это не видно, и человек идёт
 * перевыпускать ключ. Теперь мы называем, кто ответил:
 *
 *   • заголовок `server` (например, `cloudflare`, `nginx`) — подменяет
 *     посредник между вами и Notion;
 *   • `x-served-by`/`via` — явно прокси или VPN-клиент;
 *   • страница входа или капча — фильтр с авторизацией;
 *   • адрес в ответе после редиректа — куда именно вас увели.
 *
 * Возвращает `null`, если ответ похож на настоящий JSON.
 */
export function describeNonJson({ status = 0, url = "", headers = {}, text = "" } = {}) {
  const body = String(text || "");
  // Настоящий JSON начинается с `{` или `[`; всё остальное — чужая страница.
  if (/^\s*[{[]/.test(body)) return null;
  const head = body.slice(0, 400).toLowerCase();
  const server = String(headers?.server || "").trim();
  const via = String(headers?.["x-served-by"] || headers?.via || "").trim();
  const kind = /captcha|cf-challenge|checking your browser|access denied|forbidden|заблокирован/i.test(head)
    ? "страница фильтра или капча"
    : /sign in|log in|login|войти|войдите/i.test(head)
      ? "страница входа"
      : "не JSON: страницу подставил посредник";
  const who = [
    server ? `сервер: ${server}` : "",
    via ? `через: ${via}` : "",
    url ? `адрес ответа: ${url}` : "",
  ].filter(Boolean).join(", ");
  return {
    kind,
    server,
    via,
    status,
    url,
    // HTML в тексте ошибки не нужен: он занимает экран и не помогает.
    snippet: body.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 160),
    why: `${kind}${who ? ` (${who})` : ""}` +
      ". Запрос дошёл, но ответил не Notion: так делает VPN-клиент, антивирус или фильтр по домену. " +
      "Токен тут не при чём",
  };
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
    const substituted = describeNonJson({
      status: response.status,
      url: response.url || "",
      headers: Object.fromEntries((response.headers?.entries?.() || [])),
      text,
    });
    if (substituted) throw new Error(`Notion вернул не данные: ${substituted.why}`);
    const data = text ? JSON.parse(text) : {};
    if (!response.ok) {
      throw new Error(data?.message || `Notion ответил ${response.status}`);
    }
    // Редирект на чужой адрес — тоже подмена: настоящий Notion не уводит
    // `/v1/search` на страницу входа.
    if (response.url && !String(response.url).includes("api.notion.com")) {
      throw new Error(
        `Notion ответил, но запрос ушёл на ${response.url}: так делает VPN-клиент или фильтр. Токен тут не при чём`,
      );
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
