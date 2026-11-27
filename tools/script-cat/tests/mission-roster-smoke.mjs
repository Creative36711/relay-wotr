// D-022: Coordinator выбирает роль и карточку; Relay отвечает за готовность
// worker-фазы, слот/аккаунт, лимит и ленивое создание (роль × слот).
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = join(here, '..', 'src');
const norm = (x) => String(x || '').replace(/-/g, '').toLowerCase();
const rosterSrc = readFileSync(join(srcDir, '42-roster.js'), 'utf8');
const rosterApi = new Function(
  'norm', 'taskRole',
  `${rosterSrc}\n return { missionRoster, rosterReason, rosterGate };`,
)(norm, (item) => item?.properties?.['Кому']?.select?.name || '');

const card = (seq, who) => ({ id: `card-${seq}`, properties: {
  'Запрос': { title: [{ plain_text: `Sample card A${seq}` }] },
  'Кому': who ? { select: { name: who } } : {},
  'Sequence': { number: seq },
} });
const roles = [
  { name: 'Coordinator', fn: 'Coordinator', status: 'Активна', url: 'https://arena.ai/agent/coordinator' },
  { name: 'Integration Auditor', fn: 'Auditor', status: 'Активна', url: '' },
];

// Неактивный/не созданный экземпляр — состояние транспорта, а не причина,
// по которой планировщик оставляет Draft или выдаёт next:blocked.
for (const status of ['Активна', 'Ждёт']) {
  const roster = rosterApi.missionRoster([card(3, 'Integration Auditor')], {
    directory: roles.map((role) => role.name === 'Integration Auditor' ? { ...role, status, url: '' } : role),
    recipientOptions: ['Integration Auditor'],
    instances: [],
  });
  assert.equal(roster.ok, true, `status=${status} plus empty worker URL must not gate a role assignment`);
  assert.deepEqual(roster.broken, []);
}

// Транспорт может создать URL после назначения; «Роли» нужна только для
// семантической Function и корректного имени в select «Кому».
const ready = rosterApi.rosterGate([card(3, 'Integration Auditor')], {
  directory: roles,
  recipientOptions: ['Integration Auditor'],
  instances: [],
});
assert.equal(ready.ok, true);
assert.equal(rosterApi.rosterGate([], { directory: roles }).ok, true, 'пустая очередь не некомплект');

// Настоящая структурная ошибка остаётся fail-closed — нет роли/Function.
const missing = rosterApi.rosterGate([card(1, 'Ghost')], {
  directory: roles,
  recipientOptions: ['Ghost'],
});
assert.equal(missing.ok, false);
assert.match(missing.reason, /Ghost/);
assert.match(missing.reason, /в базе «Роли» нет/);
assert.doesNotMatch(missing.reason, /Agent URL|создайте агента|Статус/);
const wrongFn = rosterApi.missionRoster([card(2, 'Coordinator')], { directory: roles });
assert.equal(wrongFn.ok, false, 'рабочую карточку нельзя назначить админ-функции');
assert.match(wrongFn.broken[0].gaps.join(' '), /не является рабочей/);

// Гейт не ложно называет неактивный статус или пустой worker URL.
const noGate = rosterApi.rosterReason(rosterApi.missionRoster([card(3, 'Integration Auditor')], {
  directory: [{ name: 'Integration Auditor', fn: 'Auditor', status: 'Ждёт', url: '' }],
  recipientOptions: ['Integration Auditor'],
  instances: [],
}));
assert.equal(noGate, '');

// decisionRoute получает полную директорию и направляет роль на транспорт даже
// если `roles()` (активный view) её не вернул. Reviewer остаётся запрещён.
const coordinatorSrc = readFileSync(join(srcDir, '23-coordinator.js'), 'utf8');
const routeFrom = coordinatorSrc.indexOf('  function decisionRoute(next,');
const routeTo = coordinatorSrc.indexOf('  // Свежие счётчики очереди', routeFrom);
const decisionRoute = new Function('norm', `${coordinatorSrc.slice(routeFrom, routeTo)}; return decisionRoute;`)(norm);
const routed = decisionRoute('Integration Auditor', {
  roles: [{ name: 'Coordinator', fn: 'Coordinator' }],
  directory: [{ name: 'Integration Auditor', fn: 'Auditor', status: 'Ждёт', url: '' }],
  readyRoles: ['Integration Auditor'],
});
assert.deepEqual(routed, { kind: 'dispatch', roleName: 'Integration Auditor' });
const reviewer = decisionRoute('Reviewer', {
  roles: [], directory: [{ name: 'Reviewer', fn: 'Reviewer', status: 'Активна' }],
  readyRoles: ['Reviewer'],
});
assert.equal(reviewer.kind, 'ask', 'Reviewer does not receive work cards');

// Все три prompt-слоя должны соблюдать разделение ответственности.
const blocks = readFileSync(join(srcDir, 'prompt-blocks.js'), 'utf8');
assert.match(blocks, /Не проверяй Status, worker URL\/Agent State, слот или квоту/);
assert.match(blocks, /Relay владеет доставкой: выбирает слоты\/аккаунты по квотам/);
assert.match(blocks, /Relay выбирает слот\/аккаунт с учётом квоты/);
assert.match(blocks, /создаёт пару роль×слот/);
assert.doesNotMatch(blocks, /состав ролей сверяй до выдачи: причина в скобках/);
assert.doesNotMatch(blocks, /Agent State = запрошен/);

const coordinatorRoleDoc = readFileSync(join(here, '..', '..', '..', 'docs', 'agents', 'roles', 'coordinator.md'), 'utf8');
assert.match(coordinatorRoleDoc, /chooses an enabled free worker slot/);
assert.match(coordinatorRoleDoc, /an empty worker URL and legacy role Status\/Agent State are not planning or dispatch prerequisites/);

console.log('OK: D-022 — Coordinator назначает роль без проверки статуса/worker URL; Relay выбирает аккаунт/слот, учитывает квоты и создаёт недостающую пару');
