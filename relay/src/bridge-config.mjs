// Хранение адреса и ключа моста: файл `bridge.txt` рядом со службой.
//
// Зачем файл, а не память процесса. Мост нужен при холодном старте — раньше,
// чем кто-либо откроет пульт. Если держать значения только в памяти, каждая
// перезагрузка возвращала бы «не настроено», и человек снова искал бы адрес в
// Google. Файл — это то, что переживает перезапуск без базы данных.
//
// Формат. Две формы, обе человеческие:
//
//   https://script.google.com/macros/s/…/exec=ключ     (одна строка, разделитель `=`)
//   адрес                                             (две строки, в любом порядке)
//   ключ
//
// `=` выбран разделителем, потому что в адресе Apps Script его нет, а в ключе
// мы его запрещаем (см. тест требований к ключу). Пробелы и переводы строк по
// краям срезаются: вставка из буфера почти всегда тащит их с собой.

import { readFileSync, writeFileSync, renameSync, existsSync, chmodSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/** Путь по умолчанию: рядом с папкой relay (`relay/bridge.txt`). */
export function defaultBridgePath(moduleUrl = import.meta.url) {
  const here = dirname(new URL(moduleUrl).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
  return join(resolve(here, ".."), "bridge.txt");
}

const clean = (value) => String(value ?? "").trim();

/**
 * Разбор текста файла.
 *
 * Возвращает `{ url, key }`; чего нет — пустая строка. Не бросает: битый файл
 * не должен мешать службе подняться — он должен быть виден как «не настроено»
 * с причиной, а не как падение на старте.
 */
export function parseBridgeFile(text = "") {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) return { url: "", key: "" };

  const first = lines[0];
  const eq = first.indexOf("=");
  if (eq > 0) {
    return { url: clean(first.slice(0, eq)), key: clean(first.slice(eq + 1)) };
  }

  // Две строки в любом порядке: адрес узнаём по началу, остальное — ключ.
  const isUrl = (value) => /^https?:\/\//i.test(value);
  const url = lines.find(isUrl) || "";
  const key = lines.find((line) => !isUrl(line)) || "";
  return { url: clean(url), key: clean(key) };
}

/** Разбор для записи: то же самое, плюс проверка формы. */
export function normalizeBridgeInput({ url = "", key = "" } = {}) {
  const cleanUrl = clean(url).replace(/\/+$/, "");
  const cleanKey = clean(key);
  if (!cleanUrl) return { ok: false, why: "address", url: "", key: "" };
  if (!/^https?:\/\/[^\s]+$/i.test(cleanUrl)) {
    return { ok: false, why: "Адрес должен начинаться с https:// и не содержать пробелов.", url: "", key: "" };
  }
  // Хвост `/exec/` — обычная копия из браузера. Apps Script принимает оба.
  if (!/\/exec$/i.test(cleanUrl)) {
    return {
      ok: false,
      why: "Адрес должен оканчиваться на /exec — это адрес веб-приложения, а не идентификатор развёртывания.",
      url: "",
      key: "",
    };
  }
  if (cleanKey.length < 20) {
    return { ok: false, why: "Ключ короче 20 символов: похоже, вставилась только часть.", url: "", key: "" };
  }
  // Эти символы ломают разбор файла и командную строку Windows. Лучше сказать
  // об этом сейчас, чем оставить человека искать причину в мосте.
  if (/[=&%\s]/.test(cleanKey)) {
    return { ok: false, why: "В ключе не должно быть символов = & % и пробелов.", url: "", key: "" };
  }
  return { ok: true, url: cleanUrl, key: cleanKey };
}

/**
 * Запись файла.
 *
 * Пишем во временный файл и переименовываем: оборванная запись не должна
 * оставить полуфайл, из которого потом «не читается ключ». Права 0600 —
 * ключ моста даёт доступ к книге, читать его чужим процессам незачем.
 */
export function writeBridgeFile(path, { url, key }) {
  const body = `${url}=${key}\n`;
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, body, { encoding: "utf8", mode: 0o600 });
  renameSync(tmp, path);
  try {
    chmodSync(path, 0o600);
  } catch {
    // Windows: chmod ограничен. Ключ всё равно не в репозитории (см. .gitignore).
  }
  return { ok: true, path, body };
}

/** Чтение при старте: путь из окружения или по умолчанию. */
export function readBridgeConfig(path) {
  const target = path || "";
  if (!target || !existsSync(target)) return { url: "", key: "", path: target };
  try {
    const parsed = parseBridgeFile(readFileSync(target, "utf8"));
    return { ...parsed, path: target };
  } catch {
    return { url: "", key: "", path: target };
  }
}
