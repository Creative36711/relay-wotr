// Прокси службы: разбор адреса и файл `proxy.txt`.
//
// Проверяется то, на чём владелец уже спотыкался: «я же указал прокси» и
// «а служба его не увидела». Node 22 читает HTTPS_PROXY только с флагом,
// поэтому мало записать строку — надо, чтобы она была корректной и попала
// туда, откуда её читает запуск.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  defaultProxyPath,
  normalizeProxy,
  parseProxyFile,
  readProxyConfig,
  writeProxyFile,
} from "../src/proxy-config.mjs";

test("адрес прокси без схемы дополняется http://", () => {
  assert.equal(normalizeProxy("127.0.0.1:8080").url, "http://127.0.0.1:8080");
  assert.equal(normalizeProxy("  proxy.local:3128  ").url, "http://proxy.local:3128");
});

test("адрес со схемой и паролем сохраняется как есть", () => {
  const result = normalizeProxy("http://user:pass@10.0.0.1:8080");
  assert.equal(result.ok, true);
  assert.equal(result.url, "http://user:pass@10.0.0.1:8080");
});

test("порт обязателен: без него Node пошёл бы на 80 и не нашёл прокси", () => {
  const result = normalizeProxy("127.0.0.1");
  assert.equal(result.ok, false);
  assert.match(result.why, /порт/);
});

test("socks назван неподдерживаемым, а не «нет порта»", () => {
  // Иначе человек ищет порт, который в строке есть, и не понимает отказа.
  const result = normalizeProxy("socks5://1.2.3.4:1080");
  assert.equal(result.ok, false);
  assert.match(result.why, /socks/i);
  assert.match(result.why, /не поддерживается/);
});

test("пустая строка — это отказ, а не «прокси по умолчанию»", () => {
  assert.equal(normalizeProxy("").ok, false);
});

test("файл прокси: комментарии и пустые строки не мешают", () => {
  assert.deepEqual(parseProxyFile("# мой прокси\n\n127.0.0.1:8080\n"), { url: "http://127.0.0.1:8080" });
  assert.deepEqual(parseProxyFile(""), { url: "" });
});

test("запись и чтение файла прокси", () => {
  const dir = mkdtempSync(join(tmpdir(), "relay-proxy-"));
  const path = join(dir, "proxy.txt");
  writeProxyFile(path, "http://127.0.0.1:8080");
  assert.equal(readFileSync(path, "utf8"), "http://127.0.0.1:8080\n");
  if (process.platform !== "win32") {
    assert.equal(statSync(path).mode & 0o777, 0o600, "в адресе может быть пароль");
  }
  assert.equal(readProxyConfig(path).url, "http://127.0.0.1:8080");
});

test("прокси лежит рядом с bridge.txt, а не в другом месте", () => {
  assert.match(defaultProxyPath("/tmp/relay/bridge.txt"), /relay[\\/]proxy\.txt$/);
});
