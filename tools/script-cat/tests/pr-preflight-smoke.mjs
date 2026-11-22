// Проба J-1: preflight действительно ловит классы поломок, из-за которых мы
// теряли чужие правки (усечённый клон, чужой файл в PR, версия без выпуска,
// маркеры конфликта, разошедшийся бандл). Проверяем на копии репозитория,
// чтобы не зависеть от состояния рабочей ветки.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..", "..");
const mini = join(root, "tools", "script-cat", "preflight.mjs");

const gitIn = (cwd, args) =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" },
  }).trim();

// Мини-репозиторий: preflight опирается на git, build.mjs и контракт, поэтому
// копируем только нужное, а не весь репозиторий (relay.user.js весит 1,3 МБ).
const makeRepo = ({ srcVersion = "1.0.0", withOrigin = true } = {}) => {
  const dir = mkdtempSync(join(tmpdir(), "preflight-"));
  // структура, которую ждёт preflight.mjs
  cpSync(join(root, "tools", "script-cat", "preflight.mjs"), join(dir, "tools", "script-cat", "preflight.mjs"));
  cpSync(join(root, "tools", "script-cat", "build.mjs"), join(dir, "tools", "script-cat", "build.mjs"));
  for (const f of ["version-oracle.mjs", "regulation-oracle.mjs", "coverage-oracle.mjs", "fingerprint-oracle.mjs"]) {
    cpSync(join(root, "tools", "script-cat", f), join(dir, "tools", "script-cat", f));
  }
  cpSync(join(root, "tools", "script-cat", "src"), join(dir, "tools", "script-cat", "src"), { recursive: true });
  cpSync(join(root, "tools", "script-cat", "contracts"), join(dir, "tools", "script-cat", "contracts"), { recursive: true });
  mkdirSync(join(dir, "docs"), { recursive: true });
  cpSync(join(root, "docs", "DECISIONS.md"), join(dir, "docs", "DECISIONS.md"));
  writeFileSync(join(dir, "docs", "note.txt"), "x");

  gitIn(dir, ["init", "-q", "-b", "main"]);
  gitIn(dir, ["add", "-A"]);
  gitIn(dir, ["commit", "-q", "-m", "base"]);
  if (withOrigin) {
    gitIn(dir, ["update-ref", "refs/remotes/origin/main", "HEAD"]);
    gitIn(dir, ["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"]);
  }
  return dir;
};

const run = (dir, args = [], env = {}) =>
  spawnSync(process.execPath, [join(dir, "tools", "script-cat", "preflight.mjs"), ...args], {
    cwd: dir,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });

// Проверка публичного дерева зовёт python3; без него она честно говорит
// «пропущена», но тест на находки тогда не о чём.
const hasPython = spawnSync("python3", ["-c", "pass"], { encoding: "utf8" }).status === 0;

// Заглушка audit'а: проверка обязана различать «находка этого дерева» и
// «унаследовано», и не иметь права тушевать красное — поэтому режим задаётся
// извне, а вывод разбирается как есть.
const stubAudit = (dir) => {
  mkdirSync(join(dir, "tools", "release"), { recursive: true });
  writeFileSync(
    join(dir, "tools", "release", "pr_audit.py"),
    [
        "import os, sys",
        "m = os.environ.get('PREFLIGHT_AUDIT_MODE', 'clean')",
        "if m == 'own':",
        "    print('PR AUDIT: developer-machine path in docs/note.txt')",
        "    print('PR AUDIT FAILED: t (2 files; 1 of this tree, 0 inherited from origin/main; x)')",
        "elif m == 'inherited':",
        "    print(\"PR AUDIT INHERITED: developer-machine path in docs/note.txt  — already in origin/main, not this pull request's (last touched by deadbe0 Someone (feat: bad path))\")",
        "    print('PR AUDIT FAILED: t (2 files; 0 of this tree, 1 inherited from origin/main; x)')",
        "else:",
        "    print('PR AUDIT ok: t (2 files; the built-in rules only, not a publishing check)')",
        "sys.exit(0 if m == 'clean' else 1)",
    ].join("\n") + "\n",
  );
};

const names = (res) => (res.status === 0 ? "ok" : "fail");

