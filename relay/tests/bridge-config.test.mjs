// Адрес и ключ моста: файл, который заполняет браузер, а читает служба.
//
// Проверяем ровно те места, где ошибка стоит владельцу часа:
//
//   1. Разбор. Батник и служба читают один файл; если формы разойдутся,
//      «настроено» превратится в «не настроено» после перезапуска.
//   2. Отказы. Неверный адрес и обрезанный ключ должны называться словами,
//      а не молча писать в файл то, что потом не заработает.
//   3. Запись. Ключ даёт доступ к книге: файл пишется целиком и только для
//      своего пользователя.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  defaultBridgePath,
  normalizeBridgeInput,
  parseBridgeFile,
  readBridgeConfig,
  writeBridgeFile,
} from "../src/bridge-config.mjs";

const URL_OK = "https://script.google.com/macros/s/AKfycbx0000000000/exec";
const KEY_OK = "2eJGAzY7Wz3eokdFHtZnBCFMEiLUNbozsFaFkVWd";

test("одна строка `адрес=ключ` разбирается на две части", () => {
  assert.deepEqual(parseBridgeFile(`${URL_OK}=${KEY_OK}`), { url: URL_OK, key: KEY_OK });
});

test("две строки в любом порядке: адрес узнаётся по https://", () => {
  assert.deepEqual(parseBridgeFile(`${URL_OK}\n${KEY_OK}`), { url: URL_OK, key: KEY_OK });
  assert.deepEqual(parseBridgeFile(`${KEY_OK}\n${URL_OK}`), { url: URL_OK, key: KEY_OK });
});

test("вставка из буфера с пробелами и пустыми строками не ломает разбор", () => {
  assert.deepEqual(parseBridgeFile(`\n  ${URL_OK} = ${KEY_OK}  \n\n`), { url: URL_OK, key: KEY_OK });
});

test("пустой и битый файл — это «не настроено», а не падение", () => {
  assert.deepEqual(parseBridgeFile(""), { url: "", key: "" });
  assert.deepEqual(parseBridgeFile("   \n \n"), { url: "", key: "" });
});

test("адрес обязан оканчиваться на /exec: идентификатор развёртывания не подходит", () => {
  const id = normalizeBridgeInput({ url: "https://script.google.com/macros/s/AKfycbx0000/deve", key: KEY_OK });
  assert.equal(id.ok, false);
  assert.match(id.why, /\/exec/);
});

test("хвостовая косая черта в адресе срезается, а не считается ошибкой", () => {
  const ok = normalizeBridgeInput({ url: `${URL_OK}/`, key: KEY_OK });
  assert.equal(ok.ok, true);
  assert.equal(ok.url, URL_OK);
});

test("обрезанный ключ отклоняется с понятной причиной", () => {
  const short = normalizeBridgeInput({ url: URL_OK, key: "2eJGAzY7Wz3eokd" });
  assert.equal(short.ok, false);
  assert.match(short.why, /короче 20/);
});

test("ключ с = & % и пробелами отклоняется: он сломал бы и файл, и батник", () => {
  // Пробел по краям срезается (вставка из буфера), пробел внутри — отказ.
  for (const bad of [`${KEY_OK}&x`, `${KEY_OK}=1`, "a".repeat(24) + "%", "a".repeat(12) + " " + "b".repeat(12)]) {
    assert.equal(normalizeBridgeInput({ url: URL_OK, key: bad }).ok, false, bad);
  }
});

test("пустой адрес отклоняется", () => {
  assert.equal(normalizeBridgeInput({ url: "", key: KEY_OK }).ok, false);
});

test("запись: файл целиком, права только для владельца, читается обратно", () => {
  const dir = mkdtempSync(join(tmpdir(), "bridge-"));
  const path = join(dir, "bridge.txt");
  writeBridgeFile(path, { url: URL_OK, key: KEY_OK });
  assert.equal(readFileSync(path, "utf8"), `${URL_OK}=${KEY_OK}\n`);
  if (process.platform !== "win32") {
    assert.equal(statSync(path).mode & 0o777, 0o600);
  }
  assert.deepEqual(readBridgeConfig(path), { url: URL_OK, key: KEY_OK, path });
});

test("чтение отсутствующего файла — «не настроено», без исключения", () => {
  const gone = readBridgeConfig(join(tmpdir(), "нет-такого-bridge.txt"));
  assert.equal(gone.url, "");
  assert.equal(gone.key, "");
});

test("путь по умолчанию — рядом со службой, в папке relay", () => {
  assert.match(defaultBridgePath(), /relay[\\/]bridge\.txt$/);
});
