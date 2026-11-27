// Документация подключения остаётся доступной после переноса/переименования папки.
// Это проверка ссылок и названий UI, а не запуск внешних сервисов.
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');
const guide = read('README-авторизация.md');
const docs = ['README.md', 'INSTALL.md', 'AGENT-SETUP.md', 'README-авторизация.md'];

for (const service of ['Notion', 'GitHub', 'Google Drive', 'Gateway']) {
  assert.ok(guide.includes(service), `в руководстве описан ${service}`);
}
for (const entry of docs.slice(0, 3)) {
  assert.ok(read(entry).includes('./README-авторизация.md'), `${entry} ссылается на руководство`);
}
for (const entry of docs) {
  const contents = read(entry);
  assert.ok(!contents.includes('_tools/ScriptCat/'), `${entry} не зависит от имени родительского каталога`);
  const base = new URL(entry, root);
  for (const hit of contents.matchAll(/\[[^\]]+\]\((\.\/[\w.\-/а-яё]+)(?:#[^)]*)?\)/giu)) {
    assert.ok(statSync(new URL(hit[1], base)).isFile(), `${entry}: ссылка ${hit[1]} доступна`);
  }
}

const pultHtml = readFileSync(new URL('../../../relay/web/index.html', import.meta.url), 'utf8');
const pultApp = readFileSync(new URL('../../../relay/web/app.js', import.meta.url), 'utf8');
for (const [id, label] of [['btn-project-new', 'Новый профиль'], ['btn-project-import', 'Импорт JSON профиля'],
  ['btn-project-activate', 'Сделать активным'], ['btn-project-save', 'Сохранить профиль и подключения']]) {
  assert.ok(pultHtml.includes(`id="${id}"`), `кнопка «${label}» есть в Relay pult`);
  assert.ok(guide.includes(label), `кнопка «${label}» описана в руководстве`);
}
for (const [id, label] of [['project-notion', 'Notion token'], ['project-gw-url', 'Gateway URL'],
  ['project-gw-key', 'Gateway key'], ['project-github', 'GitHub token'], ['project-ntfy-topic', 'ntfy topic']]) {
  assert.ok(pultHtml.includes(`id="${id}"`), `поле «${label}» есть в Relay pult`);
  assert.ok(guide.includes(label), `поле «${label}» описано в руководстве`);
}
assert.match(pultApp, /\/api\/projects\/active/);
assert.doesNotMatch(read('src/07-connections-ui.js'), /function connectionDialog\(/, 'no ScriptCat connection dialog remains');
const gateway = read('drive-gateway.gs');
for (const name of ['CF_SETUP_PROJECT_ID', 'CF_SETUP_PROJECT_FOLDER', 'setupProjectGateway', 'CF_GATEWAY_KEY']) {
  assert.ok(gateway.includes(name), `${name} есть в коде шлюза`);
  assert.ok(guide.includes(name), `${name} описан в руководстве`);
}
assert.ok(guide.includes('Read content') && guide.includes('Update content') && guide.includes('Insert content'));
assert.ok(guide.includes('Contents: Read-only') && guide.includes('Pull requests: Read-only'));
assert.ok(guide.toLowerCase().includes('не передавайте') && guide.includes('в чат'));
console.log('OK: руководство подключений, ссылки, названия интерфейса и настройки Gateway согласованы.');
