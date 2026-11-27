import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const BRANCH = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/;
const SECRET_KEYS = ["notion", "gwUrl", "gwKey", "github", "ntfyToken"];

function cleanProfile(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Профиль должен быть JSON-объектом.");
  const profile = {
    id: String(input.id || "").trim(),
    name: String(input.name || "").trim(),
    roles: String(input.roles || "").trim(),
    missions: String(input.missions || "").trim(),
    requests: String(input.requests || "").trim(),
    questions: String(input.questions || "").trim(),
    pageUrl: String(input.pageUrl || "").trim(),
    questionsUrl: String(input.questionsUrl || "").trim(),
    repo: String(input.repo || "").trim(),
    branch: String(input.branch || "main").trim(),
    driveFolder: String(input.driveFolder || "").trim(),
    ntfyTopic: String(input.ntfyTopic || "").trim(),
    repos: Array.isArray(input.repos) ? input.repos.map((item) => ({
      repo: String(item?.repo || "").trim(), branch: String(item?.branch || "main").trim(), main: item?.main === true,
    })) : [],
    roleRepos: Array.isArray(input.roleRepos) ? input.roleRepos.map((item) => ({
      roleId: String(item?.roleId || "").trim(), repo: String(item?.repo || "").trim(),
    })) : [],
  };
  for (const [key, value] of Object.entries(input)) {
    if (/^agent(?:Provision|Bootstrap|Url|Rename)/.test(key)) profile[key] = value;
  }
  if (!UUID.test(profile.id)) throw new Error("ID профиля должен быть UUID.");
  if (!profile.name || profile.name.length > 80) throw new Error("Укажите название профиля (до 80 символов).");
  const ids = [profile.roles, profile.missions, profile.requests, profile.questions];
  if (ids.some((id) => !UUID.test(id)) || new Set(ids.map((id) => id.toLowerCase())).size !== 4)
    throw new Error("Нужны четыре разных UUID источников Notion.");
  for (const value of [profile.pageUrl, profile.questionsUrl]) {
    let url;
    try { url = new URL(value); } catch { throw new Error("Ссылки Notion должны быть HTTPS URL."); }
    if (url.protocol !== "https:" || url.username || url.password || !["app.notion.com", "notion.so", "www.notion.so"].includes(url.hostname))
      throw new Error("Ссылки Notion должны вести на доверенный HTTPS-домен Notion.");
  }
  if (!profile.repos.length && profile.repo) profile.repos = [{ repo: profile.repo, branch: profile.branch, main: true }];
  if (!profile.repos.length || profile.repos.some((item) => !REPO.test(item.repo) || !BRANCH.test(item.branch)))
    throw new Error("Добавьте минимум один корректный GitHub owner/repo и ветку.");
  const mainEntries = profile.repos.filter((item) => item.main);
  if (mainEntries.length !== 1) throw new Error("У репозиториев должен быть ровно один главный.");
  profile.repo = mainEntries[0].repo;
  profile.branch = mainEntries[0].branch;
  if (profile.roleRepos.some((item) => !UUID.test(item.roleId) || !profile.repos.some((repo) => repo.repo.toLowerCase() === item.repo.toLowerCase())))
    throw new Error("Маршрут роли должен ссылаться на UUID роли и настроенный репозиторий.");
  if (!/^[a-z0-9][a-z0-9._-]{0,50}$/.test(profile.driveFolder) || profile.driveFolder.includes("..") ||
      ["logs", "payloads", "artifacts"].includes(profile.driveFolder))
    throw new Error("Папка Drive должна быть коротким безопасным именем проекта.");
  if (profile.ntfyTopic && !/^[A-Za-z0-9_-]{1,64}$/.test(profile.ntfyTopic))
    throw new Error("ntfy topic должен содержать 1–64 символа: латинские буквы, цифры, дефис или подчёркивание.");
  return profile;
}

