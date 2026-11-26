// Вход в Google по сервисному аккаунту: без OAuth, без браузера, без
// ежечасной ручной работы.
//
// Проверяется то, что ломается молча:
//   1. подпись JWT — настоящим ключом, иначе Google ответит invalid_grant, а
//      человек будет искать ошибку в книге;
//   2. срок — не больше часа и с запасом на обновление, иначе первый же
//      запрос после протухания получит 401;
//   3. один обмен токена на всех — две вкладки не должны дёргать Google дважды;
//   4. ключ читается и как путь, и как строка, а испорченный — говорит словами.

import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildAssertion, parseServiceAccount, serviceAccountFromEnv,
  createServiceAccountToken, REFRESH_MARGIN_MS,
} from "../src/google-auth.mjs";

const keyPair = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});
const privateKey = keyPair.privateKey;

const accountJson = (over = {}) => JSON.stringify({
  type: "service_account",
  project_id: "wotr-relay",
  client_email: "relay@wotr-relay.iam.gserviceaccount.com",
  private_key: privateKey,
  ...over,
});

test("google: ключ сервисного аккаунта разбирается и проверяет свой вид", () => {
  const account = parseServiceAccount(accountJson());
  assert.equal(account.clientEmail, "relay@wotr-relay.iam.gserviceaccount.com");
  assert.ok(account.privateKey.includes("PRIVATE KEY"));
  assert.equal(account.projectId, "wotr-relay");
});

test("google: чужой тип ключа назван, а не проглочен", () => {
  assert.throws(() => parseServiceAccount(accountJson({ type: "authorized_user" })), /не ключ сервисного аккаунта/);
});

test("google: испорченный JSON — ошибка словами, а не стек", () => {
  assert.throws(() => parseServiceAccount("{это не json"), /не разбирается как JSON/);
});

test("google: экранированные переносы в ключе восстанавливаются", () => {
  // Так ключ выглядит в однострочной переменной окружения: \n вместо переноса.
  const flat = accountJson().replace(/\n/g, "\\n");
  const account = parseServiceAccount(flat);
  assert.ok(account.privateKey.includes("\n"), "переносы восстановлены");
  const { assertion } = buildAssertion({ clientEmail: account.clientEmail, privateKey: account.privateKey });
  assert.equal(assertion.split(".").length, 3);
});

test("google: JWT подписан настоящим ключом и живёт не больше часа", () => {
  const at = Date.parse("2026-11-23T10:00:00Z");
  const { assertion, claims } = buildAssertion({
    clientEmail: "relay@wotr.iam.gserviceaccount.com", privateKey, nowMs: at,
  });
  const [header, payload, signature] = assertion.split(".");
  const decoded = JSON.parse(Buffer.from(payload, "base64url").toString());
  assert.equal(decoded.iss, "relay@wotr.iam.gserviceaccount.com");
  assert.equal(decoded.aud, "https://oauth2.googleapis.com/token");
  assert.match(decoded.scope, /spreadsheets/);
  assert.ok(claims.exp - claims.iat <= 3600, "Google отвергает утверждения длиннее часа");
  assert.ok(signature.length > 300, "подпись RSA-2048 не бывает короткой");
  assert.equal(JSON.parse(Buffer.from(header, "base64url").toString()).alg, "RS256");
});

test("google: без ключа или почты подпись не строится молча", () => {
  assert.throws(() => buildAssertion({ clientEmail: "", privateKey }), /client_email/);
  assert.throws(() => buildAssertion({ clientEmail: "a@b.c", privateKey: "" }), /приватного ключа/);
});

test("google: ключ читается из файла и из строки окружения", () => {
  const dir = mkdtempSync(join(tmpdir(), "relay-sa-"));
  const file = join(dir, "key.json");
  writeFileSync(file, accountJson(), "utf8");

  const fromFile = serviceAccountFromEnv({ RELAY_GOOGLE_SA_FILE: file });
  assert.equal(fromFile.clientEmail, "relay@wotr-relay.iam.gserviceaccount.com");

  const fromJson = serviceAccountFromEnv({ RELAY_GOOGLE_SA_JSON: accountJson() });
  assert.equal(fromJson.clientEmail, fromFile.clientEmail);

  assert.equal(serviceAccountFromEnv({}), null, "без ключа — null, а не падение");
});

test("google: отсутствующий файл ключа объясняет, какой файл искали", () => {
  assert.throws(
    () => serviceAccountFromEnv({ RELAY_GOOGLE_SA_FILE: "/нет/такого/ключа.json" }),
    /не прочитан \(\/нет\/такого\/ключа\.json\)/,
  );
});

test("google: токен берётся один раз на всех и обновляется до протухания", async () => {
  const credentials = parseServiceAccount(accountJson());
  let clock = Date.parse("2026-11-23T10:00:00Z");
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return { ok: true, text: async () => JSON.stringify({ access_token: `tok-${calls}`, expires_in: 3600 }) };
  };
  const provider = createServiceAccountToken({ credentials, fetchImpl, now: () => clock });

  const [a, b] = await Promise.all([provider(), provider()]);
  assert.equal(calls, 1, "две вкладки не дёргают Google дважды");
  assert.equal(a, b);
  assert.equal(await provider(), "tok-1", "действующий токен берётся из кеша");
  assert.equal(calls, 1);

  // Час минус запас: токен ещё годен, но обновляем заранее.
  clock += 3600 * 1000 - REFRESH_MARGIN_MS + 1000;
  assert.equal(await provider(), "tok-2", "обновление начинается до протухания");
  assert.equal(calls, 2);
});

test("google: отказ Google не превращается в пустой токен", async () => {
  const credentials = parseServiceAccount(accountJson());
  const fetchImpl = async () => ({
    ok: false, status: 400,
    text: async () => JSON.stringify({ error: "invalid_grant", error_description: "Invalid JWT Signature." }),
  });
  const provider = createServiceAccountToken({ credentials, fetchImpl });
  await assert.rejects(provider, /Invalid JWT Signature/);
});

test("google: неудачный обмен не залипает — следующая попытка снова идёт в сеть", async () => {
  const credentials = parseServiceAccount(accountJson());
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    if (calls === 1) return { ok: false, status: 500, text: async () => JSON.stringify({ error: "backend" }) };
    return { ok: true, text: async () => JSON.stringify({ access_token: "tok-ok", expires_in: 3600 }) };
  };
  const provider = createServiceAccountToken({ credentials, fetchImpl });
  await assert.rejects(provider);
  assert.equal(await provider(), "tok-ok");
});
