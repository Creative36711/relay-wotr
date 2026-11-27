import test from "node:test";
import assert from "node:assert/strict";
import { networkDiagnosticVerdict, tcpFamilyDiagnostic } from "../src/notion-db.mjs";

test("an absent IPv6 address is informational when DNS returned usable IPv4", () => {
  const result = tcpFamilyDiagnostic([{ address: "208.103.161.2", family: 4 }], 6);
  assert.equal(result.ok, true);
  assert.match(result.detail, /не вернул адрес/);
});

test("connect timeout after successful IPv4 TCP and TLS is not misreported as blocked TCP", () => {
  const verdict = networkDiagnosticVerdict([
    { name: "DNS", ok: true },
    { name: "TCP IPv4", ok: true },
    { name: "TCP IPv6", ok: true },
    { name: "TLS", ok: true },
    { name: "Подмена сертификата", ok: true },
    { name: "Прокси Node", ok: true },
    { name: "Ответ Notion", ok: false },
    { name: "Книга", ok: true },
  ], { why: "UND_ERR_CONNECT_TIMEOUT" });
  assert.match(verdict, /TCP IPv4 и TLS до Notion проходят/);
  assert.match(verdict, /UND_ERR_CONNECT_TIMEOUT/);
  assert.match(verdict, /не ошибка токена/);
  assert.doesNotMatch(verdict, /TCP не проходит/);
});

test("an explicitly configured but inactive Node proxy is called out", () => {
  const verdict = networkDiagnosticVerdict([
    { name: "DNS", ok: true },
    { name: "Прокси Node", ok: false },
    { name: "Ответ Notion", ok: false },
  ], { why: "UND_ERR_CONNECT_TIMEOUT" });
  assert.match(verdict, /Прокси задан, но не применяется Node/);
});
