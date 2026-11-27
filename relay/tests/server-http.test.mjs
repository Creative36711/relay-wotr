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

const startServer = async ({ notionToken = "" } = {}) => {
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
    NOTION_TOKEN: notionToken,
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
      body: JSON.stringify({ action: "pull", slotId: "worker-2", tab: "aa11", scriptVersion: "1.34.1" }),
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

test("запрос допуска из пульта требует same-origin и доходит до живой admin-вкладки", async () => {
  const ctx = await startServer();
  try {
    const projectId = "123e4567-e89b-12d3-a456-426614174000";
    const hello = await (await fetch(`${ctx.base}/api/agent`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "hello", account: "creative36711@gmail.com", tab: "approval-tab", scriptVersion: "1.34.1",
        projectId, projectName: "WOTR", projectApproved: false, projectBlockReason: "unapproved" }),
    })).json();
    assert.equal(hello.ok, true);

    const hostile = await fetch(`${ctx.base}/api/project-approval`, {
      method: "POST", headers: { origin: "https://evil.example", "content-type": "application/json" },
      body: JSON.stringify({ projectId }),
    });
    assert.equal(hostile.status, 403);

    const response = await fetch(`${ctx.base}/api/project-approval`, {
      method: "POST", headers: { origin: ctx.base, "content-type": "application/json" },
      body: JSON.stringify({ projectId }),
    });
    const result = await response.json();
    assert.equal(result.ok, true);
    const delivered = await ctx.service.hello({ account: "creative36711@gmail.com", tab: "approval-tab", scriptVersion: "1.34.1",
      projectId, projectName: "WOTR", projectApproved: false, projectBlockReason: "unapproved" });
    assert.equal(delivered.projectApprovalRequest.id, result.requestId);
  } finally {
    await ctx.close();
  }
});

test("подробная причина проверки допуска попадает в статус пульта", async () => {
  const ctx = await startServer();
  try {
    const projectId = "123e4567-e89b-12d3-a456-426614174000";
    const response = await fetch(`${ctx.base}/api/agent`, {
      method: "POST", headers: { origin: "https://arena.ai", "content-type": "application/json" },
      body: JSON.stringify({ action: "event", slotId: "admin", tab: "approval-result-tab", scriptVersion: "1.35.1",
        kind: "state", level: "warn", text: "Проверка отказана",
        data: { projectApprovalResult: false, projectId, projectName: "WOTR",
          projectApprovalFailure: "Drive: папка проекта недоступна" } }),
    });
    assert.equal(response.status, 200);
    const client = (await ctx.service.snapshot()).scriptClients.find((item) => item.tab === "approval-result-tab");
    assert.equal(client.projectApproved, false);
    assert.equal(client.projectBlockReason, "unapproved");
    assert.equal(client.projectApprovalFailure, "Drive: папка проекта недоступна");
  } finally { await ctx.close(); }
});

test("hello переносит уже сохранённые локальные credentials в новый профиль Relay", async () => {
  const ctx = await startServer();
  try {
    const project = {
      id: "123e4567-e89b-12d3-a456-426614174000", name: "WOTR",
      roles: "123e4567-e89b-12d3-a456-426614174001", missions: "123e4567-e89b-12d3-a456-426614174002",
      requests: "123e4567-e89b-12d3-a456-426614174003", questions: "123e4567-e89b-12d3-a456-426614174004",
      pageUrl: "https://www.notion.so/workspace/page-123e4567e89b12d3a456426614174005",
      questionsUrl: "https://www.notion.so/workspace/questions-123e4567e89b12d3a456426614174006",
      repo: "Creative36711/open-bfme", branch: "main", driveFolder: "wotr",
      repos: [{ repo: "Creative36711/open-bfme", branch: "main", main: true }], roleRepos: [],
    };
    const response = await fetch(`${ctx.base}/api/agent`, {
      method: "POST", headers: { origin: "https://arena.ai", "content-type": "application/json" },
      body: JSON.stringify({ action: "hello", account: "creative36711@gmail.com", tab: "migration-tab",
        projectId: project.id, projectProfile: project, projectConfigUpdatedAt: "stale-marker-from-previous-version",
        projectCredentials: {
          notion: "ntn_existing_local", gwUrl: "https://script.google.com/macros/s/deploy/exec", gwKey: "existing_gateway_key",
        }, localBusy: false }),
    });
    const hello = await response.json();
    assert.equal(hello.projectSettings.credentials.notion, "ntn_existing_local");
    assert.equal(hello.projectSettings.credentials.gwUrl, "https://script.google.com/macros/s/deploy/exec");
    assert.equal(hello.projectSettings.credentials.gwKey, "existing_gateway_key");
    assert.equal(hello.projectSettingsUnavailable, undefined);
    const saved = await (await fetch(`${ctx.base}/api/projects`, { headers: { origin: ctx.base } })).json();
    assert.equal(saved.profiles[0].secretStatus.notion, true);
    assert.equal(saved.profiles[0].secretStatus.gwKey, true);
  } finally {
    await ctx.close();
  }
});

