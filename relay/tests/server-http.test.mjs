// Сервер: единый интерфейс должен отвечать даже без интернета.
//
// Проверяется не «сервер поднялся», а то, чем пользуется человек и вкладка:
// здоровье, снимок, шаг, очередь, статика пульта и отказ по неизвестному пути.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTransportServer } from "../src/server.mjs";
import { createFakeStore, settingsRows, slotRows, queueRow, knownAgentRows } from "./fake-sheets.mjs";

const startServer = async () => {
  const store = createFakeStore({
    slots: slotRows(),
    settings: settingsRows(),
    queue: [queueRow({ id: "q-1", card: "c-1", role: "Technical Artist" })],
    runs: [],
    events: [],
    agents: knownAgentRows(),
  });
  const { server, service } = createTransportServer({
    spreadsheetId: "fake",
    token: "fake",
    storeFactory: () => store,
    log: () => {},
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  return { server, store, service, base, close: () => new Promise((resolve) => server.close(resolve)) };
};

test("сервер отвечает на здоровье и отдаёт снимок", async () => {
  const ctx = await startServer();
  try {
    const health = await (await fetch(`${ctx.base}/api/health`)).json();
    assert.equal(health.ok, true);

    const shot = await (await fetch(`${ctx.base}/api/snapshot`)).json();
    assert.equal(shot.slots.length, 4);
    assert.equal(shot.mode, "manual");
    assert.equal(shot.counts.waiting, 1);
  } finally {
    await ctx.close();
  }
});

test("вкладка забирает работу через /api/agent", async () => {
  const ctx = await startServer();
  try {
    const hello = await (await fetch(`${ctx.base}/api/agent`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "hello", account: "creative36711@list.ru", tab: "aa11" }),
    })).json();
    assert.equal(hello.ok, true);
    assert.equal(hello.slot.slotId, "worker-2");

    const pull = await (await fetch(`${ctx.base}/api/agent`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "pull", slotId: "worker-2", tab: "aa11" }),
    })).json();
    assert.equal(pull.ok, true);
    assert.equal(pull.work.card, "c-1");
  } finally {
    await ctx.close();
  }
});

test("пульт ставит карточку в очередь и снимает её", async () => {
  const ctx = await startServer();
  try {
    const added = await (await fetch(`${ctx.base}/api/control`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "enqueue", card: "c-2", title: "Новая", role: "Technical Artist" }),
    })).json();
    assert.equal(added.ok, true);

    const duplicate = await (await fetch(`${ctx.base}/api/control`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "enqueue", card: "c-2", role: "Technical Artist" }),
    })).json();
    assert.equal(duplicate.ok, false, "одна карточка не ставится в очередь дважды");

    const cancelled = await (await fetch(`${ctx.base}/api/control`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "cancel", itemId: added.itemId }),
    })).json();
    assert.equal(cancelled.ok, true);
  } finally {
    await ctx.close();
  }
});

test("пульт открывается как страница и не зависит от сборки", async () => {
  const ctx = await startServer();
  try {
    const page = await fetch(`${ctx.base}/`);
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /Relay · WOTR/);
    assert.match(html, /app\.js/);

    const script = await fetch(`${ctx.base}/app.js`);
    assert.equal(script.status, 200);
    const js = await script.text();
    assert.match(js, /\/api\/snapshot/);
  } finally {
    await ctx.close();
  }
});

test("пульт: поле токена Notion и честная подпись кнопки режима", async () => {
  // Владелец видит пульт, а не исходники: обе вещи проверяются по странице.
  const ctx = await startServer();
  try {
    const html = await (await fetch(`${ctx.base}/`)).text();
    assert.match(html, /id="notion-token"/, "есть куда вставить токен Notion");
    assert.match(html, /Проверить токен/, "и чем его проверить");

    const js = await (await fetch(`${ctx.base}/app.js`)).text();
    // Токен уходит на свой маршрут и без перезапуска службы.
    assert.match(js, /\/api\/notion-token/);
    // Кнопка называет действие, а не состояние: «Автоцикл» при включённом
    // автоцикле читается как «включить ещё раз».
    assert.match(js, /Остановить автоцикл/);
    assert.match(js, /Включить автоцикл/);
  } finally {
    await ctx.close();
  }
});

test("неизвестный путь отвечает словами, а не пустотой", async () => {
  const ctx = await startServer();
  try {
    const response = await fetch(`${ctx.base}/api/unknown`);
    assert.equal(response.status, 404);
    const body = await response.json();
    assert.match(body.why, /неизвестный путь/);
  } finally {
    await ctx.close();
  }
});

test("адрес и ключ из формы: файл записан, демо снято без перезапуска", async () => {
  // Живая история владельца: служба поднята в демо, книга есть, но адрес
  // вводят в браузере. После ввода пульт обязан показывать книгу, а не демо,
  // и файл — появиться сам.
  const dir = mkdtempSync(join(tmpdir(), "relay-bridge-"));
  const bridgeFile = join(dir, "bridge.txt");
  const book = createFakeStore({ slots: slotRows(), settings: settingsRows(), queue: [], runs: [], events: [], agents: knownAgentRows() });
  const { server } = createTransportServer({
    spreadsheetId: "bridge",
    demo: true,
    bridgeFile,
    bridgeStoreFactory: () => book,
    log: () => {},
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const before = await (await fetch(`${base}/api/snapshot`)).json();
    assert.equal(before.demo, true, "до ввода адреса — демо");

    const saved = await (await fetch(`${base}/api/bridge-config`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://script.google.com/macros/s/AKfycbx000/exec", key: "2eJGAzY7Wz3eokdFHtZnBCFMEiLUNbozsFaFkVWd" }),
    })).json();
    assert.equal(saved.ok, true, saved.why);
    assert.match(readFileSync(bridgeFile, "utf8"), /^https:\/\/script\.google\.com\/macros\/s\/AKfycbx000\/exec=2eJGAz/);

    const after = await (await fetch(`${base}/api/snapshot`)).json();
    assert.equal(after.demo, false, "демо снято без перезапуска");
    assert.equal(after.slots.length, 4, "слоты читаются из книги");

    const health = await (await fetch(`${base}/api/health`)).json();
    assert.equal(health.demo, false, "health не врёт про демо");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("обрезанный ключ не пишется в файл", async () => {
  const dir = mkdtempSync(join(tmpdir(), "relay-bridge-"));
  const bridgeFile = join(dir, "bridge.txt");
  const { server } = createTransportServer({ spreadsheetId: "bridge", demo: true, bridgeFile, log: () => {} });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const bad = await (await fetch(`${base}/api/bridge-config`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://script.google.com/macros/s/AKfycbx000/exec", key: "коротко" }),
    })).json();
    assert.equal(bad.ok, false);
    assert.match(bad.why, /короче 20/);
    assert.throws(() => readFileSync(bridgeFile, "utf8"), /ENOENT/, "файл не создан");
    assert.equal((await (await fetch(`${base}/api/snapshot`)).json()).demo, true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("запрос без spreadsheetId не стартует", () => {
  assert.throws(() => createTransportServer({ spreadsheetId: "" }), /spreadsheetId/);
});