test("preflight: чистый репозиторий проходит все проверки кроме усечённого клона", () => {
  const dir = makeRepo();
  try {
    const res = run(dir);
    const out = `${res.stdout}${res.stderr}`;
    assert.match(out, /preflight:/, "печатает заголовок");
    // В копии нет .git/shallow, значит shallow-проверка проходит.
    assert.match(out, /ok\s+клон не усечён/, `клон не shallow:\n${out}`);
    assert.match(out, /FAIL\s+relay\.user\.js/, "в копии нет собранного бандла — это честный FAIL");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("preflight: shallow-клон распознаётся и называется причиной", () => {
  const dir = makeRepo();
  try {
    const shallow = join(dir, ".git", "shallow");
    writeFileSync(shallow, `${gitIn(dir, ["rev-parse", "HEAD"])}\n`);
    const res = run(dir);
    const out = `${res.stdout}${res.stderr}`;
    assert.equal(res.status, 1, "shallow-клон = блокер");
    assert.match(out, /FAIL\s+клон не усечён/);
    assert.match(out, /git fetch --unshallow origin/, "подсказывает команду");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("preflight: зона из нескольких путей не склеивается в один шаблон", () => {
  const dir = makeRepo();
  try {
    gitIn(dir, ["checkout", "-q", "-b", "feat"]);
    writeFileSync(join(dir, "docs", "note.txt"), "y");
    gitIn(dir, ["add", "-A"]);
    gitIn(dir, ["commit", "-q", "-m", "docs"]);
    // «tools/script-cat/**, docs/**» — список, а не строка: пока шаблон был один,
    // вне зоны оказывалось вообще всё (включая сам docs/note.txt).
    const res = run(dir, ["--zone", "tools/script-cat/**, docs/**"]);
    assert.match(`${res.stdout}${res.stderr}`, /ok\s+только своя зона/, `список шаблонов работает:\n${res.stdout}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("preflight: имя файла из git status не теряет первую букву", () => {
  const dir = makeRepo();
  try {
    // Файл не закоммичен: путь берётся из `status --porcelain`, а не из diff.
    writeFileSync(join(dir, "docs", "note.txt"), "y");
    const res = run(dir, ["--zone", "docs/**"]);
    const out = `${res.stdout}${res.stderr}`;
    assert.match(out, /ok\s+только своя зона/, `незакоммиченный docs/ в зоне:\n${out}`);
    assert.doesNotMatch(out, /ocs\/note\.txt/, 'первая буква пути на месте');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("preflight: файл вне зоны роли блокирует push", () => {
  const dir = makeRepo();
  try {
    gitIn(dir, ["checkout", "-q", "-b", "feat"]);
    writeFileSync(join(dir, "docs", "note.txt"), "y");
    writeFileSync(join(dir, "docs", "chuzhoe.md"), "чужая правка");
    gitIn(dir, ["add", "-A"]);
    gitIn(dir, ["commit", "-q", "-m", "feat"]);
    const inside = run(dir, ["--zone", "docs/**"]);
    assert.match(`${inside.stdout}${inside.stderr}`, /ok\s+только своя зона/, "docs/** покрывает оба файла");
    const outside = run(dir, ["--zone", "tools/script-cat/**"]);
    assert.equal(outside.status, 1);
    assert.match(`${outside.stdout}${outside.stderr}`, /вне зоны: docs/, "называет файл");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("preflight: два решения в одном PR — блокер; дописанный ключ в контракт — норма", () => {
  const dir = makeRepo();
  try {
    gitIn(dir, ["checkout", "-q", "-b", "feat"]);
    const dp = join(dir, "docs", "DECISIONS.md");
    writeFileSync(dp, `${readFileSync(dp, "utf8")}\n## D-901 (1.0.1) — первое\n## D-902 (1.0.1) — второе\n`);
    gitIn(dir, ["add", "-A"]);
    gitIn(dir, ["commit", "-q", "-m", "feat"]);
    const res = run(dir);
    assert.equal(res.status, 1);
    assert.match(`${res.stdout}${res.stderr}`, /FAIL\s+ровно одно решение, ключ в контракте — в одном PR 2 решени/, "ругается на свалку");

    // Убираем второе решение и добавляем ключ в контракт — проверка должна пройти.
    writeFileSync(dp, `${readFileSync(dp, "utf8").replace("## D-902 (1.0.1) — второе\n", "")}`);
    const cp = join(dir, "tools", "script-cat", "contracts", "agent-protocol.json");
    const json = JSON.parse(readFileSync(cp, "utf8"));
    json.d901 = { version: "1.0.1", title: "первое" };
    writeFileSync(cp, JSON.stringify(json, null, 2));
    gitIn(dir, ["add", "-A"]);
    gitIn(dir, ["commit", "-q", "-m", "fix"]);
    const ok = run(dir);
    assert.match(`${ok.stdout}${ok.stderr}`, /ok\s+ровно одно решение/, `одно решение принято:\n${ok.stdout}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("preflight: правка src/** без подъёма версии — блокер, с подъёмом — норма", () => {
  const dir = makeRepo();
  try {
    gitIn(dir, ["checkout", "-q", "-b", "feat"]);
    const cp = join(dir, "tools", "script-cat", "src", "01-config.js");
    writeFileSync(cp, `${readFileSync(cp, "utf8")}\n// правка без выпуска\n`);
    gitIn(dir, ["add", "-A"]);
    gitIn(dir, ["commit", "-q", "-m", "src без версии"]);
    const bad = run(dir);
    assert.equal(bad.status, 1, "правка транспорта без версии не проходит");
    assert.match(`${bad.stdout}${bad.stderr}`, /FAIL\s+версия поднята только с правкой src/);

    const hp = join(dir, "tools", "script-cat", "src", "00-header.js");
    const header = readFileSync(hp, "utf8");
    const current = (header.match(/@version\s+([\d.]+)/) || [])[1];
    const [major, minor, patch] = current.split(".").map(Number);
    writeFileSync(hp, header.replace(/@version\s+[\d.]+/, `@version ${major}.${minor}.${patch + 1}`));
    gitIn(dir, ["add", "-A"]);
    gitIn(dir, ["commit", "-q", "-m", "версия вместе с правкой"]);
    const good = run(dir);
    assert.match(`${good.stdout}${good.stderr}`, /ok\s+версия поднята только с правкой src/, `версия и src идут вместе:\n${good.stdout}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("preflight: маркеры конфликта в файле — блокер", () => {
  const dir = makeRepo();
  try {
    gitIn(dir, ["checkout", "-q", "-b", "feat"]);
    writeFileSync(join(dir, "docs", "note.txt"), "<<<<<<< HEAD\nсвоё\n=======\nчужое\n>>>>>>> origin/main\n");
    gitIn(dir, ["add", "-A"]);
    gitIn(dir, ["commit", "-q", "-m", "conflict"]);
    const res = run(dir);
    assert.equal(res.status, 1);
    assert.match(`${res.stdout}${res.stderr}`, /FAIL\s+нет маркеров конфликта/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("preflight: нет tools/release — проверка публичного дерева пропускается, а не блокирует", () => {
  const dir = makeRepo();
  try {
    const res = run(dir);
    const out = `${res.stdout}${res.stderr}`;
    assert.match(out, /ok\s+публичное дерево проходит аудит.*нет tools\/release\/pr_audit\.py/, `пропуск без релизного лейна:\n${out}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test(
  "preflight: находка этого дерева блокирует push, унаследованная — нет, но названа",
  { skip: hasPython ? false : "нужен python3" },
  () => {
    const dir = makeRepo();
    try {
      stubAudit(dir);
      const own = run(dir, [], { PREFLIGHT_AUDIT_MODE: "own" });
      assert.match(
        `${own.stdout}${own.stderr}`,
        /FAIL\s+публичное дерево проходит аудит.*находки этого дерева \(1\): developer-machine path in docs\/note\.txt/,
        "своя находка называется и блокирует",
      );
      const inherited = run(dir, [], { PREFLIGHT_AUDIT_MODE: "inherited" });
      const out = `${inherited.stdout}${inherited.stderr}`;
      assert.match(out, /ok\s+публичное дерево проходит аудит.*унаследовано от origin\/main \(1\)/, `унаследованная — не блокер:\n${out}`);
      assert.doesNotMatch(out, /FAIL\s+публичное дерево/, "красное дерево main не превращается в блокер чужого PR");
      assert.match(out, /last touched by deadbe0 Someone/, "находка адресована тому, кто её внёс");
      const clean = run(dir, [], { PREFLIGHT_AUDIT_MODE: "clean" });
      assert.match(`${clean.stdout}${clean.stderr}`, /ok\s+публичное дерево проходит аудит.*аудит чист/, "чистое дерево");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

test("preflight: кириллица в пути не ломает проверку зоны (core.quotepath)", () => {
  const dir = makeRepo();
  try {
    gitIn(dir, ["checkout", "-q", "-b", "feat"]);
    writeFileSync(join(dir, "docs", "миссия-1.1.md"), "x");
    gitIn(dir, ["add", "-A"]);
    gitIn(dir, ["commit", "-q", "-m", "docs"]);
    const res = run(dir, ["--zone", "docs/**"]);
    const out = `${res.stdout}${res.stderr}`;
    assert.match(out, /ok\s+только своя зона/, `кириллический путь в зоне:\n${out}`);
    assert.doesNotMatch(out, /\\3[0-9][0-9]/, "git не отдаёт путь octal-экраном");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
