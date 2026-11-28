// D-024: согласование создания агентов выброшено целиком — профиля
// admin.provision, маркера CF_AGENT_PROVISION_RESULT и админ-флага нет.
// Проба держит именно это: вернуть механику можно только явным решением.
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PROMPT_PROFILES, PROMPT_MARKER_REGISTRY } from './helpers/prompt-env.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = join(here, '..', 'src');
const files = ['31-provision-core.js', '32-provision-dom.js', '33-provision-flow.js', '34-provision-ui.js'];
const provisionSources = files.map((f) => [f, readFileSync(join(srcDir, f), 'utf8')]);

test('профиля согласования и его маркера больше нет', () => {
  assert.equal(PROMPT_PROFILES.profiles['admin.provision'], undefined, 'admin.provision удалён');
  assert.equal(PROMPT_MARKER_REGISTRY.forKind('provision'), null, 'вид provision маркера не имеет');
  assert.equal(PROMPT_MARKER_REGISTRY.defs.CF_AGENT_PROVISION_RESULT, undefined);
  // Сборка промпта для вида provision не собирает ход роли: это не карточка,
  // не план и не приёмка — создание агента делает контур.
  const source = provisionSources.map(([, text]) => text).join('\n');
  assert.ok(!/PromptCompiler\.compile/.test(source), 'контур не собирает промпт роли для создания агента');
});

test('админ-флаг, allowlist и настраиваемый пробник не вернулись в контур', () => {
  for (const [file, text] of provisionSources) {
    assert.ok(!/agentAdmin/.test(text), `${file}: админ-флаг снова читается`);
    assert.ok(!/agentProvisionRepoAllowlist/.test(text), `${file}: allowlist снова читается`);
    assert.ok(!/agentProvisionEnabled/.test(text), `${file}: выключатель контура снова читается`);
    assert.ok(!/cfg\.agentBootstrapPrompt/.test(text), `${file}: пробник снова берётся из профиля`);
    assert.ok(!/relayClient\.admin/.test(text), `${file}: административный контейнер снова не создаёт агентов`);
    assert.ok(!/provision-no-admin/.test(text), `${file}: пауза «нет админ-роли» вернулась`);
  }
  const core = provisionSources.find(([f]) => f === '31-provision-core.js')[1];
  assert.match(core, /PROVISION_PROBE_PROMPT = "Что изображено на картинке test\.jpg/,
    'первый промпт задан константой');
  assert.match(core, /Если у тебя нет функции визуального распознавания, скажи прямо\./);
});

test('код provisioning не содержит проектных имён и named-role привилегий', () => {
  for (const [file, text] of provisionSources) {
    assert.ok(!/example-org|fixture-workspace/i.test(text), `${file}: проектное имя`);
    assert.ok(!/norm\(["']Warden|===\s*["']Warden|name\s*===\s*["']Coordinator["']/i.test(text), `${file}: named-role привилегия`);
  }
});

test('профиль больше не несёт удалённых ключей провижининга', () => {
  const profiles = readFileSync(join(srcDir, '02-profiles-core.js'), 'utf8');
  for (const key of ['agentProvisionEnabled:', 'agentProvisionMode:', 'agentProvisionRepoAllowlist:', 'agentBootstrapPrompt:']) {
    assert.ok(!profiles.includes(key), `ключ ${key} вернулся в PROVISION_DEFAULTS/normalize`);
  }
  // Пределы, которые защищают квоту и время ожидания, остаются.
  for (const key of ['agentProvisionMaxJobs', 'agentProvisionDailyMax', 'agentUrlWaitMs', 'agentBootstrapWaitMs']) {
    assert.ok(profiles.includes(key), `${key} потерялся`);
  }
});
