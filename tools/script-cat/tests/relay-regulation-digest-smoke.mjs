// Проба D-003: регламент проекта — вход сборки, а не содержимое репозитория.
//
// Обе границы проверяются честно:
//   • закоммиченный бандл — нейтральный: поле regulationDigest пустое (явно,
//     а не пропущено), placeholder остался в src, build-manifest несёт
//     digest: null;
//   • при digest: null сверка версии возвращает null — «неприменимо»
//     показывается строкой в прогоне, не молчит и не становится pass;
//   • переданный --digest подставляется в бандл, шапка «Версия N.N»
//     сверяется с build-manifest этой же сборки, оба режима дают rc 0;
//   • негативы: чужая версия — отказ сверки; файл без строки версии —
//     отказ сборки (rc ≠ 0) с названной причиной.

import { strict as assert } from 'node:assert';
import {
  readFileSync, readdirSync, mkdtempSync, writeFileSync, rmSync, mkdirSync, copyFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  assertDigestAgainstManifest, normalizeDigest, digestVersion, readEmbeddedDigest, DIGEST_PLACEHOLDER,
} from '../regulation-oracle.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const sc = join(here, '..');

// ── 1. Закоммиченный бандл: нейтральный режим ──────────────────────────────
const src = readFileSync(join(sc, 'relay.user.js'), 'utf8');
assert.equal(readEmbeddedDigest(src), '', 'нейтральный бандл: блок регламента пуст');
const manifest = JSON.parse(readFileSync(join(sc, 'contracts', 'build-manifest.json'), 'utf8'));
assert.equal(manifest.schema, 'scriptcat-build-manifest', 'manifest пишет сборка');
assert.equal(manifest.digest, null, 'build-manifest нейтральной сборки: digest null');
const naVersion = assertDigestAgainstManifest('', manifest);
assert.equal(naVersion, null, 'при digest: null сверка версии возвращает null — неприменима');
console.log('неприменимо (явно): сверка версии регламента отсутствует — переданного digest нет (digest: null)');

const cfg = readFileSync(join(sc, 'src', '01-config.js'), 'utf8');
assert.ok(cfg.includes(DIGEST_PLACEHOLDER), 'placeholder @@REGULATION_DIGEST@@ остаётся в src');
assert.ok(!src.includes('@@REGULATION_DIGEST@@'), 'в собранном бандле placeholder подставлен');

// ── 2. Временная копия инструментов: режимы --digest и нейтральный ─────────
const tmp = mkdtempSync(join(tmpdir(), 'd003-digest-'));
try {
  const fakePath = join(tmp, 'project-digest.md');
  const fakeText = '# Краткий регламент проекта\n\nВерсия 9.9\n\n- Тестовое правило.\n';
  writeFileSync(fakePath, fakeText, 'utf8');
  assert.equal(digestVersion(fakeText), '9.9', 'шапка «Версия N.N» читается из самого файла');
  assert.ok(normalizeDigest(fakeText).includes('Версия 9.9'), 'нормализация шапку сохраняет');

  // Копия инструментов БЕЗ каталога docs: сборка не ищет и не читает docs.
  const work = join(tmp, 'scriptcat');
  mkdirSync(join(work, 'src'), { recursive: true });
  mkdirSync(join(work, 'contracts'), { recursive: true });
  for (const f of readdirSync(join(sc, 'src'))) copyFileSync(join(sc, 'src', f), join(work, 'src', f));
  for (const f of readdirSync(join(sc, 'contracts'))) copyFileSync(join(sc, 'contracts', f), join(work, 'contracts', f));
  copyFileSync(join(sc, 'build.mjs'), join(work, 'build.mjs'));
  for (const f of ['version-oracle.mjs', 'regulation-oracle.mjs', 'coverage-oracle.mjs', 'fingerprint-oracle.mjs']) {
    copyFileSync(join(sc, f), join(work, f));
  }
  const build = (args) => spawnSync(process.execPath, ['build.mjs', ...args], { cwd: work, encoding: 'utf8' });

  // Положительный режим: регламент подставлен из входа, manifest несёт шапку и sha256.
  const r1 = build(['--digest', fakePath]);
  assert.equal(r1.status, 0, `сборка с --digest rc 0: ${r1.stderr}`);
  assert.equal(readEmbeddedDigest(readFileSync(join(work, 'relay.user.js'), 'utf8')),
    normalizeDigest(fakeText), 'регламент подставлен из входного файла');
  const m1 = JSON.parse(readFileSync(join(work, 'contracts', 'build-manifest.json'), 'utf8'));
  assert.equal(m1.digest.version, '9.9', 'manifest несёт шапку из входа');
  assert.match(m1.digest.sha256, /^[0-9a-f]{64}$/, 'manifest несёт sha256');
  assert.equal(assertDigestAgainstManifest(fakeText, m1), '9.9', 'digest сверяется с manifest (версия и sha)');

  // --check той же сборки с тем же входом — rc 0.
  const r2 = build(['--check', '--digest', fakePath]);
  assert.equal(r2.status, 0, `--check с --digest rc 0: ${r2.stderr}`);

  // Негатив: чужая версия — сверка отказывает.
  const foreignPath = join(tmp, 'foreign.md');
  writeFileSync(foreignPath, '# Регламент\n\nВерсия 8.8\n\n- Другое правило.\n', 'utf8');
  assert.throws(() => assertDigestAgainstManifest(readFileSync(foreignPath, 'utf8'), m1),
    /не совпадает с build-manifest/, 'чужая версия отклоняется сверкой');

  // Негатив: нет строки «Версия N.N» — сборка отказывает с названной причиной.
  const noVersionPath = join(tmp, 'no-version.md');
  writeFileSync(noVersionPath, '# Регламент без версии\n\nПросто текст.\n', 'utf8');
  const r3 = build(['--digest', noVersionPath]);
  assert.notEqual(r3.status, 0, 'digest без шапки версии — сборка rc ≠ 0');
  assert.match(String(r3.stderr), /Версия N\.N/, 'причина называет обязательную шапку');

  // Нейтральный режим в той же копии (docs там отсутствует вовсе) — rc 0.
  rmSync(join(work, 'relay.user.js'));
  const r4 = build([]);
  assert.equal(r4.status, 0, `нейтральная сборка без docs rc 0: ${r4.stderr}`);
  assert.equal(readEmbeddedDigest(readFileSync(join(work, 'relay.user.js'), 'utf8')), '',
    'без --digest регламент пуст');
  const m4 = JSON.parse(readFileSync(join(work, 'contracts', 'build-manifest.json'), 'utf8'));
  assert.equal(m4.digest, null, 'нейтральная сборка переписывает manifest в null');
  assert.equal(assertDigestAgainstManifest('', m4), null, 'и сверка снова неприменима (null)');
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

console.log('OK: регламент — вход сборки: нейтральный бандл пуст, --digest подставляется и сверяется, негативы отклоняются');
