// Токен Notion для службы: файл `notion-token.txt` рядом с `bridge.txt`.
//
// Зачем. Токен принимается в пульте и до сих пор жил только в памяти
// процесса: каждый перезапуск службы означал повторный ввод, а вводят его
// не каждый день — человек забывает, где брал, и перевыпускает рабочий ключ.
// Хранить токен в книге не хотим (её читает мост и лист виден в браузере),
// а переменная окружения — шаг, который откладывают. Локальный файл рядом
// с bridge.txt: тот же принцип «настроил один раз», те же права 0600,
// в репозиторий не попадает (.gitignore).
//
// Формат — одна строка: сам токен (`ntn_…` или `secret_…`). Никаких пар
// `ключ=значение`: парсить нечего, лишняя возможность ошибиться.

import { readFileSync, writeFileSync, renameSync, existsSync, chmodSync } from "node:fs";
import { dirname, join } from "node:path";

const clean = (value) => String(value ?? "").trim();
const looksLikeToken = (value) => /^(ntn_|secret_)/.test(value);

/** Где лежит файл: рядом со `bridge.txt`, чтобы все секреты установки были в одном месте. */
export function defaultNotionTokenPath(bridgeFile = "") {
  const base = bridgeFile
    ? dirname(bridgeFile)
    : join(dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
  return join(base, "notion-token.txt");
}

/** Прочитать токен из файла. Пусто, если файла нет, он не читается или строка не похожа на токен. */
export function readNotionToken(path = "") {
  const target = clean(path);
  if (!target || !existsSync(target)) return "";
  try {
    const token = clean(readFileSync(target, "utf8"));
    return looksLikeToken(token) ? token : "";
  } catch {
    return "";
  }
}

/** Записать токен атомарно, с правами 0600. Отказ — словами, а не исключением наверх. */
export function writeNotionToken(path = "", token = "") {
  const target = clean(path);
  const value = clean(token);
  if (!target) return { ok: false, why: "нет пути для notion-token.txt" };
  if (!looksLikeToken(value)) {
    return { ok: false, why: "не похоже на токен Notion: нужен ntn_ или secret_" };
  }
  try {
    const tmp = `${target}.tmp`;
    writeFileSync(tmp, `${value}\n`, { encoding: "utf8", mode: 0o600 });
    renameSync(tmp, target);
    try {
      chmodSync(target, 0o600);
    } catch {
      // Windows: chmod ограничен. Файл всё равно не в репозитории.
    }
    return { ok: true, path: target };
  } catch (error) {
    return { ok: false, why: error.message };
  }
}
