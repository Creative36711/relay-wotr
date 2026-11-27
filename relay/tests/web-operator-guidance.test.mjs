import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [app, html] = await Promise.all([
  readFile(new URL("../web/app.js", import.meta.url), "utf8"),
  readFile(new URL("../web/index.html", import.meta.url), "utf8"),
]);
const start = app.indexOf("function announceAction(");
const end = app.indexOf("const fmtTime =", start);
assert.ok(start >= 0 && end > start, "operator guidance helpers are present");
const helpers = new Function(`let projectProfiles = []; ${app.slice(start, end)}; return { operatorGuidance, diagnosticReport, safeDiagnosticEventData, setProjectProfiles(value) { projectProfiles = value; } };`)();

const snapshot = (overrides = {}) => ({
  demo: false,
  paused: false,
  mode: "auto",
  counts: { waiting: 0, inFlight: 0, blocked: 0, slots: 4 },
  slots: [{ slotId: "admin", admin: true, container: "arena-creative", state: "свободен", runs: [] }],
  scriptClients: [],
  turnRequest: null,
  events: [],
  ...overrides,
});

test("unfinished heal + outstanding coordinator request gets clear safe guidance", () => {
  const shot = snapshot({
    scriptClients: [{ slotId: "admin", localBusy: true, localWaiting: "expect:heal", scriptVersion: "1.34.1" }],
    turnRequest: { id: "q-test-123", claimed: false },
  });
  const result = helpers.operatorGuidance(shot);
  assert.equal(result.canStep, false);
  assert.match(result.title, /ScriptCat удерживает опрос/);
  assert.match(result.detail, /разбор предыдущей ошибки/);
  assert.match(result.detail, /q-test-123/);
  assert.match(result.detail, /Не нажимайте «Шаг» повторно/);
});

test("project permission block is shown before a coordinator request and disables futile Step retries", () => {
  helpers.setProjectProfiles([]);
  const result = helpers.operatorGuidance(snapshot({
    scriptClients: [{ slotId: "admin", projectId: "wotr-1", projectName: "WOTR", projectApproved: false, projectBlockReason: "unapproved" }],
    turnRequest: { id: "q-blocked", claimed: false },
  }));
  assert.equal(result.canStep, false);
  assert.equal(result.title, "Проект заблокировал запуск");
  assert.match(result.detail, /WOTR/);
  assert.match(result.detail, /проверка допуска/);
  assert.doesNotMatch(result.detail, /q-blocked/);
});

test("approval failure shows its actual reason instead of a generic settings hint", () => {
  helpers.setProjectProfiles([]);
  const result = helpers.operatorGuidance(snapshot({
    scriptClients: [{ slotId: "admin", projectId: "wotr-1", projectName: "WOTR", projectApproved: false,
      projectBlockReason: "unapproved", projectApprovalFailure: "Drive: папка проекта недоступна" }],
  }));
  assert.equal(result.canStep, false);
  assert.match(result.detail, /Drive: папка проекта недоступна/);
  assert.doesNotMatch(result.detail, /проверьте настройки/i);
});

test("missing profile credentials identify the exact fields and next action", () => {
  helpers.setProjectProfiles([{ id: "wotr-1", secretStatus: { notion: false, gwUrl: false, gwKey: false } }]);
  const result = helpers.operatorGuidance(snapshot({
    scriptClients: [{ slotId: "admin", projectId: "wotr-1", projectName: "WOTR", projectApproved: false, projectBlockReason: "unapproved" }],
  }));
  assert.equal(result.canStep, false);
  assert.equal(result.title, "Для проекта не заданы подключения");
  assert.match(result.detail, /Notion token, Drive Gateway URL, Drive Gateway key/);
  assert.match(result.detail, /синхронизации сохранённых BAT\/ScriptCat настроек/);
});

test("an existing turn request blocks duplicate manual Step even without a local hold", () => {
  const result = helpers.operatorGuidance(snapshot({ turnRequest: { id: "q-existing", claimed: false } }));
  assert.equal(result.canStep, false);
  assert.match(result.detail, /q-existing/);
});

test("auto mode and manual Step remain available when there is no hold or outstanding request", () => {
  const result = helpers.operatorGuidance(snapshot());
  assert.equal(result.canStep, true);
  assert.match(result.title, /работает автоматически/);
});

