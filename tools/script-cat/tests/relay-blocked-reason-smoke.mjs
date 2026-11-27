// Coordinator blocked-reason copy must describe structural role issues only.
import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';

const src = readFileSync(new URL('../relay.user.js', import.meta.url), 'utf8');
const from = src.indexOf('  function blockedReason(');
const to = src.indexOf('\n  }\n', from);
assert.ok(from > 0 && to > from, 'blockedReason exists');
const blockedReason = new Function(
  'norm', 'rt', 'taskTitle', 'taskRole',
  `${src.slice(from, to + 4)}; return blockedReason;`,
)(
  (x) => String(x || '').replace(/-/g, '').toLowerCase(),
  (p) => (p?.rich_text || p?.title || []).map((x) => x.plain_text || x.text?.content || '').join(''),
  (card) => card.properties['Запрос'].title[0].text.content,
  (card) => card.properties['Кому']?.select?.name || '',
);
const card = (title, who) => ({ properties: {
  'Запрос': { title: [{ text: { content: title } }] },
  'Кому': { select: who ? { name: who } : null },
} });
const directory = [
  { name: 'Tools', fn: 'Executor', status: 'Ждёт', url: '' },
  { name: 'Turn Runtime', fn: 'Auditor', status: 'Активна', url: 'https://arena.ai/agent/worker' },
  { name: 'Reviewer', fn: 'Reviewer', status: 'Активна', url: 'https://arena.ai/agent/reviewer' },
];
const queue = {
  summary: '0 Submitted, 0 Running, 0 Ready, 2 Rework, 1 Draft',
  draft: [card('CASEA-2.15 · kit', 'Tools')],
  rework: [card('CASEA-2.3 · audit', 'Turn Runtime')],
};
const openRow = { properties: {
  'Вопрос': { title: [{ plain_text: 'Role decision?' }] },
  'По умолчанию': { rich_text: [{ plain_text: 'Leave phase to owner' }] },
  'Срок': { date: { start: '2026-10-26T16:17:00.000Z' } },
} };

const inactive = blockedReason({ need: 'Tools', directory, queue });
assert.match(inactive, /Рабочая роль «Tools» определена \(Executor\)/);
assert.match(inactive, /Legacy Status\/Agent State и пустой worker URL не блокируют назначение/);
assert.match(inactive, /Relay выберет слот\/аккаунт, учтёт квоту/);
assert.doesNotMatch(inactive, /заполните «Agent URL»|поставьте «Статус» = «Активна»|создайте агента|активируйте/);

const missing = blockedReason({ need: 'Ghost', directory, queue });
assert.match(missing, /Роли «Ghost» в базе «Роли» нет/);
assert.match(missing, /дефект определения роли/);
assert.doesNotMatch(missing, /заполните «Agent URL»|создайте агента в Arena|поставьте «Статус»/);

const wrongFunction = blockedReason({ need: 'Reviewer', directory, queue });
assert.match(wrongFunction, /Function «Reviewer» не является Executor\/Auditor/);

const unnamed = blockedReason({ need: '', directory, queue, open: [openRow], ask: 'Role decision?', asked: true });
assert.match(unnamed, /Координатор остановил цикл, но роль не назвал/);
assert.doesNotMatch(unnamed, /черновик «CASEA-2\.15 · kit» назначен роли/,
  'a structurally valid worker role is not called missing because status or URL is blank');
assert.match(unnamed, /Rework — это не «нет роли»/);
assert.match(unnamed, /Вопрос об этом уже задан: «Role decision\?»/);
assert.match(unnamed, /Вопрос записан в базу «Обратная связь»/);
assert.match(unnamed, /Status\/Agent State\/worker URL не являются причиной остановки Coordinator/);
assert.match(unnamed, /Relay решает фактические слот, квоту и provisioning/);

const noDirectory = blockedReason({ need: 'Tools', directory: [] });
assert.match(noDirectory, /базе «Роли» нет/);
const lostAsk = blockedReason({ need: '', directory, queue, ask: 'Need input?', asked: false });
assert.match(lostAsk, /Вопрос в.*не записался.*только в этом сообщении/);

console.log('OK: blocked reason distinguishes missing/invalid role definition from Relay-managed phase, URL, slot and provisioning');
