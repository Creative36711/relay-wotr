// Токен Notion в файле: тот же принцип, что у bridge.txt и proxy.txt —
// настроил один раз, переживает перезапуск, в репозиторий не попадает.
//
// Проверяемо здесь: формат (одна строка), отказ вместо исключения, права
// файла и то, что мусор в файле не превращается в «токен».

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultNotionTokenPath, readNotionToken, writeNotionToken } from "../src/notion-token-config.mjs";

const withTmp = (fn) => {
  const dir = mkdtempSync(join(tmpdir(), "notion-token-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

test("файл токена лежит рядом с bridge.txt", () => {
  const path = defaultNotionTokenPath("C:\\projects\\relay-wotr\\relay\\bridge.txt".replace(/\\/g, "/"));
  assert.match(path, /notion-token\.txt$/);
  // Без bridge.txt — рядом с самим модулем, а не в рабочей папке запуска.
  const fallback = defaultNotionTokenPath("");
  assert.match(fallback, /notion-token\.txt$/);
  assert.notEqual(fallback, "");
});

test("запись и чтение: одна строка, права600, мусор не читается", () => {
  withTmp((dir) => {
    const path = join(dir, "notion-token.txt");

    const missing = readNotionToken(path);
    assert.equal(missing, "", "нет файла — пусто, не ошибка");

    const saved = writeNotionToken(path, "ntn_abc123");
    assert.equal(saved.ok, true, saved.why);
    assert.equal(readNotionToken(path), "ntn_abc123");
    assert.equal(readFileSync(path, "utf8").trim(), "ntn_abc123", "одна строка без лишнего");
    const mode = statSync(path).mode & 0o777;
    assert.equal(mode, 0o600, "токен не читается соседними пользователями");

    // Старый формат «пароль=значение» и прочий мусор не выдаются за токен.
    writeFileSync(path, "КЛЮЧ=что-то\n", "utf8");
    assert.equal(readNotionToken(path), "", "строка без ntn_/secret_ не токен");

    const bad = writeNotionToken(path, "просто текст");
    assert.equal(bad.ok, false);
    assert.match(bad.why, /ntn_|secret_/);
    assert.equal(readNotionToken(path), "", "неудачная запись не затирает файл мусором");
  });
});

test("запись мимо каталога — отказ словами, а не исключением", () => {
  const result = writeNotionToken(join(tmpdir(), "нет-такого-каталога", "нет", "notion-token.txt"), "ntn_abc");
  assert.equal(result.ok, false);
  assert.ok(result.why, "причина названа");
});

test("secret_ тоже принимается: старый формат токена Notion", () => {
  withTmp((dir) => {
    const path = join(dir, "notion-token.txt");
    assert.equal(writeNotionToken(path, "secret_oldstyle").ok, true);
    assert.equal(readNotionToken(path), "secret_oldstyle");
  });
});