test("support report includes project gate state without exposing connection secrets", () => {
  const report = helpers.diagnosticReport(snapshot({
    scriptClients: [{
      slotId: "admin", projectId: "wotr-1", projectName: "WOTR",
      projectApproved: false, projectBlockReason: "unapproved", projectApprovalFailure: "Drive: [TOKEN REDACTED]", secret: "ntn_sensitive-token",
    }],
  }));
  const payload = JSON.parse(report.slice(report.indexOf("\n") + 1));
  assert.equal(payload.clients[0].projectApproved, false);
  assert.equal(payload.clients[0].projectName, "WOTR");
  assert.equal(payload.clients[0].projectBlockReason, "unapproved");
  assert.equal(payload.clients[0].projectApprovalFailure, "Drive: [TOKEN REDACTED]");
  assert.equal("secret" in payload.clients[0], false);
  assert.doesNotMatch(report, /ntn_sensitive-token/);
});

test("support report captures coordinator blockers, pult network history and safe local hold details", () => {
  const report = helpers.diagnosticReport(snapshot({
    version: "1.34.1",
    cycle: { turn: "coordinator", round: 2 },
    lastStep: { why: "ожидает admin-вкладку" },
    scriptClients: [{ slotId: "admin", localBusy: true, localWaiting: "expect:heal", scriptVersion: "1.33.1" }],
    turnRequest: { id: "q-support-1", createdAt: "2026-11-27T11:33:51.000Z", claimed: false },
    events: [{
      at: "2026-11-27T12:00:00.000Z", slot: "admin", kind: "state", level: "warn",
      text: "token ntn_1234567890abcdef sent to owner@example.com",
      data: JSON.stringify({
        relayClientState: true, localBusy: true, localWaiting: "expect:heal",
        localState: {
          expect: { kind: "heal", roleName: "Maintainer", turnId: "heal-turn-1", at: 1795780000000, text: "private prompt" },
          pending: null,
          secretField: "must be omitted",
        },
      }),
    }],
  }), [{ at: Date.parse("2026-11-27T12:01:00.000Z"), count: 2, text: "книга не ответила: мост за 45000 мс" }]);
  const payload = JSON.parse(report.slice(report.indexOf("\n") + 1));
  assert.equal(payload.cycle.turn, "coordinator");
  assert.equal(payload.turnRequest.id, "q-support-1");
  assert.equal(payload.recentEvents[0].data.localState.expect.roleName, "Maintainer");
  assert.equal(payload.recentEvents[0].data.localState.expect.turnId, "heal-turn-1");
  assert.equal("text" in payload.recentEvents[0].data.localState.expect, false, "prompt text is not exported");
  assert.equal("secretField" in payload.recentEvents[0].data.localState, false, "unknown fields are not exported");
  assert.match(report, /книга не ответила: мост за 45000 мс/);
  assert.match(report, /\[TOKEN REDACTED\]/);
  assert.match(report, /\[EMAIL REDACTED\]/);
});

test("local client state diagnostics whitelist fields and never copy prompt text", () => {
  const safe = helpers.safeDiagnosticEventData(JSON.stringify({
    relayClientState: true, localBusy: true, localWaiting: "expect:heal",
    localState: { expect: { kind: "heal", roleId: "role-123", text: "private" }, pending: null },
    token: "private-token",
  }));
  assert.equal(safe.localState.expect.kind, "heal");
  assert.equal(safe.localState.expect.roleId, "role-123");
  assert.equal("text" in safe.localState.expect, false);
  assert.equal("token" in safe, false);
});
test("operator status and copy-diagnostics control are visible and announced accessibly", () => {
  assert.match(html, /id="operator-card"/);
  assert.match(html, /<details class="diagnostic-details">[\s\S]*?id="btn-copy-diagnostics"/);
  assert.match(html, /id="action-feedback"[^>]*role="status"[^>]*aria-live="polite"/);
});

test("secondary data and legacy service setup are collapsed; required project inputs stay visible", () => {
  for (const id of ["setup-panel", "slots-panel", "queue-panel", "events-panel", "project-json-details"])
    assert.match(html, new RegExp(`<details[^>]*id="${id}"`), `${id} is collapsible`);
  for (const id of ["project-notion", "project-gw-url", "project-gw-key", "project-credential-status"])
    assert.match(html, new RegExp(`id="${id}"`), `${id} remains immediately visible/actionable`);
  assert.match(html, /Для допуска проекта используйте токен Notion и Drive Gateway в карточке «Проект»/);
  assert.match(html, /Drive file Gateway URL/);
  assert.match(html, /не Gateway таблицы Google Sheets/);
  assert.match(html, /BAT\/ScriptCat token подхватится автоматически/);
});

test("Relay pult can request project validation without starting the auto-cycle", () => {
  assert.match(html, /id="btn-approve-project"/);
  assert.match(app, /client\.projectBlockReason === "unapproved"/);
  assert.match(app, /\/api\/project-approval/);
  assert.match(app, /Автоцикл не включается/);
});
