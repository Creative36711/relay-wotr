import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {findPortableNameLeaks, findProvenanceBoundaryErrors} from '../portability-guard.mjs';

const root = mkdtempSync(join(tmpdir(), 'relay-portability-'));
try {
  writeFileSync(join(root, 'ok.md'), 'WOTR-only portable guide with CASEA-1 fixture');
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
console.log('OK: full-tree portability guard rejects former names/card prefixes and confines exact provenance');
