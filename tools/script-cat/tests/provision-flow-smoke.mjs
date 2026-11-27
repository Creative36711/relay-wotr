// Поведенческий контур provisioning: create/replace, одобрение, conflict,
// rename failure, блокировка активации, запрет старта при активном ходе.
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { makeWorld, UUID, ADMIN, CAND, OLD, NEW, OTHER } from './helpers/provision-flow-env.mjs';

async function toAwaiting(env) {
  await env.api.consumeProvision(); // prepared → страница админа
  await env.api.consumeProvision(); // awaiting
}
async function runJob(env) {
  await env.api.consumeProvision(); // approved → creating (/agent)
  await env.api.consumeProvision(); // repo_selected → bootstrap_sent (URL появился)
  await env.api.consumeProvision(); // url_captured
  env.world.pendingReplies = [{ raw: 'assistant reply' }];
  await env.api.consumeProvision(); // rename → Notion → activation → done
  await env.api.consumeProvision(); // finish request
}

test('create: одобрение → URL до rename → Notion → автоактивация → Кому аддитивно', async () => {
  const env = makeWorld();
  await toAwaiting(env);
  env.approve([env.candidateJob('create')]);
  await env.api.consumeProvision(); // approved
  env.world.pendingReplies = [];
  await runJob(env);
  const { world, store, session } = env;
  assert.equal(store.get(env.world.K.provisionRequest), null);
  assert.equal(world.pages.get(CAND).url, `https://arena.ai/agent/${NEW}`);
  assert.equal(world.pages.get(CAND).status, 'Активна');
  assert.equal(world.pages.get(CAND).agentState, 'создан');
  assert.ok(world.options.includes('Executor Core'), 'вариант Кому добавлен аддитивно');
  assert.equal(world.schemaPatches.length, 1);
  assert.deepEqual(world.archives, [], 'create не архивирует');
  assert.deepEqual(world.renames, [{ uuid: NEW, name: 'Executor Core' }]);
  assert.ok(world.delivers.includes('PROVISION_PROMPT'));
  assert.equal(store.get(env.world.K.pending), undefined, 'K.pending не тронут');
  assert.equal(store.get(env.world.K.expect), undefined, 'K.expect не тронут');
  assert.equal(session.get(env.world.K.auto), '1', 'автоцикл восстановлен');
  const events = env.api.provisionState().journal.map((e) => e.event);
  for (const e of ['provision_request_sent', 'provision_approved', 'provision_job_started', 'provision_repo_selected', 'provision_bootstrap_sent', 'provision_url_captured', 'provision_renamed', 'provision_notion_updated', 'provision_activated', 'provision_job_done']) {
    assert.ok(events.includes(e), e);
  }
});

test('replace: Previous Agent URL и архив старого, не нового', async () => {
  const env = makeWorld({ replace: true });
  await toAwaiting(env);
  env.approve([env.candidateJob('replace')]);
  await env.api.consumeProvision();
  env.world.pendingReplies = [];
  await runJob(env);
  assert.equal(env.world.pages.get(CAND).previousAgentUrl, `https://arena.ai/agent/${OLD}`);
  assert.deepEqual(env.world.archives, [OLD]);
  assert.ok(!env.world.archives.includes(NEW));
});

test('conflict: чужой новый URL не перезаписывается', async () => {
  const env = makeWorld();
  await toAwaiting(env);
  env.approve([env.candidateJob('create')]);
  await env.api.consumeProvision();
  env.world.pendingReplies = [];
  env.world.pages.get(CAND).url = `https://arena.ai/agent/${OTHER}`;
  await env.api.consumeProvision();
  await env.api.consumeProvision();
  await env.api.consumeProvision();
  env.world.pendingReplies = [{ raw: 'assistant reply' }];
  await env.api.consumeProvision();
  assert.ok(env.world.pauses.some((p) => /conflict|изменён/i.test(p.reason)));
  assert.equal(env.world.pages.get(CAND).url, `https://arena.ai/agent/${OTHER}`);
  assert.equal(env.api.provisionActiveJob().agentUrl, `https://arena.ai/agent/${NEW}`);
});

