import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const panel = await readFile(new URL("../src/06-pause-panel.js", import.meta.url), "utf8");
const client = await readFile(new URL("../src/46-relay-client.js", import.meta.url), "utf8");
const service = await readFile(new URL("../../../relay/src/service.mjs", import.meta.url), "utf8");
const web = await readFile(new URL("../../../relay/web/app.js", import.meta.url), "utf8");

test("Node Relay: вкладка видима при локальной паузе, но пауза не разрешает pull", () => {
  const tick = client.slice(client.indexOf("async function relayClientTick()"), client.indexOf("function relayClientStart()"));
  assert.ok(tick.indexOf("relayIdentity()") < tick.indexOf("isPaused()"), "сначала hello/регистрация, затем локальный pause gate");
  assert.match(tick, /relayIdentity\(\{ force: true \}\)/, "paused-вкладка обновляет presence heartbeat");
  assert.match(service, /localPaused: Boolean\(localPaused\)/, "снимок хранит локальную паузу клиента");
  assert.match(web, /локальной паузе/, "пульт объясняет, почему admin вкладка не забирает команду");
  assert.match(web, /if \(adminClients\.length && outdated\.length\)/, "ссылка на обновление видна только при реально устаревшем клиенте");
});

test("подключённый виджет убирает дубли Шаг/Все вкладки и ведёт в Node-пульт", () => {
  assert.match(panel, /const superseded = relayMode && \[ui\.step, ui\.wake\]\.includes\(id\)/);
  assert.match(client, /function relayControlActive\(\)[\s\S]*?lastContactAt/);
  assert.match(panel, /id="\$\{ui\.relay\}"[^>]*>↗ Пульт Relay/);
  assert.match(panel, /relayLink\.href = base \|\| "#"/);
  assert.match(panel, /Временный локальный автоцикл ScriptCat/);
});
