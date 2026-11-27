// Compact executor widget: core controls live in the Relay console.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const src = readFileSync(new URL('../relay.user.js', import.meta.url), 'utf8');
const panelStart = src.indexOf('  function mount() {');
const panelEnd = src.indexOf('  async function toggleAuto()', panelStart);
assert.ok(panelStart > 0 && panelEnd > panelStart, 'mount and executor helpers remain');
const panelMarkup = src.slice(panelStart, panelEnd);
assert.match(panelMarkup, /id="\$\{ui\.relay\}"[^>]*>Пульт ↗/, 'widget links to the primary console');
assert.match(panelMarkup, /id="cfn-panel-details" style="display:none/, 'log and secondary tools start collapsed');
assert.doesNotMatch(panelMarkup, /id="\$\{ui\.(?:step|wake|toggle|stop)\}"/,
  'the executor widget does not duplicate primary cycle controls');
assert.match(panelMarkup, /<details[^>]*>[\s\S]*?id="\$\{ui\.debug\}"[\s\S]*?id="\$\{ui\.reset\}"[\s\S]*?id="\$\{ui\.clear\}"/,
  'rare maintenance actions are tucked into a second-level disclosure');
assert.match(panelMarkup, /ui\.questions/, 'feedback remains an optional executor-side tool');
assert.match(panelMarkup, /ui\.agents/, 'agent provisioning remains an optional executor-side tool');

const chromeStart = src.indexOf('  const panelCollapsed =');
const chromeEnd = src.indexOf('  function mount()', chromeStart);
const chrome = src.slice(chromeStart, chromeEnd);
assert.match(chrome, /GM_getValue\(K\.collapsed, true\)/, 'first-time widget starts compact');
assert.match(chrome, /collapsed \? "270px" : "360px"/, 'compact and expanded widths are bounded');
assert.match(chrome, /cfn-panel-details/);
assert.match(chrome, /relayBase\(\)/, 'pult link follows the configured local Relay address');
assert.match(chrome, /function togglePanel\(\)[\s\S]*?paintPanelChrome\(\)/, 'journal drawer is user-toggleable');

console.log('compact widget: pult is primary; ScriptCat keeps status, link, log and secondary tools');
