// Ядро provisioning (D-024): кандидат по заданию службы, фиксированный первый
// промпт, суточный лимит и журнал. Админ-роли, allowlist и маркера одобрения
// больше нет — поэтому и проверять здесь нечего.
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, '..', 'src', '31-provision-core.js'), 'utf8');
const UUID = (n) => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`;
const norm = (s) => String(s || '').replace(/-/g, '').toLowerCase();

function loadCore(cfg = {}) {
  const store = new Map();
  const GM_getValue = (k, d) => (store.has(k) ? store.get(k) : d);
  const GM_setValue = (k, v) => store.set(k, v);
  let seq = 100;
  const defaults = {
    agentProvisionMaxJobs: 3, agentProvisionDailyMax: 5, agentBootstrapWaitMs: 600000,
    agentUrlWaitMs: 30000, agentRenameAttempts: 3, agentProvisionAutoActivate: true, agentProvisionArchiveOld: true,
  };
  const C = { ...defaults, ...cfg };
  const K = { provision: 'provision', provisionRequest: 'request', provisionLock: 'lock' };
  const api = new Function('GM_getValue', 'GM_setValue', 'C', 'K', 'uid', 'nowIso', 'norm', 'dbg', 'normalizeProvisionConfig', 'sessionStorage',
    `${source}\nreturn { normalizeProvisionRepo, provisionBootstrapClean, provisionBootstrapPrompt, PROVISION_PROBE_PROMPT, provisionCandidateFromRow, provisionCandidates, provisionState, saveProvisionState, provisionEvent, provisionDailyAllow, provisionDailyConsume, provisionNewJob, provisionSaveJob, provisionActiveJob, saveProvisionRequest, provisionRequestState, PROVISION_EVENTS, PROVISION_STATES };`)(
    GM_getValue, GM_setValue, C, K, () => UUID(++seq), () => '2026-11-04T00:00:00.000Z', norm, () => {}, (p) => ({ ...defaults, ...p }), { getItem: () => 'tab', setItem: () => {} });
  return { api, store, C };
}
const row = (over = {}) => ({
  id: UUID(1), pageId: UUID(1), name: 'Executor Core', fn: 'Executor', status: 'Ждёт',
  url: '', repo: 'owner/repo', agentState: 'запрошен', ...over,
});

test('repo нормализуется в точный owner/repo', () => {
  const { api } = loadCore();
  assert.equal(api.normalizeProvisionRepo('https://github.com/Owner/Repo.git'), 'owner/repo');
  assert.equal(api.normalizeProvisionRepo(' owner/repo/ '), 'owner/repo');
  assert.equal(api.normalizeProvisionRepo('owner/repo/extra'), '');
  assert.equal(api.normalizeProvisionRepo('owner/../repo'), '');
});

test('D-024: первый промпт фиксирован и не настраивается профилем', () => {
  const { api, C } = loadCore();
  const probe = api.provisionBootstrapPrompt();
  assert.equal(probe, api.PROVISION_PROBE_PROMPT, 'пробник берётся из константы, а не из профиля');
  assert.match(probe, /test\.jpg/);
  assert.match(probe, /https:\/\/github\.com\/Creative36711\/test/);
  assert.match(probe, /Если у тебя нет функции визуального распознавания, скажи прямо\./);
  // Старое значение профиля игнорируется: даже если оно осталось в JSON,
  // подставляется фиксированный текст. Иначе «блокер» вернулся бы молча.
  const legacy = loadCore({ agentBootstrapPrompt: 'старый текст', agentProvisionEnabled: false });
  assert.equal(legacy.api.provisionBootstrapPrompt(), api.PROVISION_PROBE_PROMPT);
  assert.equal(legacy.C.agentBootstrapPrompt, 'старый текст', 'ключ не переписывается, просто не читается');
  for (const bad of ['CF_AGENT_RESULT', 'Notion page', 'aux-workspace', 'REGULATION', 'WARDEN', 'ghp_abcdef123456', 'https://app.notion.so/x']) {
    assert.equal(api.provisionBootstrapClean(bad), false, bad);
  }
  assert.ok(api.provisionBootstrapClean(probe));
  assert.equal(C.agentProvisionEnabled, undefined, 'время-настройка «включён» удалена из профиля');
});

test('кандидат: create/replace без админ-флага, Agent State и allowlist', () => {
  const { api, C } = loadCore();
  const create = api.provisionCandidateFromRow(row(), C);
  assert.ok(create.ok);
  assert.equal(create.candidate.action, 'create');
  // «Agent State» больше не решает: роль, которую никто не «запрашивал», всё
  // равно получает агента по заданию службы.
  assert.ok(api.provisionCandidateFromRow(row({ agentState: 'не требуется' }), C).ok);
  // Админ-флаг тоже не читается: слот роли определяется функцией.
  assert.ok(api.provisionCandidateFromRow(row({ agentAdmin: true }), C).ok);
  const replace = api.provisionCandidateFromRow(row({ url: 'https://arena.ai/agent/' + UUID(9) }), C);
  assert.ok(replace.ok);
  assert.equal(replace.candidate.action, 'replace');
  assert.equal(replace.candidate.oldAgentUrl, 'https://arena.ai/agent/' + UUID(9));
  // Репозиторий вне прежнего allowlist созданию больше не мешает.
  assert.ok(api.provisionCandidateFromRow(row({ repo: 'other/repo' }), C).ok);
  // Роль без разобранного repo создаётся с пустым repo: адрес пары важнее.
  assert.equal(api.provisionCandidateFromRow(row({ repo: 'чепуха' }), C).candidate.repo, '');
  assert.equal(api.provisionCandidateFromRow(row({ fn: 'Maintainer' }), C).ok, false, 'закулисная роль не создаётся');
  assert.equal(api.provisionCandidateFromRow(null, C).ok, false);
  assert.equal(api.provisionCandidateFromRow(row(), C, { names: new Set([norm('Executor Core')]) }).ok, false);
});

test('кандидаты: активная работа по роли — не «отклонено», а «занято»', () => {
  const { api, C } = loadCore();
  const busy = api.provisionCandidates([row(), row({ id: UUID(4), pageId: UUID(4), name: 'Auditor Core', fn: 'Auditor' })], C,
    { names: new Set([norm('Executor Core')]) });
  assert.equal(busy.candidates.length, 1);
  assert.equal(busy.candidates[0].name, undefined);
  assert.equal(busy.candidates[0].roleName, 'Auditor Core');
  assert.deepEqual(busy.rejected, [], 'занятость — не причина отказа роли');
  const rejected = api.provisionCandidates([row({ fn: 'Maintainer' })], C, {});
  assert.equal(rejected.candidates.length, 0);
  assert.match(rejected.rejected[0].reason, /функция/);
});

test('суточный лимит и журнал без секретов', () => {
  const { api } = loadCore({ agentProvisionDailyMax: 1 });
  assert.ok(api.provisionDailyAllow());
  api.provisionDailyConsume();
  assert.equal(api.provisionDailyAllow(), false);
  api.provisionEvent('provision_job_started', { requestId: UUID(50), jobId: UUID(60), rolePageId: UUID(1), repo: 'owner/repo', step: 'validated', reason: 'ok' });
  const state = api.provisionState();
  assert.equal(state.journal.length, 1);
  assert.equal(state.journal[0].event, 'provision_job_started');
  // 15 = прежние 18 минус три события согласования (request_sent / approved /
  // rejected): согласовывать больше нечего, а журнал обязан называть только
  // то, что действительно случается.
  assert.equal(api.PROVISION_EVENTS.length, 15);
  assert.ok(!api.PROVISION_EVENTS.includes('provision_approved'));
  assert.ok(!api.PROVISION_EVENTS.includes('provision_request_sent'));
  assert.ok(api.PROVISION_STATES.includes('url_captured'));
  assert.equal(api.PROVISION_PROBE_PROMPT.includes('ntn_'), false);
});

test('job персистится и восстанавливается по requestId', () => {
  const { api, C } = loadCore();
  const candidate = api.provisionCandidateFromRow(row(), C).candidate;
  const job = api.provisionNewJob(candidate, UUID(50));
  api.provisionSaveJob(job);
  api.saveProvisionRequest({ requestId: UUID(50), jobIds: [job.id], state: 'approved' });
  assert.equal(api.provisionActiveJob().id, job.id);
  const updated = api.provisionSaveJob({ ...job, state: 'url_captured', agentUrl: 'https://arena.ai/agent/' + UUID(7) });
  assert.equal(api.provisionActiveJob().state, 'url_captured');
  assert.equal(updated.agentUrl, 'https://arena.ai/agent/' + UUID(7));
});
