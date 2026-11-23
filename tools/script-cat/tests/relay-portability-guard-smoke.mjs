import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {findPortableNameLeaks, findProvenanceBoundaryErrors} from '../portability-guard.mjs';

const root = mkdtempSync(join(tmpdir(), 'relay-portability-'));
try {
  writeFileSync(join(root, 'ok.md'), 'Portable guide with CASEA-1 fixture');
  assert.deepEqual(findPortableNameLeaks(root), []);

  const formerProduct = ['nar', 'thex'].join('');
  const formerCard = ['S', 'YN3'].join('');
  const formerWorkspace = ['va', 'ult'].join('');
  const formerComponent = ['cor', 'tex'].join('');
  const formerRole = ['ker', 'nel'].join('');
  const formerSchema = ['game', 'spec'].join('');
  mkdirSync(join(root, `old-${formerProduct.toUpperCase()}`));
  writeFileSync(join(root, 'bad.md'), [
    `A ${formerProduct.toUpperCase()} B`, formerCard, `my_${formerWorkspace}_bot`,
    formerComponent, formerRole, formerSchema,
  ].join('\n'));
  const hits = findPortableNameLeaks(root);
  assert(hits.some((hit) => hit.includes(': имя (former product name)')));
  assert(hits.some((hit) => hit === 'bad.md:1: former product name'));
  assert(hits.some((hit) => hit === 'bad.md:2: former card prefix'));
  assert(hits.some((hit) => hit === 'bad.md:3: former workspace name'));
  assert(hits.some((hit) => hit === 'bad.md:4: former component label'));
  assert(hits.some((hit) => hit === 'bad.md:5: former role label'));
  assert(hits.some((hit) => hit === 'bad.md:6: former schema label'));

  // D-003: нейтральные паттерны проекта — имя, репозиторий, префикс карточки,
  // проектный путь; литералы собираются, чтобы сам файл пробыл нейтральным.
  const projectName = ['WOT', 'R'].join('');
  const projectRepo = ['open-', 'bfme'].join('');
  const projectCard = `${projectName}-1.1`;
  const projectPath = ['docs/', 'REGULATION.md'].join('');
  writeFileSync(join(root, 'project-leak.md'),
    [`${projectName} target`, projectRepo, projectCard, projectPath].join('\n'));
  const phits = findPortableNameLeaks(root);
  assert(phits.some((h) => h === 'project-leak.md:1: project name'), 'имя проекта поймано');
  assert(phits.some((h) => h === 'project-leak.md:2: project repository'), 'репозиторий проекта пойман');
  assert(phits.some((h) => h === 'project-leak.md:3: project name'), 'префикс карточки пойман');
  assert(phits.some((h) => h === 'project-leak.md:3: project card prefix'), 'префикс карточки пойман явно');
  assert(phits.some((h) => h === 'project-leak.md:4: project process path'), 'проектный путь пойман');
  rmSync(join(root, 'project-leak.md'));
  // Единственное исключение: UPSTREAM.md несёт provenance и проектный токен
  // там не считается утечкой (прежние паттерны при этом действуют).
  writeFileSync(join(root, 'UPSTREAM.md'),
    ['| Source repository (provenance only) | `PLACEHOLDER` |'.replace('PLACEHOLDER', ['Creative-', 'textile/', 'va', 'ult'].join('')), `Operational target: ${projectRepo}`].join('\n'));
  assert.deepEqual(findPortableNameLeaks(root).filter((h) => h.startsWith('UPSTREAM.md')), [],
    'проектный токен в UPSTREAM.md — разрешённое исключение');
  rmSync(join(root, 'UPSTREAM.md'));

  const provenance = ['Creative-', 'textile/', 'va', 'ult'].join('');
  const pinned = [
    `| Source repository (provenance only) | \`${provenance}\` |`,
    `git clone https://github.com/${provenance} /tmp/scriptcat-upstream`,
  ];
  writeFileSync(join(root, 'UPSTREAM.md'), `${pinned.join('\n')}\n`);
  assert.deepEqual(findPortableNameLeaks(root).filter((hit) => hit.startsWith('UPSTREAM.md')), []);
  assert.deepEqual(findProvenanceBoundaryErrors(root), []);
  writeFileSync(join(root, 'UPSTREAM.md'), `${pinned.join('\n')}\nOperational target: ${provenance}\n`);
  assert(findPortableNameLeaks(root).some((hit) => hit.startsWith('UPSTREAM.md:3:')), 'extra provenance token is a text leak');
  assert.equal(findProvenanceBoundaryErrors(root).length, 1, 'provenance lines are pinned, not merely counted');
} finally { rmSync(root, {recursive:true, force:true}); }
console.log('OK: full-tree portability guard rejects former and project identifiers (UPSTREAM.md excepted) and confines exact provenance');
