import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";

const source = readFileSync(new URL("../src/client.js", import.meta.url), "utf8");
const tick = () => new Promise((resolve) => setImmediate(resolve));
const response = (body = { ok: true }) => ({ ok: true, status: 200, json: async () => body });

function fixture({ transport, fetch = async () => response(), declarations = [] } = {}) {
	let exports;
	let cells = [];
	let cursor = 0;
	let updates = 0;
	let pendingEffects = [];
	const cleanups = [];
	const styles = [];
	const registered = [];
	const requires = [];
	const watchers = new Map();
	const declared = new Set(declarations);
	const jsx = (type, props) => ({ type, props });
	const react = {
		useState(initial) {
			const index = cursor++;
			if (!(index in cells)) cells[index] = typeof initial === "function" ? initial() : initial;
			return [cells[index], (next) => { updates++; cells[index] = typeof next === "function" ? next(cells[index]) : next; }];
		},
		useRef(initial) { const index = cursor++; return cells[index] ??= { current: initial }; },
		useEffect(run) { pendingEffects.push(run); },
		useMemo(run) { return run(); },
		useCallback(run) { return run; }
	};
	const context = vm.createContext({
		console: { info() {}, warn() {}, error() {} }, AbortController, URL, URLSearchParams,
		fetch, __DSH_TRANSPORT__: transport,
		window: { __ModuleLoader__: { load({ id, factory }) {
			assert.equal(id, "dsh-tokenledger-pro");
			exports = factory((id) => {
				requires.push(id);
				if (id === "react") return react;
				if (id === "react/jsx-runtime") return { jsx, jsxs: jsx };
				throw new Error(`Unexpected client dependency: ${id}`);
			});
		} }, addEventListener() {}, removeEventListener() {} },
		document: {
			querySelector: () => styles[0] ?? null,
			createElement: () => { const tag = { dataset: {}, remove() { const index = styles.indexOf(tag); if (index >= 0) styles.splice(index, 1); } }; return tag; },
			head: { appendChild: (tag) => styles.push(tag) }, addEventListener() {}, removeEventListener() {}
		}
	});
	vm.runInContext(source, context);
	function inject(name, callback) {
		const watch = { callback, dispose: undefined };
		const set = watchers.get(name) ?? new Set();
		watchers.set(name, set);
		set.add(watch);
		if (declared.has(name)) watch.dispose = callback();
		return () => { if (!set.delete(watch)) return; watch.dispose?.(); };
	}
	const ctx = {
		effect(run) { const cleanup = run(); if (typeof cleanup === "function") cleanups.push(cleanup); return cleanup; },
		locale: { register: () => () => {} },
		slots: {
			inject,
			register(spec, Component) {
				if (registered.some((item) => item.spec.name === spec.name && (item.spec.key ?? item.spec.id) === (spec.key ?? spec.id))) throw new Error("occupied slot");
				const entry = { spec, Component };
				registered.push(entry);
				return () => { const index = registered.indexOf(entry); if (index >= 0) registered.splice(index, 1); };
			}
		}
	};
	return {
		exports, requires, styles, registered, ctx,
		reload(nextSource) { vm.runInContext(nextSource, context); return exports; },
		get updates() { return updates; },
		render(Component, props = {}, reset = true) { cursor = 0; if (reset) cells = []; return Component(props); },
		effects() { const list = pendingEffects; pendingEffects = []; return list.map((run) => run()).filter((value) => typeof value === "function"); },
		unload() { for (const dispose of cleanups.splice(0).reverse()) dispose(); },
		declare(name) { declared.add(name); for (const watch of watchers.get(name) ?? []) watch.dispose = watch.callback(); },
		undeclare(name) { declared.delete(name); for (const watch of watchers.get(name) ?? []) { watch.dispose?.(); watch.dispose = undefined; } }
	};
}

function nodes(root) {
	if (root === null || root === false || root === undefined) return [];
	if (Array.isArray(root)) return root.flatMap(nodes);
	if (typeof root !== "object") return [];
	return [root, ...nodes(root.props?.children)];
}

test("materializing the client has no style side effect or primitives dependency", () => {
	const f = fixture();
	assert.equal(f.styles.length, 0);
	assert.deepEqual(f.requires, ["react", "react/jsx-runtime"]);
	assert.equal(f.exports.LedgerIcon({ size: 20, active: true }).props.width, 20);
});

test("Desktop requests use RpcFetch with relative paths and the original AbortSignal", async () => {
	const calls = [];
	let webCalls = 0;
	const transport = { fetch(path, init) { assert.equal(this, transport); calls.push({ path, init }); return Promise.resolve(response()); } };
	const f = fixture({ transport, fetch: () => { webCalls++; throw new Error("must not use browser fetch"); } });
	const controller = new AbortController();
	await f.exports.fetchJson(f.exports.USAGE_PATH + "?days=7&site=a", controller.signal);
	assert.equal(calls[0].path, "api/tokenledger/usage?days=7&site=a");
	assert.equal(calls[0].init.signal, controller.signal);
	assert.equal(webCalls, 0);
});

