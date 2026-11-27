// Сборка, проверка расхождения и негативная проба в изолированной временной копии.
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const here = dirname(fileURLToPath(import.meta.url));
const source = join(here, '..');
const temp = mkdtempSync(join(tmpdir(), 'relay-build-probe-'));
const run = (args) => spawnSync(process.execPath, args, { cwd: temp, encoding: 'utf8' });
try {
  for (const path of ['src', 'build.mjs', 'version-oracle.mjs', 'regulation-oracle.mjs', 'coverage-oracle.mjs', 'fingerprint-oracle.mjs', 'contracts', 'relay.user.js']) cpSync(join(source, path), join(temp, path), {recursive:true});
  let result = run(['build.mjs', '--check']); assert.equal(result.status, 0, result.stderr);
  appendFileSync(join(temp, 'src', '03-utils.js'), '\n// local build probe\n');
  result = run(['build.mjs', '--check']); assert.notEqual(result.status, 0, 'изменённый исходник нельзя выдать за собранный');
  result = run(['build.mjs']); assert.equal(result.status, 0, result.stderr);
  result = run(['build.mjs', '--check']); assert.equal(result.status, 0, result.stderr);
  result = run(['--check', 'relay.user.js']); assert.equal(result.status, 0, result.stderr);
  // D-003: неизвестный/неполный аргумент — usage и rc ≠ 0 (нейтральный режим без docs).
  const bad = run(['build.mjs', '--profile', 'x']);
  assert.notEqual(bad.status, 0, 'неизвестный аргумент отклонён');
  assert.match(String(bad.stderr), /Usage: node build\.mjs \[--check\] \[--digest <путь>\]/);
  const incomplete = run(['build.mjs', '--digest']);
  assert.notEqual(incomplete.status, 0, '--digest без значения отклонён');
  // Manifest нейтральной сборки: digest null — сверка неприменима и показана явно.
  const manifest = JSON.parse(readFileSync(join(temp, 'contracts', 'build-manifest.json'), 'utf8'));
  assert.equal(manifest.digest, null, 'нейтральная сборка: manifest digest null');
  const bundle = readFileSync(join(temp, 'relay.user.js'), 'utf8');
  assert.equal((bundle.match(/^\/\/ @version\s/gm) || []).length, 1);
  assert.match(bundle, /^\/\/ @name\s+Relay — передача хода между агентами$/m);
  assert.match(bundle, /^\/\/ @namespace\s+https:\/\/arena\.ai\/$/m);
  const published = 'https://raw.githubusercontent.com/Creative36711/relay-wotr/main/tools/script-cat/relay.user.js';
  assert(bundle.includes(`// @updateURL    ${published}`), 'установка с raw URL знает, откуда обновляться');
  assert(bundle.includes(`// @downloadURL  ${published}`), 'URL загрузки совпадает с каналом обновления');
  assert(bundle.includes('// local build probe'));
  console.log('OK: детерминированная сборка, защита от устаревшего bundle, неизменное имя и URL автообновления');
} finally { rmSync(temp, {recursive:true, force:true}); }
