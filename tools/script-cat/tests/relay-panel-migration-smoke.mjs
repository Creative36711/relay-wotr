import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const panel = await readFile(new URL("../src/06-pause-panel.js", import.meta.url), "utf8");
const header = await readFile(new URL("../src/00-header.js", import.meta.url), "utf8");
const client = await readFile(new URL("../src/46-relay-client.js", import.meta.url), "utf8");
const service = await readFile(new URL("../../../relay/src/service.mjs", import.meta.url), "utf8");
const web = await readFile(new URL("../../../relay/web/app.js", import.meta.url), "utf8");

test("Node Relay: вкладка видима при локальной паузе, но пауза не разрешает pull", () => {
  const tick = client.slice(client.indexOf("async function relayClientTick()"), client.indexOf("function relayClientStart()"));
  assert.ok(tick.indexOf("relayIdentity()") < tick.indexOf("isPaused()"), "сначала hello/регистрация, затем локальный pause gate");
  assert.match(tick, /relayIdentity\(\{ force: true \}\)/, "paused-вкладка обновляет presence heartbeat");
  assert.match(service, /localPaused: Boolean\(localPaused\)/, "снимок хранит локальную паузу клиента");
  const identity = client.slice(client.indexOf("async function relayIdentity("), client.indexOf("/** Отчёт службе"));
  assert.match(identity, /const email = String\(\(read && read\.email\) \|\| ""\)/, "hello использует email только текущей вкладки Arena");
  assert.doesNotMatch(identity, /accountSeen\(\)\.email/, "не берёт устаревший email из общего хранилища соседнего контейнера");
  assert.match(identity, /relayClient\.lastError = why/, "отказ hello виден в статусе виджета");
  assert.match(client, /lastContactAt \? "не зарегистрирован" : "нет связи"/, "различает сетевой сбой и отказ опознания");
  assert.match(client, /ответ в неизвестном формате/, "ошибка протокола не маскируется под тишину");
  assert.match(web, /локальной паузе/, "пульт объясняет, почему admin вкладка не забирает команду");
  assert.match(web, /if \(adminClients\.length && outdated\.length\)/, "ссылка на обновление видна только при реально устаревшем клиенте");
  assert.match(web, /timeZone: "Europe\/Moscow"/, "временные метки пульта форматируются в московской зоне");
  assert.match(web, /МСК`/, "в журнале явно указана московская зона");
  assert.match(web, /location\.origin/, "пульт показывает точный адрес Relay для ScriptCat");
  assert.match(web, /разрешите localhost/, "инструкция напоминает о разрешении GM localhost");
});

test("подключённый виджет убирает дубли Шаг/Все вкладки и ведёт в Node-пульт", () => {
  assert.match(panel, /const superseded = relayMode && \[ui\.step, ui\.wake\]\.includes\(id\)/);
  assert.match(client, /function relayControlActive\(\)[\s\S]*?lastContactAt/);
  assert.match(header, /@connect\s+localhost/, "userscript grants localhost for the Node Relay bridge");
  assert.match(header, /@connect\s+127\.0\.0\.1/, "userscript grants the IPv4 loopback too");
  assert.match(panel, /id="\$\{ui\.relay\}"[^>]*>↗ Пульт Relay/);
  assert.match(panel, /relayLink\.href = base \|\| "#"/);
  assert.match(panel, /Временный локальный автоцикл ScriptCat/);
});