test("Web requests use the same document-relative URL without inventing a port", async () => {
	const calls = [];
	const f = fixture({ fetch: async (path, init) => { calls.push({ path, init }); return response(); } });
	await f.exports.fetchJson(f.exports.USAGE_PATH);
	assert.equal(calls[0].path, "api/tokenledger/usage");
});

test("a transport rejection never retries a credential operation through browser fetch", async () => {
	let webCalls = 0;
	const f = fixture({ transport: { fetch: async () => { throw new Error("disconnected"); } }, fetch: () => { webCalls++; } });
	await assert.rejects(f.exports.request("api/tokenledger/userauth", { method: "POST", body: "{}" }), /disconnected/);
	assert.equal(webCalls, 0);
});

for (const kind of ["useUsage", "useBalance"]) {
	test(`${kind} aborts on unmount and rejects a late uncooperative result`, async () => {
		let finish;
		let signal;
		const f = fixture({ transport: { fetch: (path, init) => { signal = init.signal; return new Promise((resolve) => { finish = resolve; }); } } });
		f.render(f.exports[kind], true);
		// Hooks are plain functions; pass their normal argument list directly.
		const cleanup = f.effects();
		assert.equal(signal.aborted, false);
		const before = f.updates;
		cleanup.forEach((run) => run());
		assert.equal(signal.aborted, true);
		finish(response());
		await tick();
		assert.equal(f.updates, before);
	});
}

test("the page reuses the ledger content with a region and no duplicate badge", () => {
	const f = fixture();
	const page = f.exports.TokenLedgerPage({});
	assert.equal(page.type, f.exports.TokenLedgerPanel);
	const root = f.render(page.type, page.props);
	assert.equal(root.props.className, "tkl_pageRoot");
	assert.equal(nodes(root).some((node) => node.props?.className === "tkl_badge"), false);
	assert.equal(nodes(root).some((node) => node.props?.role === "region"), true);
});

test("modern slot lifecycle hides legacy navigation and restores it when removed", () => {
	const f = fixture({ declarations: ["sidebar.footer.action"] });
	f.exports.apply(f.ctx);
	const legacy = f.registered.find((entry) => entry.spec.name === "sidebar.footer.action").Component;
	assert.equal(f.render(legacy).type, f.exports.TokenLedgerPanel);
	f.declare("main");
	f.declare("sidebar.panellist");
	assert.equal(f.registered.filter((entry) => entry.spec.name === "main").length, 1);
	assert.equal(f.registered.find((entry) => entry.spec.name === "main").spec.key, "tokenledger-pro");
	assert.equal(f.render(legacy), null);
	f.undeclare("sidebar.panellist");
	assert.equal(f.registered.some((entry) => entry.spec.name === "main"), false);
	assert.equal(f.render(legacy).type, f.exports.TokenLedgerPanel);
	f.unload();
	assert.equal(f.registered.length, 0);
	assert.equal(f.styles.length, 0);
});

test("a rejected modern registration leaves legacy navigation usable", () => {
	const f = fixture({ declarations: ["sidebar.footer.action", "main", "sidebar.panellist"] });
	const register = f.ctx.slots.register;
	f.ctx.slots.register = (spec, Component) => {
		if (spec.name === "main") throw new Error("synthetic registration failure");
		return register(spec, Component);
	};
	f.exports.apply(f.ctx);
	const legacy = f.registered.find((entry) => entry.spec.name === "sidebar.footer.action").Component;
	assert.equal(f.render(legacy).type, f.exports.TokenLedgerPanel);
	f.unload();
	assert.equal(f.registered.length, 0);
});

test("credential save uses Desktop POST and cannot call onSaved after unmount", async () => {
	const calls = [];
	let finishPost;
	let saved = 0;
	const f = fixture({ transport: { fetch: (path, init) => {
		calls.push({ path, init });
		return init.method === "POST" ? new Promise((resolve) => { finishPost = resolve; }) : Promise.resolve(response({ ok: true, origins: {} }));
	} } });
	const props = { account: { origin: "https://example.test", displayName: "Example" }, translate: (key) => key, onClose() {}, onSaved() { saved++; } };
	let root = f.render(f.exports.UserAuthDialog, props);
	const cleanup = f.effects();
	const inputs = nodes(root).filter((node) => node.type === "input");
	inputs[0].props.onChange({ target: { value: "42" } });
	inputs[1].props.onChange({ target: { value: "fixture-only-not-a-real-token" } });
	root = f.render(f.exports.UserAuthDialog, props, false);
	const save = nodes(root).find((node) => node.type === "button" && node.props.children === "dialog.save");
	const saving = save.props.onClick();
	const call = calls.find((entry) => entry.init.method === "POST");
	assert.equal(call.path, "api/tokenledger/userauth");
	assert.equal(JSON.parse(call.init.body).userId, 42);
	assert.ok(call.init.signal instanceof AbortSignal);
	cleanup.forEach((run) => run());
	assert.equal(call.init.signal.aborted, true);
	const before = f.updates;
	finishPost(response());
	await saving;
	await tick();
	assert.equal(saved, 0);
	assert.equal(f.updates, before);
});

