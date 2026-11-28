// Поведенческий контур provisioning (D-024): задание службы Relay само
// разрешает создание, админ-роли и согласования нет. Проверяем create/replace,
// conflict, rename failure, автоактивацию, фиксированный первый промпт и URL из
// адресной строки.
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { makeWorld, UUID, ADMIN, CAND, OLD, NEW, OTHER } from './helpers/provision-flow-env.mjs';

// Задание службы: роль есть в «Ролях», агента в контейнере нет.
async function relayTask(env, over = {}) {
  return env.api.provisionStartRelayTask({ roleName: 'Executor Core', slotId: 'worker-2', queueId: 'relay-q-17', ...over });
}
// Шаги создания: /agent → repo+промпт → URL из адресной строки → rename/Notion.
async function runJob(env) {
  env.world.pendingReplies = [];
  await env.api.consumeProvision(); // создание: уход на /agent (или повторный шаг)
  await env.api.consumeProvision(); // repo, фиксированный промпт, новый адрес
  await env.api.consumeProvision(); // URL взят из адресной строки
  env.world.pendingReplies = [{ raw: 'assistant reply' }];
  await env.api.consumeProvision(); // первый ответ → rename
  await env.api.consumeProvision(); // отчёт Relay / Notion + активация
  await env.api.consumeProvision(); // закрыть локальное задание
}

test('create: задание Relay → агент → фиксированный первый промпт → URL → rename', async () => {
  const env = makeWorld();
  env.world.pages.get(CAND).status = 'Активна';
  await relayTask(env);
  await runJob(env);
  const { world, store } = env;
  assert.equal(store.get(world.K.provisionRequest), null, 'локальное задание закрыто');
  assert.equal(world.pages.get(CAND).url, '', 'Relay-экземпляр не перезаписывает Agent URL роли в Notion');
  assert.deepEqual(world.renames, [{ uuid: NEW, name: 'Executor Core' }]);
  assert.deepEqual(world.delivers, [env.probe], 'первый промпт ровно один и фиксированный');
  assert.match(env.probe, /test\.jpg/);
  assert.equal(world.pages.get(CAND).agentState, 'запрошен', 'Agent State ролью не управляет');
  assert.equal(store.get(world.K.pending), undefined, 'K.pending не тронут');
  assert.equal(store.get(world.K.expect), undefined, 'K.expect не тронут');
  const events = env.api.provisionState().journal.map((e) => e.event);
  for (const e of ['provision_job_started', 'provision_repo_selected', 'provision_bootstrap_sent', 'provision_url_captured', 'provision_renamed', 'provision_job_done']) {
    assert.ok(events.includes(e), e);
  }
  assert.ok(!events.includes('provision_approved'), 'согласования больше нет');
});

test('задание Relay без админ-слота и без «включённости» профиля работает', async () => {
  // D-024: прежняя модель требовала `agentProvisionEnabled`, allowlist и
  // активную админ-роль с `Agent Admin=true`. Ни одного из этих условий в
  // профиле и в строках нет — создание всё равно идёт.
  const env = makeWorld({ cfg: { agentProvisionEnabled: false, agentProvisionRepoAllowlist: [] } });
  env.world.pages.get(CAND).status = 'Активна';
  env.world.pages.get(CAND).agentState = 'не требуется';
  env.world.pages.get(CAND).repo = 'outside/allowlist';
  env.world.pages.delete(ADMIN); // никакой админ-роли в базе нет вовсе
  assert.equal(await relayTask(env), true);
  await runJob(env);
  const report = env.world.relayReports.find((item) => item.action === 'agent');
  assert.ok(report, 'адрес отправлен службе действием agent');
  assert.equal(report.url, `https://arena.ai/agent/${NEW}`);
  assert.equal(report.ok, true);
  assert.deepEqual(env.world.repoSelects, ['outside/allowlist'], 'repo берётся из строки, allowlist не спрашивается');
});

test('replace: Previous Agent URL и архив старого, не нового', async () => {
  const env = makeWorld({ replace: true });
  env.world.pages.get(CAND).status = 'Активна';
  env.world.pages.get(CAND).agentState = 'не требуется';
  // Задание создаёт новый экземпляр; замена — это когда у роли уже есть адрес.
  // В новой модели адрес строки — наследие, а не повод не создавать пару.
  await relayTask(env);
  await runJob(env);
  assert.equal(env.api.provisionRequestState(), null);
  assert.deepEqual(env.world.archives, [], 'Relay-экземпляр чужую сессию не архивирует');
});

test('экземпляр Relay не пишет Agent URL роли, даже если строку изменили', async () => {
  // У роли много адресов — по одному на контейнер (D-015). Поэтому пара
  // (роль, слот) живёт в «Экземплярах», а «Agent URL» строки Relay-контур не
  // трогает: чужая правка там не конфликт, а норма.
  const env = makeWorld();
  env.world.pages.get(CAND).status = 'Активна';
  env.world.pages.get(CAND).agentState = 'не требуется';
  await relayTask(env);
  env.world.pages.get(CAND).url = `https://arena.ai/agent/${OTHER}`;
  env.world.pendingReplies = [{ raw: 'assistant reply' }];
  await env.api.consumeProvision();
  const report = env.world.relayReports.find((item) => item.action === 'agent');
  assert.equal(report.ok, true);
  assert.equal(report.url, `https://arena.ai/agent/${NEW}`, 'службе ушёл адрес нового экземпляра');
  assert.equal(env.world.pages.get(CAND).url, `https://arena.ai/agent/${OTHER}`, 'строка роли не перезаписана');
  assert.deepEqual(env.world.patches, [], 'Notion не патчится в парном контуре');
});

