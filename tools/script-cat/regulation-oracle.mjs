// Краткий регламент проекта — ВХОД СБОРКИ (D-003), а не содержимое репозитория:
// сборка получает путь к файлу параметром `--digest`, без параметра бандл
// нейтральный (пустой блок регламента). В git не попадает ни байта проектного
// регламента; версия регламента сверяется на входе — по собственной шапке
// переданного файла и по contracts/build-manifest.json этой же сборки.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

// Ровно одна строка: поле regulationDigest в блоке конфига (внезависимости — в
// 01-config.js). Сборка заменяет её строковым литералом.
export const DIGEST_PLACEHOLDER = '"@@REGULATION_DIGEST@@"';
// Лимит прежний: пустая строка — тоже валидное заполнение.
export const DIGEST_MAX_CHARS = 9000;
export const DIGEST_META_MARKER = '<!-- build:meta -->';

/**
 * Промпт-регламент: markdown без build:meta и служебных комментариев
 * (HTML-комментарии не сжимаются).
 */
export function promptDigest(text) {
  const stripped = String(text || '')
    .split(/\r?\n/)
    .filter((line) => !line.includes(DIGEST_META_MARKER) && !line.trim().startsWith('<!--'))
    .join('\n');
  return stripped.replace(/\n{3,}/g, '\n\n').trim();
}

/** Нормализованный регламент: обрезанные пробелы, пустые строки схлопнуты. */
export function normalizeDigest(text) {
  const cleaned = promptDigest(text);
  assert.ok(cleaned.length <= DIGEST_MAX_CHARS,
    `regulation digest is ${cleaned.length} chars; the limit is ${DIGEST_MAX_CHARS}`);
  return cleaned;
}

/**
 * Версия регламента — из СОБСТВЕННОЙ ШАПКИ файла («Версия N.N»): раньше
 * версия сверялась по соседнему файлу регламента, которого в транспорте
 * больше нет. Без строки версии возвращается null — вызывающий обязан
 * показать это как «проверка неприменима», а не как pass.
 */
export function digestVersion(text) {
  const head = String(text || '').slice(0, 500);
  const hit = head.match(/Версия\s+([\d.]+)/);
  return hit ? hit[1] : null;
}

/**
 * D-003: сверка входа с build-manifest, записанным той же сборкой.
 *
 * Возвращает версию digest'а при сверке, и `null` — когда manifest несёт
 * `digest: null` (нейтральный бандл): проверка в этом случае НЕПРИМЕНИМА.
 * Молча вернуть pass нельзя — вызывающий показывает null явно.
 */
export function assertDigestAgainstManifest(digest, manifest) {
  if (!manifest || !manifest.digest) return null;
  assert.ok(digest, 'build-manifest несёт digest, но проверке не передан digest');
  const short = digestVersion(digest);
  assert.ok(short, 'во входном digest нет шапки «Версия N.N» — версия не сверяема');
  assert.equal(short, manifest.digest.version,
    `digest на входе (Версия ${short}) не совпадает с build-manifest (${manifest.digest.version})`);
  const sha = createHash('sha256').update(String(digest)).digest('hex');
  assert.equal(sha, manifest.digest.sha256,
    'sha256 входного digest не совпадает с build-manifest: файл менялся после сборки');
  return short;
}

/**
 * Подставляет регламент в placeholder ровно один раз. Пустой вход — валидное
 * заполнение (нейтральный бандл): поле regulationDigest остаётся в блоке
 * конфига, но несёт пустую строку.
 */
export function inlineDigest(source, markdown) {
  const count = source.split(DIGEST_PLACEHOLDER).length - 1;
  assert.equal(count, 1, `build expects exactly one ${DIGEST_PLACEHOLDER} (found ${count})`);
  const filled = String(markdown || '').trim() === '' ? '' : normalizeDigest(markdown);
  return source.replace(DIGEST_PLACEHOLDER, JSON.stringify(filled));
}

/** Поле regulationDigest в собранном userscript: строка, даже если это "". */
export function readEmbeddedDigest(built) {
  const m = String(built || '').match(/regulationDigest:\s*("(?:[^"\\]|\\.)*")/);
  assert.ok(m, 'в бандле нет поля regulationDigest');
  return JSON.parse(m[1]);
}
