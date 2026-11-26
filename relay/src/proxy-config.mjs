// Прокси для службы: файл `proxy.txt` рядом с `bridge.txt`.
//
// Зачем. Пульт живёт на localhost и открывается всегда, а служба ходит в
// интернет сама — своим стеком, без настроек браузера. Когда выход идёт через
// прокси (VPN-клиент со своим прокси, рабочая сеть, антивирус), Node об этом
// не знает: запрос уходит напрямую и умирает по таймауту. Браузер в той же
// сети работает, и человек ищет причину в токене.
//
// Node 22 читает `HTTPS_PROXY` только с флагом `--use-env-proxy`, поэтому
// «просто задать переменную» не работает. Флаг ставит запуск; этот файл даёт
// возможность указать прокси из пульта, не перезапуская транспорт.

import { readFileSync, writeFileSync, renameSync, existsSync, chmodSync } from "node:fs";
import { dirname, join } from "node:path";

const clean = (value) => String(value ?? "").trim();

/** Приводим адрес к виду `http://host:port`: без схемы, со схемой http. */
export function normalizeProxy(value = "") {
  const raw = clean(value);
  if (!raw) return { ok: false, why: "прокси не указан", url: "" };
  // `127.0.0.1:8080`, `http://127.0.0.1:8080`, `http://user:pass@host:8080`
  // Схему распознаём отдельно: `socks5://host:1080`, подставленный к `http://`,
  // превращается в хост «socks5» и пустой порт, и человек получает «не указан
  // порт» вместо «socks не поддерживается».
  const scheme = (raw.match(/^([a-z][a-z0-9+.-]*):\/\//i) || [])[1];
  if (scheme && !/^https?$/i.test(scheme)) {
    return { ok: false, why: `схема «${scheme}» не поддерживается: нужен http:// или https:// (socks Node не понимает)`, url: "" };
  }
  const withScheme = scheme ? raw : `http://${raw}`;
  let parsed = null;
  try {
    parsed = new URL(withScheme);
  } catch {
    return { ok: false, why: "не похоже на адрес прокси: нужно вида 127.0.0.1:8080", url: "" };
  }
  // Схема проверяется до порта: `socks5://host:1080` иначе получило бы
  // «не указан порт», хотя порт есть, а дело в неподдерживаемой схеме.
  if (!/^https?:$/.test(parsed.protocol)) {
    return { ok: false, why: "прокси должен быть http:// или https:// (socks Node не понимает)", url: "" };
  }
  if (!parsed.hostname) return { ok: false, why: "в адресе прокси нет хоста", url: "" };
  if (!parsed.port) {
    // Порт у http-прокси обязателен: без него Node пойдёт на 80 и не найдёт.
    return { ok: false, why: "не указан порт прокси: нужно вида 127.0.0.1:8080", url: "" };
  }
  return { ok: true, why: "", url: parsed.toString().replace(/\/$/, "") };
}

/** Где лежит файл: рядом со `bridge.txt`, чтобы всё настройки были в одном месте. */
export function defaultProxyPath(bridgeFile = "") {
  const base = bridgeFile ? dirname(bridgeFile) : join(dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
  return join(base, "proxy.txt");
}

export function parseProxyFile(text = "") {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
  if (!lines.length) return { url: "" };
  // Одна строка: либо адрес, либо `адрес=адрес` (человек мог записать пару).
  const first = lines[0];
  const eq = first.indexOf("=");
  const candidate = eq > 4 ? first.slice(eq + 1) : first;
  return { url: normalizeProxy(candidate).url };
}

export function writeProxyFile(path, url) {
  const body = `${url}\n`;
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, body, { encoding: "utf8", mode: 0o600 });
  renameSync(tmp, path);
  try {
    chmodSync(path, 0o600);
  } catch {
    // Windows: chmod ограничен. Пароль прокси всё равно не в репозитории.
  }
  return { ok: true, path, body };
}

export function readProxyConfig(path = "") {
  const target = clean(path);
  if (!target || !existsSync(target)) return { url: "", path: target };
  try {
    return { ...parseProxyFile(readFileSync(target, "utf8")), path: target };
  } catch {
    return { url: "", path: target };
  }
}
