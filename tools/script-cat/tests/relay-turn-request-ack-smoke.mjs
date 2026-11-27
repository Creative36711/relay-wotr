// Turn claim ownership ends when ScriptCat has durably adopted the local wait.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../src/46-relay-client.js', import.meta.url), 'utf8');
const from = src.indexOf('  function coordinatorTurnAck(');
const to = src.indexOf('\n  async function relayClientTick()', from);
assert.ok(from >= 0 && to > from, 'pure ACK classifier exists next to the turn handler');
const coordinatorTurnAck = new Function(`${src.slice(from, to)}; return coordinatorTurnAck;`)();

const waitingForPlan = coordinatorTurnAck({ expect: { kind: 'plan' } });
assert.deepEqual(waitingForPlan, {
  turnAck: true, retry: false, noMission: false,
}, 'expect:plan means local ownership accepted, not a request to retain the short Relay claim');
const savedSend = coordinatorTurnAck({ pending: { kind: 'send' } });
assert.equal(savedSend.retry, false, 'persisted send is also accepted locally');
const navigating = coordinatorTurnAck({ navigating: true });
assert.equal(navigating.retry, false, 'page switch is an active local handoff');
const empty = coordinatorTurnAck({});
assert.equal(empty.noMission, true, 'no local state and no mission closes a stale request');
const notStarted = coordinatorTurnAck({ mission: { id: 'mission-1' } });
assert.equal(notStarted.retry, true, 'mission exists but no local expectation: let the request be retried');
const notionError = coordinatorTurnAck({ missionError: 'Notion timeout' });
assert.equal(notionError.retry, true, 'read failure preserves retry instead of false no-mission');
assert.equal(notionError.missionError, 'Notion timeout');

assert.match(src, /await relayPost\(\{\s*action: "report", slotId,[\s\S]{0,350}coordinatorTurnAck\(/,
  'turn handler reports the classified ACK after tick(true)');
assert.match(src, /waiting\.kind === "plan" && relayClient\.turnRequestId[\s\S]{0,220}turnClaimRenew: true/,
  'while a sent plan is locally pending, ScriptCat renews the short Relay claim');
assert.match(src, /GM_setValue\("cfn-relay-turn-request-id", relayClient\.turnRequestId\)/,
  'claim identity survives an Arena reload so its local owner can keep renewing');
console.log('OK: Relay turn claim is acknowledged when local expect/pending/navigation owns the work; retry remains for an unstarted mission');
