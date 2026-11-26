// Вход в Google по сервисному аккаунту — без OAuth и без браузера.
//
// Зачем это здесь. Прежний запуск требовал `RELAY_TOKEN`: токен, который
// кто-то получил вручную и который истекает через час. Для владельца это
// означало «каждый час что-то обновлять», а обновлять было нечего: OAuth-цикл
// требует браузера, редиректа и согласия, то есть ровно того, чего мы обещали
// не требовать.
//
// Сервисный аккаунт решает это одним движением: в Google Cloud создаётся
// аккаунт-робот, его адрес (`…iam.gserviceaccount.com`) добавляется в книгу
// как редактор — и всё. Дальше служба сама подписывает JWT своим ключом и
// выменивает его на токен доступа, продлевая его до истечения.
//
// Ключ подписывается локально (`crypto`), поэтому в сети нужен ровно один
// запрос — обмен подписи на токен. Приватный ключ никуда не уходит.

import { createSign } from "node:crypto";
import { readFileSync } from "node:fs";

export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
/** Токен живёт час; обновляем за пять минут до конца, чтобы не ловить 401. */
export const REFRESH_MARGIN_MS = 5 * 60 * 1000;

const b64url = (value) => Buffer.from(value).toString("base64url");

/**
 * Подпись JWT для обмена на токен.
 *
 * `iat`/`exp` считаются в секундах и от переданного времени, а не от системных
 * часов: иначе тест «токен протух» зависел бы от даты запуска.
 *
 * `exp` — не больше часа вперёд: Google отвергает более длинные утверждения.
 */
export function buildAssertion({ clientEmail, privateKey, nowMs = Date.now(), scope = SHEETS_SCOPE, audience = GOOGLE_TOKEN_URL, ttlSeconds = 3600 } = {}) {
  if (!clientEmail) throw new Error("нет client_email в ключе сервисного аккаунта");
  if (!privateKey || !String(privateKey).includes("PRIVATE KEY")) {
    throw new Error("нет приватного ключа сервисного аккаунта (поле private_key)");
  }
  const iat = Math.floor(nowMs / 1000);
  const exp = iat + Math.min(Math.max(Number(ttlSeconds) || 3600, 60), 3600);
  const header = { alg: "RS256", typ: "JWT" };
  const claims = { iss: clientEmail, scope, aud: audience, iat, exp };
  const unsigned = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const signature = signer.sign(privateKey).toString("base64url");
  return { assertion: `${unsigned}.${signature}`, claims };
}

/** Разбор ключа сервисного аккаунта из JSON-файла или строки окружения. */
export function parseServiceAccount(raw) {
  let data = raw;
  if (typeof raw === "string") {
    try {
      data = JSON.parse(raw);
    } catch {
      throw new Error("ключ сервисного аккаунта не разбирается как JSON");
    }
  }
  if (!data || typeof data !== "object") throw new Error("ключ сервисного аккаунта пуст");
  if (data.type && data.type !== "service_account") {
    throw new Error(`это не ключ сервисного аккаунта: type = ${data.type}`);
  }
  const clientEmail = data.client_email || "";
  // В JSON переносы строк экранированы. Часть инструментов экранирует их ещё
  // раз, поэтому принимаем оба вида — иначе ошибка подписи выглядит как
  // «invalid_grant» от Google, а не как испорченный ключ.
  const privateKey = String(data.private_key || "").replace(/\\n/g, "\n");
  if (!clientEmail || !privateKey) {
    throw new Error("в ключе нет client_email или private_key");
  }
  return { clientEmail, privateKey, projectId: data.project_id || "" };
}

/**
 * Ключ из окружения: путь к файлу или сам JSON.
 *
 * Путь — основной способ: вставлять многострочный ключ в переменную окружения
 * на Windows неудобно, и владелец это делать не должен.
 */
export function serviceAccountFromEnv(env = {}) {
  const file = env.RELAY_GOOGLE_SA_FILE || "";
  const inline = env.RELAY_GOOGLE_SA_JSON || "";
  if (file) {
    try {
      return parseServiceAccount(readFileSync(file, "utf8"));
    } catch (error) {
      throw new Error(`ключ сервисного аккаунта не прочитан (${file}): ${error.message}`);
    }
  }
  if (inline) return parseServiceAccount(inline);
  return null;
}

/**
 * Провайдер токена: возвращает действующий токен, обновляя его заранее.
 *
 * Держим обещание, а не токен: две вкладки не должны одновременно увидеть
 * протухший токен и пойти за двумя новыми.
 */
export function createServiceAccountToken({
  credentials, fetchImpl = globalThis.fetch, now = () => Date.now(),
  scope = SHEETS_SCOPE, log = () => {},
} = {}) {
  const account = credentials?.clientEmail ? credentials : parseServiceAccount(credentials);
  let cached = { token: "", until: 0 };
  let pending = null;

  async function fresh() {
    const { assertion, claims } = buildAssertion({
      clientEmail: account.clientEmail, privateKey: account.privateKey, nowMs: now(), scope,
    });
    const response = await fetchImpl(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }).toString(),
    });
    const text = await response.text();
    let body = {};
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      body = {};
    }
    if (!response.ok || !body.access_token) {
      const why = body.error_description || body.error || `Google ответил ${response.status}`;
      throw new Error(`токен сервисного аккаунта не получен: ${why}`);
    }
    // Срок — меньший из двух: что обещал Google и что записано в подписи.
    // Обновление начинается заранее, поэтому «до конца жизни» не значит «до
    // последней секунды»: иначе первый же запрос после протухания получит 401.
    const ttlMs = (Number(body.expires_in) || 3600) * 1000;
    const until = Math.min(now() + ttlMs, claims.exp * 1000);
    cached = { token: body.access_token, until: until - REFRESH_MARGIN_MS };
    log(`токен сервисного аккаунта обновлён, действует до ${new Date(cached.until).toISOString()}`);
    return cached.token;
  }

  const provider = async () => {
    if (cached.token && now() < cached.until) return cached.token;
    // Один обмен на всех: параллельные вызовы ждут тот же запрос.
    if (!pending) pending = fresh().finally(() => { pending = null; });
    return pending;
  };
  provider.cachedUntil = () => cached.until;
  return provider;
}
