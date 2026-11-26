// Файл запуска для Windows: проверяем его как текст, а не запускаем.
//
// Причина существования пробы — скучная и дорогая. Батник нельзя прогнать в
// CI (Windows-шелл), но можно проверить то, что обычно и ломает запуск по
// двойному клику:
//
//   1. Файл сохранён с CRLF. `cmd` ломается на одиночных \n в конструкциях
//      `for`/`if` — а именно они здесь и есть.
//   2. Кириллица в UTF-8 без BOM. С `chcp 65001` cmd читает файл как UTF-8;
//      без этого строка «Запускаю транспорт» превращалась бы в мусор.
//   3. Ключ ищется сам, а не вписан путём конкретной машины.
//   4. Демо-режим включается только когда ключа действительно нет, и об этом
//      сказано вслух — иначе «пульт открылся, а книга не та» ищется наугад.
//   5. Останов транспорта не закрывает окно: прочитать ошибку важнее.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";

const path = new URL("../Запустить транспорт.bat", import.meta.url);
const bytes = readFileSync(path);
const text = bytes.toString("utf8");

test("батник: переводы строк CRLF — cmd иначе ломается на for/if", () => {
  assert.ok(bytes.includes(0x0d), "в файле нет ни одного \r");
  const loneLf = (text.match(/\n/g) || []).length - (text.match(/\r\n/g) || []).length;
  assert.equal(loneLf, 0, "есть одиночные \n: cmd прочитает такую строку как обрыв команды");
});

test("батник: UTF-8 без BOM и переключение кодовой страницы", () => {
  assert.notDeepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], "BOM перед @echo off — cmd его не переварит");
  assert.match(text, /^@echo off\r?\nchcp 65001/, "первая строка — @echo off, вторая — chcp 65001");
});

test("батник: работает из своей папки, а не из текущей", () => {
  assert.match(text, /cd \/d "%~dp0"/, "переход в папку файла: двойной клик запускает из C:\\Windows");
  assert.doesNotMatch(text, /cd \/d "[A-Za-z]:\\\\/, "путь не вписан под конкретную машину");
});

test("батник: ключ сервисного аккаунта ищется сам", () => {
  for (const candidate of ["..\\sa.json", "sa.json"]) {
    assert.ok(text.includes(candidate), `не ищет ключ рядом: ${candidate}`);
  }
  assert.match(text, /findstr \/m \/c:"client_email"/, "запасной поиск: любой *.json с client_email");
  assert.match(text, /set "RELAY_GOOGLE_SA_FILE=%SA_FILE%"/, "найденный ключ передаётся службе");
});

test("батник: книга задана, демо — только когда нет ни моста, ни ключа", () => {
  assert.match(text, /set "BOOK_ID=1_MohMfnUvl40CT689gfch_MgPtzqokSw5Bylbl89PFQ"/, "книга владельца прописана");
  const demo = text.slice(text.indexOf("echo [!] Вход в книгу не настроен"));
  assert.match(demo, /set "RELAY_DEMO=1"/, "без входа включается демо-режим");
  assert.match(demo, /НЕ подключена/, "и это сказано человеку, а не только в коде");
  // Демо не должно протекать из прошлой попытки: иначе «пустая книга» выглядит как поломка.
  assert.match(text, /set "RELAY_DEMO="\r?\n/, "переменная демо-режима сбрасывается на старте");
});

test("батник: мост Apps Script — первый путь, ключ Google не обязателен", () => {
  // Мост — самый короткий вход: адрес и ключ владелец получает в самой книге.
  // Файл запуска обязан предпочесть его ключу и не искать sa.json зря.
  assert.match(text, /for %%F in \("%~dp0bridge\.txt" "%~dp0\.\.\\bridge\.txt"\)/, "ищет bridge.txt рядом и на уровень выше");
  assert.match(text, /if not defined BRIDGE_URL \(\r?\n  for %%F in \("%~dp0\.\.\\sa\.json"/, "sa.json ищется только без моста");
  assert.match(text, /set "RELAY_BRIDGE_URL=%BRIDGE_URL%"/, "мост передаётся службе");
  assert.match(text, /set "RELAY_BRIDGE_KEY=%BRIDGE_KEY%"/, "и ключ моста тоже");
  assert.match(text, /ключ Google не нужен/, "человеку сказано, что ключ больше не нужен");
  // Один файл — две формы записи: «адрес=ключ» и два значения подряд.
  assert.match(text, /findstr \/n \/c:"="/, "разбирает форму «адрес=ключ»");
  assert.match(text, /Разделителя нет/, "и форму двумя строками");
});

test("батник: спрашивает адрес и ключ в окне запуска, а не отправляет в файл", () => {
  // Владелец отверг вариант «сохраните адрес и ключ в файл bridge.txt»:
  // вставлять значения он хочет в самом приложении. Значит окно запуска
  // должно спросить их само, а файл — появиться как следствие.
  assert.match(text, /set \/p "BRIDGE_URL=Адрес веб-приложения/, "спрашивает адрес при запуске");
  assert.match(text, /set \/p "BRIDGE_KEY=Ключ моста: "/, "и ключ тоже");
  assert.match(text, /if not defined BRIDGE_URL \(\r?\n  echo\.\r?\n  echo Книга ещё не подключена/, "вопрос только когда моста ещё нет");
  assert.match(text, /echo\(!BRIDGE_URL!=!BRIDGE_KEY!/, "ответы сохраняются в bridge.txt сами");
  assert.match(text, /findstr \/i \/c:"\/exec"/, "адрес проверяется до записи, а не после");
  assert.match(text, /api\/mount/, "человеку сказано, где вставить позже");
});

test("ключ моста: 40 символов, безопасен для cmd и для bridge.txt", () => {
  // Ключ придумывает владелец, но требования к нему — наши: если в строке
  // окажется `=` или `%`, разбор bridge.txt в батнике сломается, и человек
  // будет искать причину в мосте, а не в символе.
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const make = () => {
    const bytes = randomBytes(40);
    let out = "";
    for (let i = 0; i < 40; i += 1) out += alphabet[bytes[i] % alphabet.length];
    return out;
  };
  const keys = Array.from({ length: 20 }, make);
  for (const key of keys) {
    assert.equal(key.length, 40);
    // cmd: % ! ^ & | < > " — специальные; = разделяет адрес и ключ в bridge.txt.
    assert.doesNotMatch(key, /[%!^&|<>"= \t]/, `небезопасный символ в ключе: ${key}`);
    assert.equal(JSON.stringify(key).slice(1, -1), key, "ключ не требует экранирования в Code.gs");
  }
  // 40 символов из алфавита 58 — около 234 бит: перебирать бессмысленно.
  assert.ok(keys.every((key) => new Set(key).size > 20), "ключи не вырождены");
});

test("батник: окно не закрывается само — ошибку надо прочитать", () => {
  const tail = text.slice(text.indexOf("node src\\index.mjs"));
  assert.match(tail, /^\s*pause\s*$/m, "после падения транспорта окно ждёт нажатия клавиши");
  assert.match(text, /Это окно закрывать нельзя/, "сказано, что окно — и есть работающий транспорт");
});

test("батник: без Node.js объясняет, что делать, а не падает молча", () => {
  assert.match(text, /where node >nul 2>&1/, "проверка наличия Node.js");
  assert.match(text, /https:\/\/nodejs\.org/, "ссылка на установку");
});
