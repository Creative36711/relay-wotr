import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const panel = await readFile(new URL("../src/06-pause-panel.js", import.meta.url), "utf8");
const header = await readFile(new URL("../src/00-header.js", import.meta.url), "utf8");
const client = await readFile(new URL("../src/46-relay-client.js", import.meta.url), "utf8");
const instances = await readFile(new URL("../src/12b-instances.js", import.meta.url), "utf8");
const connections = await readFile(new URL("../src/07-connections-ui.js", import.meta.url), "utf8");
const service = await readFile(new URL("../../../relay/src/service.mjs", import.meta.url), "utf8");
const web = await readFile(new URL("../../../relay/web/app.js", import.meta.url), "utf8");

test("Node Relay: вкладка видима при локальной паузе, но пауза не разрешает pull", () => {
  const tick = client.slice(client.indexOf("async function relayClientTick()"), client.indexOf("function relayClientStart()"));
  assert.ok(tick.indexOf("relayIdentity()") < tick.indexOf("isPaused()"), "сначала hello/регистрация, затем локальный pause gate");
  assert.match(tick, /refreshPresence[\s\S]*?relayIdentity\(\{ force: refreshPresence \}\)/, "каждая вкладка обновляет presence в службе раз в минуту даже при локальном ожидании");
  assert.match(client, /relayClient\.slotId && !force && nowMs - relayClient\.helloAt < 600000/, "force обходит десятиминутный кеш hello после перезапуска службы");
  assert.match(service, /localPaused: Boolean\(localPaused\)/, "снимок хранит локальную паузу клиента");
  const identity = client.slice(client.indexOf("async function relayIdentity("), client.indexOf("/** Отчёт службе"));
  assert.match(identity, /const email = String\(\(read && read\.email\) \|\| ""\)/, "hello использует email только текущей вкладки Arena");
  assert.doesNotMatch(identity, /accountSeen\(\)\.email/, "не берёт устаревший email из общего хранилища соседнего контейнера");
  assert.match(identity, /relayClient\.lastError = why/, "отказ hello виден в статусе виджета");
  assert.match(client, /lastContactAt \? "не зарегистрирован" : "нет связи"/, "различает сетевой сбой и отказ опознания");
  assert.match(client, /ответ в неизвестном формате/, "ошибка протокола не маскируется под тишину");
  assert.match(client, /Админская вкладка не опросила очередь Relay/);
  assert.match(client, /action: "event", slotId, kind: "state", level: relayClient\.admin \? "warn" : "info", text/);
  assert.match(web, /adminPolledRecently/, "пульт различает hello и фактический pull");
  assert.match(web, /bannerHistoryNext/, "временные плашки записываются в историю");
  assert.match(web, /локальной паузе/, "пульт объясняет, почему admin вкладка не забирает команду");
  assert.match(web, /if \(adminClients\.length && outdated\.length\)/, "ссылка на обновление видна только при реально устаревшем клиенте");
  assert.match(web, /timeZone: "Europe\/Moscow"/, "временные метки пульта форматируются в московской зоне");
  assert.match(web, /МСК`/, "в журнале явно указана московская зона");
  assert.match(web, /http:\/\/127\.0\.0\.1:8787/, "пульт показывает автоматический IPv4 loopback адрес");
  assert.match(web, /разрешение localhost\/127\.0\.0\.1/, "инструкция объясняет одноразовое loopback-разрешение");
});

test("Arena panel keeps executor controls but exposes no settings editor", async () => {
  const boot = await readFile(new URL("../src/29-boot.js", import.meta.url), "utf8");
  assert.match(boot, /mount\(\);/, "executor status/log panel is still available");
  assert.doesNotMatch(panel, /id="\$\{ui\.setup\}"|setup\(true\)/, "old settings button and handler are removed");
  assert.doesNotMatch(connections, /function connectionDialog\(|async function setup\(/, "connection editing is removed from ScriptCat");
  assert.match(client, /function relayControlActive\(\)[\s\S]*?lastContactAt/);
  assert.match(header, /@connect\s+localhost/, "userscript grants localhost for the Node Relay bridge");
  assert.match(header, /@connect\s+127\.0\.0\.1/, "userscript grants the IPv4 loopback too");
  assert.match(instances, /RELAY_DEFAULT_BASE = "http:\/\/127\.0\.0\.1:8787"/, "local Relay defaults to IPv4 loopback");
  assert.match(instances, /localhost\(\?=:\\d\|\\\/\|\$\)[\s\S]*?127\.0\.0\.1/, "localhost normalizes to the IPv4 listener");
  assert.match(client, /function relayClientStart\(\) \{\s*const run =/);
  assert.doesNotMatch(client.slice(client.indexOf("async function relayClientTick()"), client.indexOf("function relayClientStart()")), /if \(!relayConfigured\(\)\) return/);
  assert.match(panel, /id="\$\{ui\.relay\}"[^>]*>↗ Пульт Relay/);
  assert.match(panel, /relayLink\.href = base \|\| "#"/);
  assert.match(panel, /Временный локальный автоцикл ScriptCat/);
});
