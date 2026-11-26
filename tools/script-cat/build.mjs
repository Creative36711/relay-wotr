// Склеивает части в одну closure. Изменение метаданных может создать новую
// установку и новое хранилище; см. порядок переноса в INSTALL.md.
//
// D-003: регламент проекта — вход сборки, а не содержимое репозитория.
//   node build.mjs                     → нейтральный бандл, пустой блок регламента;
//   node build.mjs --digest <путь>     → регламент подставляется из входного файла;
//   node build.mjs [--check] [--digest <путь>] → сверка с закоммиченными артефактами.
// Каждая сборка записывает contracts/build-manifest.json: шапка и sha256
// переданного digest'а (или null для нейтрального бандла).
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertUserscriptVersionContract } from './version-oracle.mjs';
import { digestVersion, inlineDigest, normalizeDigest } from './regulation-oracle.mjs';
import { assertPromptCoverage } from './coverage-oracle.mjs';
import { buildFingerprint, inlineFingerprint } from './fingerprint-oracle.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const header = '00-header.js';
const parts = [
  '01-config.js', '02-profiles-core.js', '03-utils.js', '04-notifications.js', '05-debug.js',
  '06-pause-panel.js', '07-connections-ui.js', '08-projects-ui.js', '09-ntfy-ui.js', '10-github-ui.js',
  '11-http-gateway.js', '12-notion.js',
  // D-015: адрес пары (роль, слот) из службы Relay. Идёт сразу после Notion и
  // до всего, что спрашивает адрес роли: гейт состава, охрана дублей, разбор.
  '12b-instances.js',
  '13-arena-messages.js', '14-missing-marker.js', '15-visible-errors.js',
  '16-arena-send.js', '17-arena-polls.js', '18-state-recovery.js', '19-pull-requests.js',
  'prompt-marker-registry.js', 'prompt-blocks.js', 'prompt-profiles.js', 'prompt-compiler.js',
  '20-technical-context.js', '21-prompts.js', '22-executor.js', '23-coordinator.js', '24-feedback.js',
  '25-legacy-adr.js', '26-review.js', '26b-arbiter.js', '27-review-answers.js', 'pilot-transport.js', '30-tool-limit.js',
  '31-provision-core.js', '32-provision-dom.js', '33-provision-flow.js', '34-provision-ui.js',
  '40-heal-core.js', '41-heal.js', '42-roster.js', '43-pr-zone.js', '44-accounts.js',
  // D-006: будильник вкладок. После accounts (нужны roleAccount/accountLabel в
  // 28-cycle) и до цикла: тик спрашивает его первым.
  '45-wake.js',
  '28-cycle.js', '29-boot.js',
];
const read = (name) => readFile(join(here, 'src', name), 'utf8');
// D-003: регламент — вход сборки. `--digest <путь>` читает переданный файл и
// требует шапку «Версия N.N» в самом файле; без параметра бандл нейтральный,
// блок регламента пуст. Каталог docs сборка не ищет и проектных копий не читает.
const parseArgv = (args) => {
  const out = { check: false, digest: null };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--check') { out.check = true; continue; }
    if (arg !== '--digest') throw new Error('Usage: node build.mjs [--check] [--digest <путь>]');
    const value = args[i + 1];
    if (out.digest !== null || value === undefined || value.startsWith('--')) {
      throw new Error('Usage: node build.mjs [--check] [--digest <путь>]');
    }
    out.digest = value;
    i += 1;
  }
  return out;
};
const { check, digest: digestArg } = parseArgv(process.argv.slice(2));
let digest = '';
let digestMeta = null; // null | {version, sha256} — то, что уходит в build-manifest
if (digestArg !== null) {
  const digestRaw = await readFile(digestArg, 'utf8');
  const digestHeaderVersion = digestVersion(digestRaw);
  if (!digestHeaderVersion) {
    throw new Error(`${digestArg}: в шапке digest'а нет строки «Версия N.N» — версия не сверяема`);
  }
  digest = normalizeDigest(digestRaw);
  digestMeta = {
    version: digestHeaderVersion,
    sha256: createHash('sha256').update(digestRaw).digest('hex'),
  };
}
// Manifest — то, что сверяет последующая сборка с этой: digest в нём либо
// описан целиком (version + sha256), либо null — «нейтральный бандл, регламент
// не передавался» (сверка в этом случае неприменима, а не пропущена).
const manifest = { schema: 'scriptcat-build-manifest', version: 1, digest: digestMeta };
const manifestJson = `${JSON.stringify(manifest, null, 2)}\n`;
const manifestPath = join(here, 'contracts', 'build-manifest.json');
// D-073: отпечаток считается по источнику ДО подстановки самого отпечатка и
// регламента — иначе он зависел бы от собственного значения. Номер версии и
// отпечаток независимы: номер говорит «какой выпуск», отпечаток — «какая сборка».
const rawSource = (await read(header)) + '\n((GM_getValue, GM_setValue) => {\n  "use strict";\n\n' +
  (await Promise.all(parts.map(read))).join('\n') + '})(GM_getValue, GM_setValue);\n';
