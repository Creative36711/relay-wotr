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
import { serviceAccountFromEnv, createServiceAccountToken } from "./google-auth.mjs";

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || "0.0.0.0";
// Не const: при работе через мост книга уже известна мосту, и заглушка
// "bridge" нужна только чтобы служба не считала адрес незаданным.
let spreadsheetId = process.env.RELAY_SPREADSHEET_ID || "";
const tokenCmd = process.env.RELAY_TOKEN_CMD || "";
// Мост в Apps Script: адрес веб-приложения и ключ. Это второй, и теперь
// основной, способ добраться до книги — без ключа Google и без доступа
// «добавьте робота в редакторы».
const bridgeUrl = process.env.RELAY_BRIDGE_URL || "";
const bridgeKey = process.env.RELAY_BRIDGE_KEY || "";
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
  storeFactory: bridgeUrl
    ? () => createAppsScriptStore({ url: bridgeUrl, key: bridgeKey })
    : undefined,
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
  if (!state.ok) {
    console.log("Готовность: не всё на месте");
    for (const problem of state.problems) console.log(`  • ${problem}`);
    console.log("Откройте пульт и запустите мастер настройки: он найдёт базы и запишет ключи.");
  } else {
    console.log("Готовность: цикл можно запускать");
  }
});

const stop = () => server.close(() => process.exit(0));
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