test('остаток прежней модели (non-relay запрос) закрывается, ничего не создавая', async () => {
  const env = makeWorld();
  env.store.set(env.world.K.provisionRequest, {
    requestId: UUID(77), state: 'awaiting', adminPageId: ADMIN, adminAgentId: ADMIN,
    adminRoleName: 'Admin Coord', adminUrl: `https://arena.ai/agent/${ADMIN}`,
    candidates: [{ rolePageId: CAND, roleName: 'Executor Core', fn: 'Executor', repo: 'owner/repo', action: 'create' }],
    jobIds: [], createdAt: '2026-11-04T00:00:00.000Z',
  });
  assert.equal(await env.api.consumeProvision(), false);
  assert.equal(env.api.provisionRequestState(), null, 'запрос согласования не держит очередь');
  assert.deepEqual(env.world.delivers, [], 'ничего не отправлено');
  assert.deepEqual(env.world.relayReports, [], 'и службе ничего не ушло');
  const events = env.api.provisionState().journal.map((e) => e.event);
  assert.ok(events.includes('provision_noop'), 'остаток назван в журнале');
});

test('rename failure: URL сохранён, новой сессии нет', async () => {
  const env = makeWorld();
  env.world.pages.get(CAND).status = 'Активна';
  env.world.pages.get(CAND).agentState = 'не требуется';
  await relayTask(env);
  env.world.renameFails = true;
  env.world.pendingReplies = [{ raw: 'assistant reply' }];
  await env.api.consumeProvision(); // rename падает → job в relay_failed_pending
  await env.api.consumeProvision(); // причина уходит службе
  const refusal = env.world.relayReports.find((item) => item.action === 'agent' && item.ok === false);
  assert.ok(refusal, 'отказ rename отправлен службе');
  assert.match(refusal.note, /rename/i, 'причина названа');
  assert.equal(env.location.pathname, `/agent/${NEW}`);
  // URL сохранён до rename, поэтому переживает отказ и лежит в истории job:
  // после «не удалось переименовать» задание закрыто, но адрес не потерян.
  // В истории job остаётся и адрес, и причина: перезапуск не должен начинать
  // вторую сессию «с нуля», а человек видит, почему имя не сменилось.
  const job = env.api.provisionState().jobs.find((item) => item.relayQueueId === 'relay-q-17')
    || env.api.provisionState().jobs.at(-1);
  assert.equal(job.agentUrl, `https://arena.ai/agent/${NEW}`);
  assert.match(job.error, /rename/i, 'причина отказа записана в job');
});

test('автоактивация не блокируется составом ролей (нет Reviewer — не отказ)', async () => {
  const env = makeWorld();
  env.world.pages.delete(UUID(3)); // ни одного Reviewer
  env.world.pages.get(CAND).status = 'Активна';
  env.world.pages.get(CAND).agentState = 'не требуется';
  await relayTask(env);
  await runJob(env);
  assert.deepEqual(env.world.pauses, [], 'пауз из-за состава нет');
  assert.equal(env.api.provisionRequestState(), null, 'задание завершено');
  assert.equal(env.world.pages.get(CAND).status, 'Активна', 'Статус роли не переписывается');
});

test('не стартует при активном командном ходе и не трогает K.pending/K.expect', async () => {
  const env = makeWorld();
  env.store.set(env.world.K.pending, { roleName: 'Executor Core' });
  await relayTask(env);
  // Свой ход виден вкладочному контуру: шаг не начинается.
  assert.match(env.api.provisionIdleReason(), /командный ход/);
  assert.deepEqual(env.store.get(env.world.K.pending), { roleName: 'Executor Core' });
});

test('отказ по чужому контейнеру называется и уходит в очередь, а не в паузу', async () => {
  const env = makeWorld();
  await relayTask(env, { slotId: 'worker-3' }); // вкладка опознана как worker-2
  const report = env.world.relayReports.find((item) => item.action === 'agent');
  assert.ok(report, 'служба получила отказ');
  assert.equal(report.ok, false);
  assert.match(report.note, /worker-3/);
  assert.deepEqual(env.world.pauses, [], 'общий автоцикл из-за контейнера не падает');
});

test('роль без разобранного repo не стопорит создание агента', async () => {
  const env = makeWorld();
  env.world.pages.get(CAND).repo = 'не repo';
  await relayTask(env);
  await runJob(env);
  assert.deepEqual(env.world.repoSelects, [], 'repo не выбирается — его нет');
  const report = env.world.relayReports.find((item) => item.action === 'agent');
  assert.equal(report.url, `https://arena.ai/agent/${NEW}`, 'адрес пары всё равно записан');
});

test('Maintainer через задание не создаётся', async () => {
  const env = makeWorld();
  env.world.pages.get(CAND).fn = 'Maintainer';
  await relayTask(env);
  const report = env.world.relayReports.find((item) => item.action === 'agent');
  assert.equal(report.ok, false);
  assert.match(report.note, /функция/);
});