test("новый профиль автоматически получает Notion token, уже заданный в BAT", async () => {
  const ctx = await startServer({ notionToken: "ntn_from_bat_config" });
  try {
    const project = {
      id: "123e4567-e89b-12d3-a456-426614174200", name: "WOTR",
      roles: "123e4567-e89b-12d3-a456-426614174201", missions: "123e4567-e89b-12d3-a456-426614174202",
      requests: "123e4567-e89b-12d3-a456-426614174203", questions: "123e4567-e89b-12d3-a456-426614174204",
      pageUrl: "https://www.notion.so/workspace/page-123e4567e89b12d3a456426614174205",
      questionsUrl: "https://www.notion.so/workspace/questions-123e4567e89b12d3a456426614174206",
      repo: "Creative36711/open-bfme", branch: "main", driveFolder: "wotr",
      repos: [{ repo: "Creative36711/open-bfme", branch: "main", main: true }], roleRepos: [],
    };
    const saved = await (await fetch(`${ctx.base}/api/projects`, {
      method: "POST", headers: { origin: ctx.base, "content-type": "application/json" },
      body: JSON.stringify({ profile: project, secrets: {
        gwUrl: "https://script.google.com/macros/s/deploy/exec", gwKey: "project_key",
      } }),
    })).json();
    assert.equal(saved.ok, true);
    assert.equal(saved.profile.secretStatus.notion, true);
    const hello = await (await fetch(`${ctx.base}/api/agent`, {
      method: "POST", headers: { origin: "https://arena.ai", "content-type": "application/json" },
      body: JSON.stringify({ action: "hello", account: "creative36711@gmail.com", tab: "bat-token-tab",
        projectId: project.id, projectName: project.name, projectConfigUpdatedAt: "", localBusy: false }),
    })).json();
    assert.equal(hello.projectSettings.credentials.notion, "ntn_from_bat_config");
  } finally { await ctx.close(); }
});