const fingerprint = buildFingerprint(rawSource);
const source = inlineFingerprint(inlineDigest(rawSource, digest), fingerprint);
assertUserscriptVersionContract(source);

// Coverage-оракул: ruleId → block → profiles. Падает, если правило регламента
// потерялось при сжатии блоков или профиль не несёт обязательное для роли правило.
const contract = JSON.parse(await readFile(join(here, 'contracts', 'agent-protocol.json'), 'utf8'));
const coverage = assertPromptCoverage({
  blocksSource: await read('prompt-blocks.js'),
  profilesSource: await read('prompt-profiles.js'),
  contract,
});
const coverageMap = {
  protocolVersion: contract.protocolVersion,
  roleProfile: coverage.roleProfile || { Executor: 'executor.card', Auditor: 'auditor.card', Coordinator: 'coordinator.plan', Reviewer: 'reviewer.mission' },
  ruleToBlocks: Object.fromEntries(Object.entries(coverage.ruleToBlocks).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, [...v].sort()])),
  profileRules: Object.fromEntries(Object.entries(coverage.profileRules).sort(([a], [b]) => a.localeCompare(b))),
  // Git-границы и аудитория профилей: compact/recovery/continuation проверяются
  // не только по маркеру, но и по отсутствию git-write блоков и по роли.
  profileAudience: Object.fromEntries(Object.entries(coverage.profileAudience).sort(([a], [b]) => a.localeCompare(b))),
  profileGitWrite: Object.fromEntries(Object.entries(coverage.profileGitWrite).sort(([a], [b]) => a.localeCompare(b))),
};
const coverageJson = JSON.stringify(coverageMap, null, 2) + '\n';
const coveragePath = join(here, 'contracts', 'prompt-coverage.json');

const output = join(here, 'relay.user.js');
if (check) {
  const current = await readFile(output, 'utf8');
  if (source !== current) {
    console.error('relay.user.js устарел: выполните node tools/script-cat/build.mjs');
    process.exitCode = 1;
  } else console.log(`ScriptCat bundle соответствует ${parts.length + 1} исходным файлам.`);
  const currentCoverage = existsSync(coveragePath) ? await readFile(coveragePath, 'utf8') : '';
  if (coverageJson !== currentCoverage) {
    console.error('contracts/prompt-coverage.json устарел: выполните node tools/script-cat/build.mjs');
    process.exitCode = 1;
  } else console.log(`Coverage: ${Object.keys(coverageMap.ruleToBlocks).length} ruleId покрыты блоками и профилями.`);
  const currentManifest = existsSync(manifestPath) ? await readFile(manifestPath, 'utf8') : '';
  if (manifestJson !== currentManifest) {
    console.error('contracts/build-manifest.json устарел: выполните node tools/script-cat/build.mjs');
    process.exitCode = 1;
  } else {
    console.log(manifest.digest
      ? `Build-manifest: digest ${manifest.digest.version} (sha256 сверяется по мере поступления входа).`
      : 'Build-manifest: digest null — нейтральный бандл, сверка digest неприменима (показана явно).');
  }
} else {
  await writeFile(output, source, 'utf8');
  await writeFile(coveragePath, coverageJson, 'utf8');
  await writeFile(manifestPath, manifestJson, 'utf8');
  console.log(`Собран ${output} из ${parts.length + 1} исходных файлов${digestArg === null ? ' (нейтральный регламент: --digest не передан)' : ` (регламент: ${digestArg}, ${digestMeta.version})`}.`);
  console.log(`Coverage: ${Object.keys(coverageMap.ruleToBlocks).length} ruleId → blocks → profiles записан в contracts/prompt-coverage.json.`);
  console.log(`Build-manifest: ${manifest.digest ? `digest ${manifest.digest.version}, sha256 ${manifest.digest.sha256}` : 'digest null (нейтральный бандл)'} → contracts/build-manifest.json.`);
}
