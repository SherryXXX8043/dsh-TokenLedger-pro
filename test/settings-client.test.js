import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
const source = readFileSync(new URL("../src/client.js", import.meta.url), "utf8");
const tick = () => new Promise(resolve => setImmediate(resolve));
const response = (body, status = 200) => ({ ok: status === 200, status, json: async () => body });
const initial = { ok: true, writable: true, revision: 4, value: { relays: {}, rates: null, endpoints: [] } };
function harness(fetch) {
  let api, cursor = 0, cells = [], effects = [], updates = 0;
  const react = {
    useState(value) { const i = cursor++; if (!(i in cells)) cells[i] = typeof value === 'function' ? value() : value; return [cells[i], next => { updates++; cells[i] = typeof next === 'function' ? next(cells[i]) : next; }]; },
    useRef(value) { const i = cursor++; return cells[i] ??= { current: value }; },
    useEffect(run) { effects.push(run); }, useMemo(run) { return run(); }, useCallback(run) { return run; }
  };
  const jsx = (type, props) => ({ type, props });
  vm.runInNewContext(source, { console: { info() {}, warn() {}, error() {} }, AbortController, URL, fetch,
    window: { __ModuleLoader__: { load({ factory }) { api = factory(name => name === 'react' ? react : { jsx, jsxs: jsx }); } } } });
  return { api, render(Component = api.SettingsForm, props = { translate: key => key }) { cursor = 0; return Component(props); }, effects() { const list = effects; effects = []; return list.map(run => run()).filter(fn => typeof fn === 'function'); }, get updates() { return updates; } };
}
function nodes(value) {
  if (!value || typeof value !== 'object') return [];
  if (Array.isArray(value)) return value.flatMap(nodes);
  return [value, ...nodes(value.props?.children)];
}
function button(tree, label) { return nodes(tree).find(node => node.type === 'button' && node.props.children === label); }

test('default account selection respects temporary choices and falls back when removed', () => {
  const h = harness(() => {});
  const data = { defaultAccount: 'relay', accounts: [{ id: 'official' }, { id: 'relay' }] };
  assert.equal(h.api.resolveDisplayAccount(data), 'relay');
  assert.equal(h.api.resolveDisplayAccount(data, 'official'), 'official');
  assert.equal(h.api.resolveDisplayAccount(data, 'removed'), 'relay');
  assert.equal(h.api.resolveDisplayAccount({ ...data, defaultAccount: 'removed' }), 'official');
  assert.equal(h.api.resolveDisplayAccount({ accounts: [] }), undefined);
});

test('default account dropdown loads and saves a provider id with the other settings', async () => {
  let saved;
  const payload = { ...initial, accounts: [{ id: 'official', displayName: 'DeepSeek' }, { id: 'relay', displayName: 'Relay' }], value: { ...initial.value, defaultAccount: 'relay' } };
  const h = harness(async (path, init) => { if (init?.method === 'POST') { saved = JSON.parse(init.body); return response({ ok: true }); } return response(payload); });
  h.render(); const cleanup = h.effects(); await tick();
  let tree = h.render();
  const select = nodes(tree).find(node => node.type === 'select');
  assert.equal(select.props.value, 'relay');
  select.props.onChange({ target: { value: 'official' } });
  tree = h.render(); await button(tree, 'settings.save').props.onClick();
  assert.equal(saved.value.defaultAccount, 'official');
  cleanup.forEach(run => run());
});

test('settings summary does not load a form or start network requests', () => {
  let requests = 0;
  const h = harness(() => { requests++; });
  const summary = h.render(h.api.PluginSettings, { view: 'summary', t: key => key });
  assert.equal(summary.type, 'span');
  assert.equal(requests, 0);
});

test('settings form saves only JSON fields with the observed revision', async () => {
  const calls = [];
  const h = harness(async (path, init) => { calls.push({ path, init }); return response(init?.method === 'POST' ? { ok: true } : initial); });
  h.render(); const cleanup = h.effects(); await tick();
  let tree = h.render();
  const areas = nodes(tree).filter(node => node.type === 'textarea');
  assert.equal(areas.length, 3);
  areas[0].props.onChange({ target: { value: '{"relay":"https://relay.test/v1"}' } });
  tree = h.render();
  await button(tree, 'settings.save').props.onClick();
  const call = calls.find(call => call.init?.method === 'POST');
  assert.equal(call.path, 'api/tokenledger/settings');
  const payload = JSON.parse(call.init.body);
  assert.equal(payload.revision, 4);
  assert.deepEqual(Object.keys(payload.value).sort(), ['defaultAccount', 'endpoints', 'rates', 'relays']);
  assert.equal(payload.value.relays.relay, 'https://relay.test/v1');
  cleanup.forEach(run => run());
});

test('invalid JSON makes no write and a stale revision requires explicit reload', async () => {
  let writes = 0;
  const h = harness(async (path, init) => { if (init?.method === 'POST') { writes++; return response({ ok: false, error: 'settings-conflict' }, 409); } return response(initial); });
  h.render(); const cleanup = h.effects(); await tick();
  let tree = h.render();
  nodes(tree).find(node => node.type === 'textarea').props.onChange({ target: { value: 'bad json' } });
  tree = h.render(); await button(tree, 'settings.save').props.onClick();
  assert.equal(writes, 0);
  assert.ok(nodes(h.render()).some(node => node.props?.role === 'alert' && node.props.children === 'settings.invalidJson'));
  nodes(h.render()).find(node => node.type === 'textarea').props.onChange({ target: { value: '{}' } });
  tree = h.render(); await button(tree, 'settings.save').props.onClick();
  tree = h.render();
  assert.equal(writes, 1);
  assert.equal(button(tree, 'settings.save').props.disabled, true);
  assert.ok(nodes(tree).some(node => node.props?.role === 'alert' && node.props.children === 'settings.conflict'));
  cleanup.forEach(run => run());
});

test('settings reads and writes abort on unmount and ignore uncooperative responses', async () => {
  let finishRead, signal;
  const h = harness((path, init) => { signal = init.signal; return new Promise(resolve => { finishRead = resolve; }); });
  h.render(); const cleanup = h.effects();
  cleanup.forEach(run => run()); const before = h.updates;
  assert.equal(signal.aborted, true);
  finishRead(response(initial)); await tick();
  assert.equal(h.updates, before);

  let finishWrite, writeSignal, saved = 0;
  const w = harness((path, init) => init?.method === 'POST' ? new Promise(resolve => { finishWrite = resolve; writeSignal = init.signal; }) : Promise.resolve(response(initial)));
  const props = { translate: key => key, onSaved: () => saved++ };
  w.render(w.api.SettingsForm, props); const done = w.effects(); await tick();
  const pending = button(w.render(w.api.SettingsForm, props), 'settings.save').props.onClick();
  done.forEach(run => run()); const updates = w.updates;
  assert.equal(writeSignal.aborted, true);
  finishWrite(response({ ok: true })); await pending; await tick();
  assert.equal(saved, 0);
  assert.equal(w.updates, updates);
});