function cleanSecrets(input = {}, previous = {}, { clearSecrets = false } = {}) {
  const result = {};
  for (const key of SECRET_KEYS) {
    const value = String(input[key] || "").trim();
    result[key] = clearSecrets ? "" : value || String(previous[key] || "");
  }
  if (result.gwUrl) {
    let url;
    try { url = new URL(result.gwUrl); } catch { throw new Error("Drive Gateway URL некорректен."); }
    if (url.protocol !== "https:" || url.username || url.password || !url.pathname.replace(/\/$/, "").endsWith("/exec"))
      throw new Error("Drive Gateway требует HTTPS URL /exec без логина и пароля в адресе.");
  }
  if (result.notion && !/^(ntn_|secret_)/.test(result.notion)) throw new Error("Токен Notion должен начинаться с ntn_ или secret_.");
  return result;
}

const publicProfile = (entry) => ({
  ...entry.profile,
  secretStatus: Object.fromEntries(SECRET_KEYS.map((key) => [key, Boolean(entry.secrets?.[key])])),
  updatedAt: entry.updatedAt || "",
});

export function createProjectConfigStore({ file = "" } = {}) {
  let memory = { format: "relay-project-config", version: 1, activeProjectId: "", profiles: [] };
  const read = async () => {
    if (!file) return structuredClone(memory);
    try {
      const parsed = JSON.parse(await readFile(file, "utf8"));
      if (parsed?.format !== "relay-project-config" || parsed.version !== 1 || !Array.isArray(parsed.profiles))
        throw new Error("формат файла настроек проектов не распознан");
      return { ...parsed, activeProjectId: String(parsed.activeProjectId || "") };
    } catch (error) {
      if (error.code === "ENOENT") return { format: "relay-project-config", version: 1, activeProjectId: "", profiles: [] };
      throw error;
    }
  };
  const write = async (data) => {
      if (!file) { memory = structuredClone(data); return; }
    await mkdir(dirname(file), { recursive: true });
    const temp = join(dirname(file), `.projects-${randomUUID()}.tmp`);
    await writeFile(temp, `${JSON.stringify(data, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
    await chmod(temp, 0o600);
    await rename(temp, file);
  };
  return {
    async list() { return (await read()).profiles.map(publicProfile); },
    async activeProjectId() { return String((await read()).activeProjectId || ""); },
    async ensureActiveProject(projectId) {
      const id = String(projectId || "").trim();
      if (!id) return false;
      const data = await read();
      if (data.activeProjectId) return false;
      if (!data.profiles.some((item) => item.profile.id.toLowerCase() === id.toLowerCase())) return false;
      data.activeProjectId = id;
      await write(data);
      return true;
    },
    async setActiveProject(projectId) {
      const id = String(projectId || "").trim();
      const data = await read();
      const entry = data.profiles.find((item) => item.profile.id.toLowerCase() === id.toLowerCase());
      if (!entry) throw new Error("Выбранный профиль не найден в Relay.");
      if (!entry.secrets?.notion || !entry.secrets?.gwUrl || !entry.secrets?.gwKey)
        throw new Error("Перед переключением сохраните Notion token и Drive Gateway URL/key.");
      data.activeProjectId = entry.profile.id;
      await write(data);
      return publicProfile(entry);
    },
    async get(projectId) {
      const entry = (await read()).profiles.find((item) => item.profile.id.toLowerCase() === String(projectId || "").toLowerCase());
      return entry ? structuredClone(entry) : null;
    },
    async save({ profile: rawProfile, secrets: rawSecrets, clearSecrets = false } = {}) {
      const profile = cleanProfile(rawProfile);
      const data = await read();
      const index = data.profiles.findIndex((item) => item.profile.id.toLowerCase() === profile.id.toLowerCase());
      const previous = index >= 0 ? data.profiles[index] : null;
      const secrets = cleanSecrets(rawSecrets, previous?.secrets, { clearSecrets });
      const entry = { profile, secrets, updatedAt: new Date().toISOString() };
      if (index >= 0) data.profiles[index] = entry;
      else data.profiles.push(entry);
      await write(data);
      return publicProfile(entry);
    },
  };
}

export { cleanProfile, publicProfile };
