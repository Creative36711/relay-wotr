#!/usr/bin/env node
// Запуск службы транспорта.
//
// Один процесс, один адрес. Всё, что нужно для старта, — идентификатор книги
// и токен доступа к ней; всё остальное служба находит сама (мастер настройки)
// или берёт из значений по умолчанию.
//
// Переменные окружения:
//   RELAY_SPREADSHEET_ID  — книга состояния (обязательна)
//   RELAY_GOOGLE_SA_FILE  — путь к JSON-ключу сервисного аккаунта (рекомендуется)
//   RELAY_GOOGLE_SA_JSON  — тот же ключ строкой, если файл неудобен
//   RELAY_TOKEN           — готовый токен Google с доступом к Sheets
//   RELAY_TOKEN_CMD       — команда, печатающая токен (для обновляемых токенов)
//   PORT                  — порт, по умолчанию 8787
//   HOST                  — адрес, по умолчанию 0.0.0.0 (нужно для предпросмотра)

import { execFileSync } from "node:child_process";
import { createTransportServer, serverReadiness } from "./server.mjs";
import { createAppsScriptStore } from "./appsscript-bridge.mjs";
import { defaultBridgePath, readBridgeConfig } from "./bridge-config.mjs";
import { defaultProxyPath, readProxyConfig } from "./proxy-config.mjs";
import { serviceAccountFromEnv, createServiceAccountToken } from "./google-auth.mjs";

// Версия службы в одном месте: она печатается в шапке страницы установки.
const VERSION = "1.25.1";

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || "0.0.0.0";
// Не const: при работе через мост книга уже известна мосту, и заглушка
// "bridge" нужна только чтобы служба не считала адрес незаданным.
let spreadsheetId = process.env.RELAY_SPREADSHEET_ID || "";
const tokenCmd = process.env.RELAY_TOKEN_CMD || "";
// Мост в Apps Script: адрес веб-приложения и ключ. Это второй, и теперь
// основной, способ добраться до книги — без ключа Google и без доступа
// «добавьте робота в редакторы».
// Адрес и ключ моста: сначала окружение, потом файл bridge.txt рядом со
// службой. Файл — основной способ: его заполняет сама страница настройки,
// когда владелец вставляет два значения в браузере. Переменные остаются для
// тех, кто запускает службу скриптом.
const bridgeFile = process.env.RELAY_BRIDGE_FILE || defaultBridgePath();

// Прокси: если он задан в системе, второй раз его спрашивать не у кого.
// `proxy.txt` рядом с `bridge.txt` — только для тех, кто запускает службу
// скриптом и не держит переменную окружения: файл читается молча, никаких
// полей и вопросов в окне запуска нет.
const proxyFile = process.env.RELAY_PROXY_FILE || defaultProxyPath(bridgeFile);
const proxyFromFile = readProxyConfig(proxyFile).url;
if (proxyFromFile && !process.env.HTTPS_PROXY && !process.env.https_proxy) {
  process.env.HTTPS_PROXY = proxyFromFile;
  process.env.HTTP_PROXY = proxyFromFile;
}
const fromFile = readBridgeConfig(bridgeFile);
let bridgeUrl = process.env.RELAY_BRIDGE_URL || fromFile.url || "";
let bridgeKey = process.env.RELAY_BRIDGE_KEY || fromFile.key || "";
if (bridgeUrl) spreadsheetId = spreadsheetId || "bridge";
// Демо-режим: состояние в памяти. Нужен, чтобы посмотреть пульт до настройки.
// Мост считается достаточным входом: книга у него уже есть.
const demo = process.env.RELAY_DEMO === "1" || (!spreadsheetId && !bridgeUrl);

if (!spreadsheetId && !demo) {
  console.error("RELAY_SPREADSHEET_ID не задан: службе негде хранить состояние.");
  process.exit(1);
}

// Ключ сервисного аккаунта — путь по умолчанию: без него владельцу пришлось
// бы каждый час добывать новый токен вручную.
let serviceAccount = null;
if (!demo && !bridgeUrl) {
  try {
    serviceAccount = serviceAccountFromEnv(process.env);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

if (!demo && !bridgeUrl && !serviceAccount && !process.env.RELAY_TOKEN && !tokenCmd) {
  console.error(
    "Нет доступа к книге. Два пути, выбирайте короткий:\n" +
    "  1) Мост в книге (без ключа Google): положите relay/apps-script/Code.gs\n" +
    "     в «Расширения → Apps Script», разверните как веб-приложение с доступом\n" +
    "     «Все» и задайте RELAY_BRIDGE_URL и RELAY_BRIDGE_KEY.\n" +
    "  2) Ключ сервисного аккаунта: RELAY_GOOGLE_SA_FILE=путь/к/ключу.json.",
  );
  process.exit(1);
}

const tokenProvider = serviceAccount
  ? createServiceAccountToken({ credentials: serviceAccount, log: (line) => console.log(line) })
  : tokenCmd
    ? () => execFileSync(tokenCmd, { shell: true, encoding: "utf8" }).trim()
    : () => process.env.RELAY_TOKEN;

const { server, service } = createTransportServer({
  spreadsheetId,
  demo,
  tokenProvider,
  // Мост подменяет собой хранилище целиком: служба не знает, откуда строки.
  // Собирается он внутри сервера, а не здесь: адрес может появиться уже
  // после старта — из формы в браузере, — и тогда фабрика нужна та же.
  bridgeStoreFactory: ({ url, key }) => createAppsScriptStore({ url, key }),
  // Мост нужен и самому серверу: страница установки показывает, настроен ли
  // он, а проверка связи ходит к нему тем же ключом.
  bridgeUrl,
  bridgeKey,
  bridgeFile,
  version: VERSION,
  // Владелец ввёл адрес в браузере — служба уже не в демо, но процесс об этом
  // узнаёт только здесь. Сбрасываем флаг и не перезапускаем службу.
  onBridgeChange: () => {
    console.log("[мост] адрес и ключ приняты из браузера; демо-режим снят");
  },
  log: (line) => console.log(`[${new Date().toISOString()}] ${line}`),
});

server.listen(PORT, HOST, async () => {
  console.log(`Транспорт слушает http://${HOST}:${PORT}`);
  if (bridgeUrl) console.log("Книга: через мост Apps Script (ключ Google не нужен)");
  if (demo) {
    console.log("Режим: демонстрация (состояние в памяти). Для работы задайте RELAY_SPREADSHEET_ID и ключ сервисного аккаунта.");
    return;
  }
  const state = await serverReadiness({ service });
  if (state.ok) {
    console.log("Готовность: цикл можно запускать");
  } else {
    console.log("Готовность: не всё на месте");
    for (const problem of state.problems) console.log(`  • ${problem}`);
  }
  // Замечания — не отказ: справочник ролей и папка логов улучшают работу, но
  // цикл без них идёт. Печатаются отдельно, чтобы «можно запускать» не
  // соседствовало с непонятным списком.
  for (const note of state.notes || []) console.log(`  ! ${note}`);
  if (!state.ok) console.log("Откройте пульт: мастер настройки найдёт базы и запишет ключи.");
});

const stop = () => server.close(() => process.exit(0));
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