test('rename failure: URL сохранён, новой сессии нет', async () => {
  const env = makeWorld();
  await toAwaiting(env);
  env.approve([env.candidateJob('create')]);
  await env.api.consumeProvision();
  env.world.pendingReplies = [];
  await env.api.consumeProvision();
  await env.api.consumeProvision();
  await env.api.consumeProvision();
  env.world.renameFails = true;
  env.world.pendingReplies = [{ raw: 'assistant reply' }];
  await env.api.consumeProvision();
  assert.ok(env.world.pauses.some((p) => /rename/i.test(p.reason)));
  assert.equal(env.location.pathname, `/agent/${NEW}`);
  assert.equal(env.api.provisionActiveJob().agentUrl, `https://arena.ai/agent/${NEW}`);
});

test('автоактивация блокируется без активного Reviewer; Статус остаётся Ждёт', async () => {
  const env = makeWorld();
  env.world.pages.delete(UUID(3));
  await toAwaiting(env);
  env.approve([env.candidateJob('create')]);
  await env.api.consumeProvision();
  env.world.pendingReplies = [];
  await runJob(env);
  assert.ok(env.world.pauses.some((p) => /Reviewer|активация/i.test(p.reason)));
  assert.equal(env.world.pages.get(CAND).status, 'Ждёт');
  assert.equal(env.world.pages.get(CAND).url, `https://arena.ai/agent/${NEW}`);
});

test('не стартует при активном командном ходе и не трогает K.pending/K.expect', async () => {
  const env = makeWorld();
  env.store.set(env.world.K.pending, { roleName: 'Executor Core' });
  const result = await env.api.consumeProvision();
  assert.equal(result, false);
  assert.equal(env.store.get(env.world.K.provisionRequest), undefined);
  assert.deepEqual(env.store.get(env.world.K.pending), { roleName: 'Executor Core' });
});

test('Relay-задание само авторизует создание экземпляра пары и отправляет URL обратно', async () => {
  const env = makeWorld({ cfg: { agentProvisionEnabled: false } });
  env.world.pages.get(CAND).status = 'Активна';
  env.world.pages.get(CAND).agentState = 'не требуется';

  await env.api.provisionStartRelayTask({ roleName: 'Executor Core', slotId: 'worker-2', queueId: 'relay-q-17' });
  await env.api.consumeProvision(); // создание новой Arena-сессии и bootstrap
  await env.api.consumeProvision(); // URL захвачен, ждём ответ bootstrap
  env.world.pendingReplies = [{ raw: 'assistant bootstrap reply' }];
  await env.api.consumeProvision(); // rename и отчёт Relay
  await env.api.consumeProvision(); // закрыть локальный request

  const report = env.world.relayReports.find((item) => item.action === 'agent');
  assert.ok(report, 'клиент отправил адрес через действие agent');
  assert.equal(report.role, 'Executor Core');
  assert.equal(report.slotId, 'worker-2');
  assert.equal(report.queueId, 'relay-q-17');
  assert.equal(report.url, `https://arena.ai/agent/${NEW}`);
  assert.equal(report.ok, true);
  assert.equal(env.world.pages.get(CAND).url, '', 'Relay-экземпляр не перезаписывает общий Agent URL роли в Notion');
  assert.equal(env.world.pages.get(CAND).agentState, 'не требуется', 'Agent State роли не меняется');
  assert.equal(env.world.patches.length, 0, 'Notion не патчится в парном Relay-контуре');
  assert.equal(env.store.get(env.world.K.pending), undefined, 'обычный ход не затронут');
  assert.equal(env.store.get(env.world.K.expect), undefined, 'ожидание обычного хода не затронуто');
  assert.equal(env.api.provisionRequestState(), null);
});

test('одобрение принимает только свежая админ-роль', async () => {
  const env = makeWorld();
  await toAwaiting(env);
  env.world.pages.get(ADMIN).agentAdmin = false;
  env.approve([env.candidateJob('create')]);
  await env.api.consumeProvision();
  assert.ok(env.world.pauses.some((p) => /админ|право/i.test(p.reason)));
  assert.equal(env.api.provisionRequestState().state, 'paused');
});

test('чужой request_id отклоняется', async () => {
  const env = makeWorld();
  await toAwaiting(env);
  env.world.markerObj = { request_id: UUID(999), jobs: [] };
  env.world.pendingReplies = [{ raw: 'CF_AGENT_PROVISION_RESULT {}' }];
  await env.api.consumeProvision();
  assert.ok(env.world.pauses.some((p) => /request_id|отклонён/i.test(p.reason)));
});
