import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProjectConfigStore } from "../src/project-config.mjs";

const profile = () => ({
  id: "123e4567-e89b-12d3-a456-426614174000", name: "WOTR",
  roles: "123e4567-e89b-12d3-a456-426614174001", missions: "123e4567-e89b-12d3-a456-426614174002",
  requests: "123e4567-e89b-12d3-a456-426614174003", questions: "123e4567-e89b-12d3-a456-426614174004",
  pageUrl: "https://www.notion.so/workspace/page-123e4567e89b12d3a456426614174005",
  questionsUrl: "https://www.notion.so/workspace/questions-123e4567e89b12d3a456426614174006",
  repo: "Creative36711/open-bfme", branch: "main", driveFolder: "wotr",
  repos: [{ repo: "Creative36711/open-bfme", branch: "main", main: true }], roleRepos: [],
});

test("project config persists profile + secrets privately, but list never returns secret values", async () => {
  const dir = await mkdtemp(join(tmpdir(), "relay-project-config-"));
  const file = join(dir, "project-config.json");
  try {
    const store = createProjectConfigStore({ file });
    const saved = await store.save({ profile: profile(), secrets: {
      notion: "ntn_example", gwUrl: "https://script.google.com/macros/s/deploy/exec", gwKey: "gateway-secret", github: "ghp_secret",
    } });
    assert.equal(saved.secretStatus.notion, true);
    assert.equal("notion" in saved, false);
    assert.equal("secrets" in saved, false);
    const mode = (await stat(file)).mode & 0o777;
    assert.equal(mode, 0o600);
    const secret = await store.get(profile().id);
    assert.equal(secret.secrets.notion, "ntn_example");
    assert.equal((await store.list()).length, 1);
    const raw = await readFile(file, "utf8");
    assert.match(raw, /gateway-secret/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("blank secret fields preserve saved credentials; clearing is explicit", async () => {
  const store = createProjectConfigStore();
  await store.save({ profile: profile(), secrets: { notion: "ntn_example", gwUrl: "https://script.google.com/macros/s/deploy/exec", gwKey: "gateway-secret" } });
  await store.save({ profile: { ...profile(), name: "WOTR updated" }, secrets: { notion: "", gwUrl: "", gwKey: "" } });
  assert.equal((await store.get(profile().id)).secrets.notion, "ntn_example");
  await store.save({ profile: profile(), secrets: {}, clearSecrets: true });
  assert.equal((await store.get(profile().id)).secrets.notion, "");
});

test("active profile is persisted, first hello may seed it, and selecting needs required credentials", async () => {
  const fileDir = await mkdtemp(join(tmpdir(), "relay-active-project-"));
  const file = join(fileDir, "project-config.json");
  try {
    const store = createProjectConfigStore({ file });
    await store.save({ profile: profile(), secrets: {} });
    assert.equal(await store.activeProjectId(), "");
    assert.equal(await store.ensureActiveProject(profile().id), true);
    assert.equal(await store.ensureActiveProject("00000000-0000-4000-8000-000000000000"), false);
    assert.equal(await store.activeProjectId(), profile().id);
    await assert.rejects(() => store.setActiveProject(profile().id), /сохраните Notion token/);
    await store.save({ profile: profile(), secrets: {
      notion: "ntn_example", gwUrl: "https://script.google.com/macros/s/deploy/exec", gwKey: "gateway-secret",
    } });
    await store.setActiveProject(profile().id);
    const reloaded = createProjectConfigStore({ file });
    assert.equal(await reloaded.activeProjectId(), profile().id);
  } finally { await rm(fileDir, { recursive: true, force: true }); }
});

test("invalid project identity, Notion source IDs and gateway URLs are rejected", async () => {
  const store = createProjectConfigStore();
  await assert.rejects(() => store.save({ profile: { ...profile(), id: "not-a-uuid" } }), /ID профиля/);
  await assert.rejects(() => store.save({ profile: { ...profile(), questions: profile().requests } }), /четыре разных UUID/);
  await assert.rejects(() => store.save({ profile: profile(), secrets: { gwUrl: "http://example.com/exec" } }), /HTTPS URL/);
});