test("unloading cancels wallet warming and prevents later fan-out", async () => {
	const calls = [];
	let finish;
	const f = fixture({ transport: { fetch: (path, init) => { calls.push({ path, init }); return new Promise((resolve) => { finish = resolve; }); } } });
	f.exports.apply(f.ctx);
	assert.equal(calls[0].path, "api/tokenledger/userauth");
	f.unload();
	assert.equal(calls[0].init.signal.aborted, true);
	finish(response({ ok: true, origins: { "https://example.test": { hasToken: true } } }));
	await tick();
	assert.equal(calls.length, 1);
});

test("the main page uses an opaque Host page surface instead of the popover palette", () => {
	const f = fixture();
	f.exports.apply(f.ctx);
	const css = f.styles[0].textContent;
	const page = css.match(/\.tkl_panel\.tkl_page\{([^}]+)\}/)[1];
	assert.ok(page.includes("background:var(--dsw-alias-bg-base)"));
	assert.ok(page.includes("color:var(--dsw-alias-label-primary)"));
	assert.equal(/color-mix|glass-opacity|bg-overlay|opacity:/.test(page), false);
	assert.ok(css.includes(".tkl_page .tkl_table th"));
	assert.ok(css.includes("body[data-ds-dark-theme] .tkl_panel"));
	assert.ok(css.includes("body:not([data-ds-dark-theme]) .tkl_panel"));
	f.unload();
});

test("overlapping apply owners share a stylesheet until the last owner unloads", () => {
	const f = fixture();
	f.exports.apply(f.ctx);
	f.exports.apply(f.ctx);
	assert.equal(f.styles.length, 1);
	assert.equal(f.styles[0].tokenLedgerOwners, 2);
	f.unload();
	assert.equal(f.styles.length, 0);
});

test("a newer factory replaces stylesheet content while the old owner overlaps", () => {
	const f = fixture();
	f.exports.apply(f.ctx);
	assert.ok(f.styles[0].textContent.includes("max-width:1100px"));
	const next = f.reload(source.replaceAll("max-width:1100px", "max-width:777px"));
	next.apply(f.ctx);
	assert.equal(f.styles.length, 1);
	assert.ok(f.styles[0].textContent.includes("max-width:777px"));
	assert.equal(f.styles[0].textContent.includes("max-width:1100px"), false);
	f.unload();
	assert.equal(f.styles.length, 0);
});

test("account changes hide the previous balance immediately while same-account refresh retains it", async () => {
	const pending = [];
	const f = fixture({ transport: { fetch: (path, init) => new Promise(resolve => pending.push({ path, init, resolve })) } });
	const render = (account, nonce = 0, reset = false) => f.render(() => f.exports.useBalance(true, account, nonce, 0), {}, reset);
	render("A", 0, true);
	let cleanup = f.effects();
	pending[0].resolve(response({ ok: true, account: "A", total: 10 }));
	await tick();
	assert.equal(render("A").data.total, 10);
	f.effects();
	cleanup.forEach(run => run());
	assert.equal(render("B").data, undefined, "the first render already fences the old account");
	cleanup = f.effects();
	pending.at(-1).resolve(response({ ok: true, account: "B", total: 20 }));
	await tick();
	assert.equal(render("B").data.total, 20);
	f.effects();
	cleanup.forEach(run => run());
	assert.equal(render("B", 1).data.total, 20, "same-account refresh may keep its own balance");
	for (const dispose of f.effects()) dispose();
});

test("the credential dialog cancels its state read when unmounted", async () => {
	let finish;
	let call;
	const f = fixture({ transport: { fetch: (path, init) => { call = { path, init }; return new Promise((resolve) => { finish = resolve; }); } } });
	f.render(f.exports.UserAuthDialog, { account: { origin: "https://example.test" }, translate: (key) => key, onClose() {}, onSaved() {} });
	const cleanup = f.effects();
	assert.equal(call.path, "api/tokenledger/userauth?origin=https%3A%2F%2Fexample.test");
	cleanup.forEach((run) => run());
	assert.equal(call.init.signal.aborted, true);
	const before = f.updates;
	finish(response({ ok: true, origins: {} }));
	await tick();
	assert.equal(f.updates, before);
});
