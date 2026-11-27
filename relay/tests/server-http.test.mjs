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
    version: "9.9.9",
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
    // Версия — из этого процесса: владелец обновляет файлы (GitHub Desktop),
    // но службу перезапускает сам; по цифре в снимке видно, что бежит.
    assert.equal(shot.version, "9.9.9", "снимок несёт версию бегущего процесса");
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
      body: JSON.stringify({ action: "pull", slotId: "worker-2", tab: "aa11", scriptVersion: "1.27.0" }),
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
    assert.equal(duplicate.ok, true, "повтор того же enqueue подтверждается идемпотентно");
    assert.equal(duplicate.duplicate, true);

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
    // Место под версию в шапке есть, даже пока снимок её не прислал.
    assert.match(html, /id="version-line"/);

    const script = await fetch(`${ctx.base}/app.js`);
    assert.equal(script.status, 200);
    const js = await script.text();
    assert.match(js, /\/api\/snapshot/);
    assert.match(js, /version-line/, "шапка печатает версию процесса");
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

    assert.match(html, /id="btn-notion-net"/, "и чем проверить сеть — без токена");

    const js = await (await fetch(`${ctx.base}/app.js`)).text();
    // Токен уходит на свой маршрут и без перезапуска службы.
    assert.match(js, /\/api\/notion-token/);
    // После принятия токена прячется только поле с кнопкой проверки: строка
    // целиком остаётся, иначе «Роли в книгу» и «Диагностика» недоступны
    // ровно в момент успеха.
    assert.match(js, /shot\.notion\?\.ready \? "none"/, "поле токена скрывается при готовом Notion");
    assert.doesNotMatch(js, /shot\.demo \|\| shot\.notion\?\.ready \? "none"/,
      "строка целиком при готовом Notion не прячется");
    assert.match(js, /\/api\/net-deep/, "диагностика по звеньям");
    assert.match(js, /\/api\/roles-to-book/, "роли переезжают в книгу — Notion перестаёт быть обязательным");
    assert.match(js, /\/api\/book-speed/, "замер книги: цифры вместо «медленно»");
    // Проверка одна на всё: иначе «мост молчит» и «Notion молчит» лечатся
    // по отдельности, хотя причина общая — нет исходящего HTTPS.
    // Поля прокси в пульте нет: владельцу нечего туда вводить, а лишнее
    // поле читается как «без него не заработает».
    assert.doesNotMatch(js, /applyProxy|btn-proxy/);
    assert.doesNotMatch(html, /id="proxy-url"/);
    // Кнопка называет действие, а не состояние: «Автоцикл» при включённом
    // автоцикле читается как «включить ещё раз».
    assert.match(js, /Остановить автоцикл/);
    assert.match(js, /Включить автоцикл/);
  } finally {
    await ctx.close();
  }
});

test("сеть наружу не проходит — служба говорит об этом, а не «не отвечает»", async () => {
  // Хранилище, которое не дотягивается до книги: ровно сценарий владельца.
  const failing = {
    demo: false,
    async read() { throw new Error("мост не ответил за 20000 мс"); },
    async write() { throw new Error("мост не ответил за 20000 мс"); },
    async append() { throw new Error("мост не ответил за 20000 мс"); },
    async updateRange() { throw new Error("мост не ответил за 20000 мс"); },
    async meta() { throw new Error("мост не ответил за 20000 мс"); },
    async ensureSheet() { throw new Error("мост не ответил за 20000 мс"); },
  };
  const { server } = createTransportServer({
    spreadsheetId: "bridge",
    storeFactory: () => failing,
    log: () => {},
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const response = await fetch(`${base}/api/snapshot`);
    // 504, а не 500: служба жива, недоступен внешний мир.
    assert.equal(response.status, 504);
    const body = await response.json();
    assert.equal(body.network, true);
    assert.match(body.why, /Служба работает/, "человеку сказано, что перезапускать нечего");
    assert.match(body.why, /Проверить сеть/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("проверка сети: Notion и книга проверяются вместе, виден прокси", async () => {
  const { server } = createTransportServer({
    spreadsheetId: "fake", token: "fake", storeFactory: () => createFakeStore({ slots: slotRows() }),
    bridgeUrl: "http://127.0.0.1:1/exec", bridgeKey: "k".repeat(40),
    log: () => {},
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const doctor = await (await fetch(`${base}/api/net-doctor`)).json();
    assert.equal(typeof doctor.ok, "boolean");
    assert.ok(doctor.notion, "проверка Notion есть");
    assert.ok(doctor.bridge, "проверка книги есть");
    // Без прокси это должно быть видно словами, а не пустым полем.
    assert.match(doctor.proxy.text, /прямую|не применяется/);
    assert.match(doctor.why, /сеть|Notion|книга/i);
  } finally {
    await new Promise((resolve) => server.close(resolve));
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