test("пульт сохраняет секреты локально; только Arena получает их в ответе hello", async () => {
  const ctx = await startServer();
  try {
    const project = {
      id: "123e4567-e89b-12d3-a456-426614174000", name: "WOTR",
      roles: "123e4567-e89b-12d3-a456-426614174001", missions: "123e4567-e89b-12d3-a456-426614174002",
      requests: "123e4567-e89b-12d3-a456-426614174003", questions: "123e4567-e89b-12d3-a456-426614174004",
      pageUrl: "https://www.notion.so/workspace/page-123e4567e89b12d3a456426614174005",
      questionsUrl: "https://www.notion.so/workspace/questions-123e4567e89b12d3a456426614174006",
      repo: "Creative36711/open-bfme", branch: "main", driveFolder: "wotr",
      repos: [{ repo: "Creative36711/open-bfme", branch: "main", main: true }], roleRepos: [],
    };
    const savedResponse = await fetch(`${ctx.base}/api/projects`, {
      method: "POST", headers: { origin: ctx.base, "content-type": "application/json" },
      body: JSON.stringify({ profile: project, secrets: { notion: "ntn_saved_secret", gwUrl: "https://script.google.com/macros/s/deploy/exec", gwKey: "drive_saved_secret" } }),
    });
    const saved = await savedResponse.json();
    assert.equal(saved.ok, true);
    assert.equal(JSON.stringify(saved).includes("ntn_saved_secret"), false, "pult save response never echoes secrets");

    const helloResponse = await fetch(`${ctx.base}/api/agent`, {
      method: "POST", headers: { origin: "https://arena.ai", "content-type": "application/json" },
      body: JSON.stringify({ action: "hello", account: "creative36711@gmail.com", tab: "settings-tab", scriptVersion: "1.34.1",
        projectId: project.id, projectName: project.name, projectConfigUpdatedAt: "", projectApproved: true,
        projectBlockReason: "", localBusy: false }),
    });
    const hello = await helloResponse.json();
    assert.equal(hello.projectSettings.credentials.notion, "ntn_saved_secret");
    assert.equal(hello.projectSettings.credentials.gwKey, "drive_saved_secret");
    assert.equal(hello.projectSettings.secretsMigrated, true);
    const client = (await ctx.service.snapshot()).scriptClients.find((item) => item.slotId === "admin");
    assert.equal(client.projectApproved, false, "central settings change blocks new work before the client synchronizes");

    const hostileAgent = await fetch(`${ctx.base}/api/agent`, {
      method: "POST", headers: { origin: "https://evil.example", "content-type": "application/json" },
      body: JSON.stringify({ action: "hello", account: "creative36711@gmail.com", tab: "evil", projectId: project.id }),
    });
    assert.equal(hostileAgent.status, 403);

    const nextProject = {
      ...project, id: "123e4567-e89b-12d3-a456-426614174100", name: "Second project",
      roles: "123e4567-e89b-12d3-a456-426614174101", missions: "123e4567-e89b-12d3-a456-426614174102",
      requests: "123e4567-e89b-12d3-a456-426614174103", questions: "123e4567-e89b-12d3-a456-426614174104",
    };
    const nextSave = await fetch(`${ctx.base}/api/projects`, {
      method: "POST", headers: { origin: ctx.base, "content-type": "application/json" },
      body: JSON.stringify({ profile: nextProject, secrets: {
        notion: "ntn_second", gwUrl: "https://script.google.com/macros/s/second/exec", gwKey: "second_key",
      } }),
    });
    assert.equal((await nextSave.json()).ok, true);
    const activate = await fetch(`${ctx.base}/api/projects/active`, {
      method: "POST", headers: { origin: ctx.base, "content-type": "application/json" },
      body: JSON.stringify({ projectId: nextProject.id }),
    });
    assert.equal((await activate.json()).activeProjectId, nextProject.id);
    const oldTabHello = await fetch(`${ctx.base}/api/agent`, {
      method: "POST", headers: { origin: "https://arena.ai", "content-type": "application/json" },
      body: JSON.stringify({ action: "hello", account: "creative36711@gmail.com", tab: "old-project-tab", scriptVersion: "1.34.1",
        projectId: project.id, projectName: project.name, localBusy: false }),
    });
    const selection = await oldTabHello.json();
    assert.equal(selection.projectSelection.project.id, nextProject.id);
    assert.equal(selection.projectSelection.credentials.notion, "ntn_second");
    assert.equal(selection.projectSettings, undefined, "old profile does not receive itself as active settings");
    assert.equal((await ctx.service.snapshot()).scriptClients.find((item) => item.tab === "old-project-tab").projectApproved, false,
      "server blocks old-profile tabs from new work during switch");

    await fetch(`${ctx.base}/api/projects`, {
      method: "POST", headers: { origin: ctx.base, "content-type": "application/json" },
      body: JSON.stringify({ profile: nextProject, secrets: {}, clearSecrets: true }),
    });
    const clearedHello = await fetch(`${ctx.base}/api/agent`, {
      method: "POST", headers: { origin: "https://arena.ai", "content-type": "application/json" },
      body: JSON.stringify({ action: "hello", account: "creative36711@gmail.com", tab: "active-cleared-tab", scriptVersion: "1.34.1",
        projectId: nextProject.id, projectName: nextProject.name, projectConfigUpdatedAt: "", projectApproved: true, localBusy: false }),
    });
    const cleared = await clearedHello.json();
    assert.equal(cleared.projectSettingsUnavailable.projectId, nextProject.id);
    assert.equal((await ctx.service.snapshot()).scriptClients.find((item) => item.tab === "active-cleared-tab").projectApproved, false,
      "clearing local credentials revokes project approval before future work");

    const deniedSwitch = await fetch(`${ctx.base}/api/projects/active`, {
      method: "POST", headers: { origin: "https://evil.example", "content-type": "application/json" },
      body: JSON.stringify({ projectId: project.id }),
    });
    assert.equal(deniedSwitch.status, 403);
  } finally { await ctx.close(); }
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

    assert.match(html, /id="btn-notion-net"[^>]*>Проверить сеть/, "видимая кнопка проверки сети без токена названа прямо");

    const js = await (await fetch(`${ctx.base}/app.js`)).text();
    // Токен уходит на свой маршрут и без перезапуска службы.
    assert.match(js, /\/api\/notion-token/);
    // После принятия токена прячется только поле с кнопкой проверки: строка
    // целиком остаётся, иначе «Роли в книгу» и «Диагностика» недоступны
    // ровно в момент успеха.
    assert.match(js, /shot\.notion\?\.ready \? "none"/, "поле токена скрывается при готовом Notion");
    assert.doesNotMatch(js, /shot\.demo \|\| shot\.notion\?\.ready \? "none"/,
      "строка целиком при готовом Notion не прячется");
    // Выход из зависшего запроса хода: пауза в ScriptCat не должна делать
    // пульт нерабочим на 15 минут жизни запроса.
    assert.match(js, /retry-turn/, "кнопка «Запросить ход заново»");
    // Ход, который вкладка держит, — не повод запирать пульт: «Дожать ход»
    // применяет уже полученный ответ Координатора.
    assert.match(js, /nudge/, "кнопка «Дожать ход»");
    assert.match(js, /Дожать ход/);
    assert.doesNotMatch(js, /не нажимайте «Шаг» повторно/i, "прежний запрет снят");
    assert.doesNotMatch(js, /Не сбрасывайте его и не запускайте дубликат/);
    assert.match(js, /Запросить ход заново/);
    assert.match(js, /\/api\/net-deep/, "диагностика по звеньям");
    assert.match(js, /if \(!response\.ok\) throw new Error\(data\.why \|\| `HTTP \$\{response\.status\}`\)/,
      "HTTP failure from network diagnostics is shown instead of rendering an empty report");
    assert.match(js, /Array\.isArray\(data\.steps\)/, "empty or malformed diagnostics are reported explicitly");
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
