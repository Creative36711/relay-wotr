// Проба D-086 в однократном контуре FixtureWorkspace: репозиторий один, но правила остались.
//
// Мастер: «кто к какому репозиторию подключён, тот тот и правит; подключение —
// в Notion, база «Роли», поле «Репозиторий»». У FixtureWorkspace это один
// `example-org/fixture-source`, поэтому проверяется не «два репозитория», а три
// вещи, которые ломаются и на одном:
//   • сверка редакции ТЗ читает репозиторий документов, а не сессии (в форке
//     они разные, и это должно работать без правки кода);
//   • карточка с полем «Репозиторий» не перебивает подключение роли;
//   • телеметрия не уезжает в чужой репозиторий: по умолчанию — Drive.

import { readFileSync, existsSync } from 'node:fs';
import { strict as assert } from 'node:assert';

import { assertUserscriptVersionContract } from '../version-oracle.mjs';

const src = readFileSync(new URL('../relay.user.js', import.meta.url), 'utf8');
assertUserscriptVersionContract(src);

// ── 1. Репозиторий документов — отдельно от репозитория сессии ───────────────
const cfg = readFileSync(new URL('../src/01-config.js', import.meta.url), 'utf8');
assert.match(cfg, /docsRepo: ""/, 'репозиторий документов задан отдельной настройкой');
assert.match(cfg, /queueDoc: ""/, 'D-003: проектных файлов по умолчанию нет — сверка неприменима');

const adr = readFileSync(new URL('../src/25-legacy-adr.js', import.meta.url), 'utf8');
assert.match(adr, /function docsRepository\(\)/, 'репозиторий документов вычисляется, а не берётся из C.repo');
assert.match(adr, /C\.docsRepo/, 'явная настройка имеет приоритет');
assert.match(adr, /cfn-roles-cache|K\.rolesCache/, 'иначе берётся репозиторий роли-приёмки из «Ролей»');
assert.match(adr, /fn === "Reviewer"[\s\S]{0,80}Warden/, 'владелец документов — роль приёмки');
assert.match(adr, /canonicalTargetRepository\(docsRepository\(\)\)/, 'короткий slug доезжает до owner/repo');
assert.match(adr, /cache\.repo === repo/, 'кеш редакции учитывает репозиторий, а не только файл');

// ── 2. Подключение роли — граница выдачи ────────────────────────────────────
const prs = readFileSync(new URL('../src/19-pull-requests.js', import.meta.url), 'utf8');
assert.match(prs, /function roleRepoVerdict\(targetRepo, role = null\)/, 'правило названо функцией');
assert.match(prs, /не тот, к которому подключена роль/, 'отказ объясняет расхождение словами');
assert.match(prs, /в «Ролях» у /, 'отказ называет объявленный репозиторий роли');
assert.match(prs, /if \(!declared\) return "";/, 'роль без поля «Репозиторий» работает как раньше');
assert.match(prs, /canonicalTargetRepository\(declared, C\.repo\)/, 'сравнение по полному owner/repo, а не по строке');

const answers = readFileSync(new URL('../src/27-review-answers.js', import.meta.url), 'utf8');
assert.match(answers, /roleRepoVerdict\(targetRepo, role\)/, 'гейт стоит перед выдачей карточки');
const at = answers.indexOf('roleRepoVerdict(targetRepo, role)');
assert.ok(at > 0 && at < answers.indexOf('await gateway("createLog"'), 'проверка до создания журнала выдачи');

// ── 3. Телеметрия: публичный репозиторий — не получатель ────────────────────
const heal = readFileSync(new URL('../src/41-heal.js', import.meta.url), 'utf8');
assert.match(heal, /function telemetryRepoPrivate\(repo\)/, 'видимость получателя проверяется');
assert.match(heal, /meta\.private === true/, 'приватность берётся из API, а не из имени');
assert.match(heal, /telemetryPrivacy\.set\(key, false\); \/\/ по умолчанию — не пишем/, 'по умолчанию — не писать');
assert.match(heal, /телеметрия не пишется в публичный репозиторий/, 'отказ назван словами');
assert.match(cfg, /telemetryRepo: ""/, 'получатель не задан по умолчанию — только Drive');

// ── 4. Ни один из путей не пишет в репозиторий проекта ──────────────────────
const upload = heal.slice(heal.indexOf('async function healUpload('), heal.indexOf('async function healPublish('));
assert.ok(!/contents\/\$\{repo\}/.test(upload), 'в репозиторий проекта телеметрия не пишется');
assert.match(upload, /contents\/\$\{encodeURI\(path\)\}/, 'путь пишется по вычисленному адресу получателя');

// ── 5. Одиннадцать проектных путей отсутствуют в дереве транспорта ──────────
// D-003: зеркало процессных docs и профиль проекта удалены. Здесь — рабочее
// дерево; команда для отчёта (фиксируется в docs/evidence/TRANS-NEU-1.md):
//   git ls-tree -r --name-only HEAD -- <все 11 путей>   → пустой вывод.
{
  const docsDir = ['docs', ''].join('/');
  const projectPaths = [
    docsDir + ['REGULATION', '.md'].join(''),
    docsDir + ['regulation-', 'digest.md'].join(''),
    docsDir + ['PHASES', '.md'].join(''),
    docsDir + ['DECISIONS-', 'UPSTREAM.md'].join(''),
    docsDir + ['agents/cost-', 'gates.md'].join(''),
    docsDir + ['agents/trouble', 'shooting.md'].join(''),
    docsDir + ['agents/roles/', ['localization-', 'cultural-qa-engineer.md'].join('')].join(''),
    docsDir + ['missions/', 'TEMPLATE.md'].join(''),
    docsDir + ['missions/', ['WOT', 'R-1.1.md'].join('')].join(''),
    docsDir + ['missions/', ['WOT', 'R-1.2.md'].join('')].join(''),
    ['tools/script-cat/', ['wotr-', 'project.json'].join('')].join(''),
  ];
  for (const rel of projectPaths) {
    assert.equal(existsSync(new URL(`../../../${rel}`, import.meta.url)), false,
      `проектный путь удалён из дерева: ${rel}`);
  }
  // Собранный бандл не содержит проектных строк (литералы — только сборкой).
  const bundle = readFileSync(new URL('../relay.user.js', import.meta.url), 'utf8');
  const projectTokens = [
    ['WO', 'RT'].join(''),
    ['open-', 'bfme'].join(''),
    ['wotr-', 'project'].join(''),
    ['regulation-', 'digest'].join(''),
    ['docs/', 'PHASES'].join(''),
    ['Creative36711/open-', 'bfme'].join(''),
  ];
  for (const token of projectTokens) {
    assert.equal(bundle.includes(token), false, `бандл без проектной строки: <token>`);
  }
}

// ── 6. Версия и решения ─────────────────────────────────────────────────────
assert.match(src, /@version\s+1\.(?:14\.(?:1[6-9]|2[0-9]|3[0-9])|1[5-9]\.\d+)/, 'сборка не старее 1.14.16');
const decisions = readFileSync(new URL('../upstream-fixtures/docs/DECISIONS.md', import.meta.url), 'utf8');
assert.match(decisions, /## D-086/, 'решение D-086 в журнале');
assert.match(decisions, /example-org\/fixture-source/, 'целевой репозиторий записан, а не подразумевается');

console.log('ok 1 - tests/relay-repo-visibility-smoke.mjs');
