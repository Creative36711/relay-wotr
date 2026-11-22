#!/usr/bin/env node
// Full-tree WOTR portability guard. Former product/card identifiers are banned
// from executable source, comments, contracts, tests and structural fixtures.
// The exact imported repository is allowed only in UPSTREAM.md as provenance.
import {readdirSync, readFileSync, statSync} from 'node:fs';
import {resolve, relative, join, basename} from 'node:path';
import {fileURLToPath} from 'node:url';

const formerSource = ['Creative-', 'textile/', 'va', 'ult'].join('');
const formerPatterns = [
  {label: 'former product name', re: new RegExp(['syn', 'apse'].join(''), 'i')},
  {label: 'former product name', re: new RegExp(['nar', 'thex'].join(''), 'i')},
  {label: 'former source owner', re: new RegExp(['creative-', 'textile'].join(''), 'i')},
  {label: 'former workspace name', re: new RegExp(['va', 'ult'].join(''), 'i')},
  {label: 'former component label', re: new RegExp(['cor', 'tex'].join(''), 'i')},
  {label: 'former role label', re: new RegExp(['ker', 'nel'].join(''), 'i')},
  {label: 'former schema label', re: new RegExp(['game', 'spec'].join(''), 'i')},
  {label: 'former card prefix', re: new RegExp(`\\b${['N', 'AR'].join('')}(?:-?P|-)?\\d`, 'i')},
  {label: 'former card prefix', re: new RegExp(`\\b${['S', 'YN'].join('')}(?:-?P|-)?\\d`, 'i')},
];
const ignoredDirs = new Set(['node_modules', '.git']);
const provenanceFile = 'UPSTREAM.md';
const allowedProvenanceLines = [
  `| Source repository (provenance only) | \`${formerSource}\` |`,
  `git clone https://github.com/${formerSource} /tmp/scriptcat-upstream`,
];

function patternsIn(value) {
  const hits = [];
  for (const {label, re} of formerPatterns) {
    re.lastIndex = 0;
    if (re.test(value)) hits.push(label);
  }
  return hits;
}

function textForInspection(path, label, text) {
  if (basename(label) !== provenanceFile) return text;
  // Mask only two byte-for-byte provenance lines. The same repository token in
  // explanatory prose, instructions or another command is an operational leak.
  return text.split(/\r?\n/).map((line) =>
    allowedProvenanceLines.includes(line) ? line.replace(formerSource, 'PROVENANCE_SOURCE') : line
  ).join('\n');
}

export function findPortableNameLeaks(root, extraFiles = []) {
  const leaks = [];
  const inspect = (path, label, directory = false) => {
    for (const kind of patternsIn(label)) leaks.push(`${label}: имя (${kind})`);
    if (directory) {
      for (const name of readdirSync(path)) {
        const child = join(path, name);
        const stat = statSync(child);
        if (stat.isDirectory() && ignoredDirs.has(name)) continue;
        inspect(child, `${label}/${name}`, stat.isDirectory());
      }
      return;
    }
    let text;
    try { text = readFileSync(path, 'utf8'); }
    catch { return; }
    text = textForInspection(path, label, text);
    text.split(/\r?\n/).forEach((line, index) => {
      for (const kind of patternsIn(line)) leaks.push(`${label}:${index + 1}: ${kind}`);
    });
  };
  for (const name of readdirSync(root)) {
    const path = join(root, name), stat = statSync(path);
    if (stat.isDirectory() && ignoredDirs.has(name)) continue;
    inspect(path, name, stat.isDirectory());
  }
  for (const path of extraFiles) inspect(path, relative(process.cwd(), path), false);
  return leaks;
}

export function findProvenanceBoundaryErrors(root) {
  const path = join(root, provenanceFile);
  let text = '';
  try { text = readFileSync(path, 'utf8'); }
  catch { return [`${provenanceFile}: provenance file missing`]; }
  const actual = text.split(/\r?\n/).filter((line) => line.includes(formerSource));
  return actual.length === allowedProvenanceLines.length
      && actual.every((line, index) => line === allowedProvenanceLines[index])
    ? []
    : [`${provenanceFile}: exact source repository must occur only on the ${allowedProvenanceLines.length} pinned provenance lines`];
}

// Provisioning remains project-agnostic. WOTR project facts belong to the
// imported profile/bootstrap text, not hard-coded privileges in the DOM flow.
export function findProvisionProjectLeaks(root) {
  const leaks = [];
  for (const name of ['31-provision-core.js', '32-provision-dom.js', '33-provision-flow.js', '34-provision-ui.js']) {
    const path = join(root, 'src', name);
    const text = readFileSync(path, 'utf8');
    text.split(/\r?\n/).forEach((line, index) => {
      if (patternsIn(line).length) leaks.push(`src/${name}:${index + 1}: former project identifier`);
      if (/norm\(["']Warden|===\s*["']Warden|name\s*===\s*["']Coordinator["']/i.test(line)) {
        leaks.push(`src/${name}:${index + 1}: named-role privilege`);
      }
    });
  }
  return leaks;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('.', import.meta.url));
  const docsRoot = fileURLToPath(new URL('../../docs/', import.meta.url));
  const extra = [
    join(docsRoot, 'scriptcat-update.md'),
    join(docsRoot, 'regulation-digest.md'),
    join(docsRoot, 'REGULATION.md'),
  ];
  const agents = join(docsRoot, 'agents');
  const addDocs = (dir) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name), stat = statSync(path);
      if (stat.isDirectory()) addDocs(path);
      else if (/\.md$/i.test(name)) extra.push(path);
    }
  };
  addDocs(agents);
  const leaks = [
    ...findPortableNameLeaks(root, extra),
    ...findProvenanceBoundaryErrors(root),
    ...findProvisionProjectLeaks(root),
  ];
  if (leaks.length) {
    console.error(`Former-project identifiers in the WOTR ScriptCat boundary:\n${leaks.join('\n')}`);
    process.exitCode = 1;
  } else {
    console.log('OK: full ScriptCat tree and operational guides are WOTR-only; exact upstream identity is confined to UPSTREAM.md provenance');
  }
}
