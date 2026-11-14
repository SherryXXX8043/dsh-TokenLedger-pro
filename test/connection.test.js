import test from "node:test";
import assert from "node:assert/strict";
import { LedgerStore } from "../src/store.js";
import { registerRoutes, registerConnectionRoutes, USAGE_PATH, BALANCE_PATH, USERAUTH_PATH } from "../src/http.js";

function fixture(overrides = {}) {
	const routes = new Map();
	const disposers = [];
	const connection = { fetch: { register(route) { routes.set(route.path, route); return () => routes.delete(route.path); } } };
	const ctx = {
		get: (key) => key === "connection" ? connection : undefined,
		effect: (fn) => { const dispose = fn(); disposers.push(dispose); return dispose; }
	};
	const store = LedgerStore.open(":memory:");
	registerRoutes(ctx, { store, sites: () => [], ...overrides });
	return { routes, connection, store, async close() { for (const dispose of disposers.reverse()) await dispose?.(); store.close(); } };
}

function request(path, init) { return new Request(`http://desktop.invalid${path}`, init); }

test("wallet failures expose safe actionable codes without original provider details", async () => {
	for (const [kind, status] of [["legacy-removal-required", 409], ["origin-not-allowed", 403], ["invalid-user-id", 400], ["unavailable", 503], ["write-unconfirmed", 409]]) {
		const f = fixture({ saveUserAuth: async () => { throw Object.assign(new Error("synthetic-private-provider-detail"), { kind }); } });
		try {
			const response = await f.routes.get(USERAUTH_PATH).fetch(request(USERAUTH_PATH, { method: "POST", body: "{}" }));
			assert.equal(response.status, status);
			assert.deepEqual(await response.json(), { ok: false, error: kind });
		} finally { await f.close(); }
	}
});

test("settings route reports revision conflicts and rejects arbitrary fields without leaking internals", async () => {
	const f = fixture({ readSettings: () => ({ ok: true, writable: true, revision: 3, value: { relays: {}, rates: null, endpoints: [] } }),
		saveSettings: async (body) => { if (body.revision !== 3) throw Object.assign(new Error("private stale details"), { code: "SETTINGS_CONFLICT" }); if (body.value.userAuth) throw new Error("invalid-settings-field"); } });
	try {
		const route = f.routes.get("/api/tokenledger/settings");
		assert.equal((await (await route.fetch(request("/api/tokenledger/settings"))).json()).revision, 3);
		for (const [body, status, error] of [
			[{ revision: 2, value: {} }, 409, "settings-conflict"],
			[{ revision: 3, value: { userAuth: {} } }, 400, "invalid-settings"]
		]) {
			const response = await route.fetch(request("/api/tokenledger/settings", { method: "POST", body: JSON.stringify(body) }));
			assert.equal(response.status, status);
			assert.deepEqual(await response.json(), { ok: false, error });
		}
	} finally { await f.close(); }
});

test("Connection-only Host serves usage without any HTTP listener or socket", async () => {
	let sweeps = 0;
	const f = fixture({ sweep: async () => sweeps++ });
	try {
		const route = f.routes.get(USAGE_PATH);
		assert.deepEqual(route.methods, ["GET"]);
		assert.equal(route.requestBody, "buffered");
		const response = await route.fetch(request(`${USAGE_PATH}?days=7`));
		assert.equal(response.status, 200);
		assert.equal(response.headers.get("cache-control"), "no-store");
		const payload = await response.json();
		assert.equal(payload.ok, true);
		assert.equal(payload.totals.tokens, 0);
		assert.equal(sweeps, 1);
	} finally { await f.close(); }
	assert.equal(f.routes.size, 0, "unloading removes the owned routes");
});

test("Connection balance passes exact selectors and cancellation to the same reader", async () => {
	let args;
	const f = fixture({ balance: async (...input) => { args = input; return { ok: true, total: 42 }; } });
	try {
		const controller = new AbortController();
		const req = request(`${BALANCE_PATH}?account=route-a&force=1&origin=https%3A%2F%2Frelay.example`, { signal: controller.signal });
		const response = await f.routes.get(BALANCE_PATH).fetch(req);
		assert.equal((await response.json()).total, 42);
		assert.deepEqual(args.slice(0, 3), ["route-a", true, "https://relay.example"]);
		assert.equal(args[3].signal, req.signal);
	} finally { await f.close(); }
});

test("Connection credential writes return no token and GET returns only public state", async () => {
	const saved = [];
	const f = fixture({ userAuth: () => ({ "https://relay.example": { userId: 5, hasToken: true } }), saveUserAuth: async body => saved.push(body) });
	try {
		const route = f.routes.get(USERAUTH_PATH);
		const post = await route.fetch(request(USERAUTH_PATH, { method: "POST", body: JSON.stringify({ origin: "https://relay.example", userId: 5, token: "synthetic-test-secret" }) }));
		assert.deepEqual(await post.json(), { ok: true });
		assert.equal(saved.length, 1);
		assert.equal(saved[0].token, "synthetic-test-secret");
		const get = await route.fetch(request(USERAUTH_PATH));
		const text = await get.text();
		assert.equal(text.includes("synthetic-test-secret"), false);
		assert.equal(JSON.parse(text).origins["https://relay.example"].hasToken, true);
	} finally { await f.close(); }
});

test("Connection credential requests are bounded in bytes before any setting write", async () => {
	let writes = 0;
	const f = fixture({ saveUserAuth: async () => writes++ });
	try {
		const route = f.routes.get(USERAUTH_PATH);
		for (const [body, expected] of [["not json", "invalid-json"], [JSON.stringify({ text: "汉".repeat(1500) }), "payload-too-large"]]) {
			const response = await route.fetch(request(USERAUTH_PATH, { method: "POST", body }));
			assert.equal(response.status, 400);
			assert.equal((await response.json()).error, expected);
		}
		assert.equal(writes, 0);
	} finally { await f.close(); }
});

test("Connection rejects writes to usage and redacts unexpected errors", async () => {
	const f = fixture({ sweep: async () => { throw new Error("synthetic-private-details"); } });
	try {
		const route = f.routes.get(USAGE_PATH);
		assert.equal((await route.fetch(request(USAGE_PATH, { method: "POST" }))).status, 405);
		const response = await route.fetch(request(USAGE_PATH));
		assert.equal(response.status, 500);
		assert.deepEqual(await response.json(), { ok: false, error: "internal" });
	} finally { await f.close(); }
});

test("Connection cancellation prevents a completed slow read being published", async () => {
	const controller = new AbortController();
	const f = fixture({ sweep: async () => controller.abort() });
	try {
		await assert.rejects(f.routes.get(USAGE_PATH).fetch(request(USAGE_PATH, { signal: controller.signal })), { name: "AbortError" });
	} finally { await f.close(); }
});

test("current Connection owns the Web API without shadowing its authenticated bridge", () => {
	const routes = [];
	const connectionRoutes = [];
	const ctx = {
		get: key => key === "webServer" ? { register: route => routes.push(route) } : key === "connection" ? {
			fetch: { register: route => connectionRoutes.push(route) }, requestRejection: () => 401
		} : undefined,
		effect: fn => fn()
	};
	registerRoutes(ctx, {});
	assert.equal(routes.length, 0);
	assert.equal(connectionRoutes.length, 1);
});

test("legacy loopback HTTP still honors authentication when only the older Connection fence exists", async () => {
	const routes = [];
	let sweeps = 0;
	const ctx = {
		get: key => key === "webServer" ? { register: route => routes.push(route) } : key === "connection" ? {
			requestRejection: () => 401
		} : undefined,
		effect: fn => fn()
	};
	registerRoutes(ctx, { sweep: () => sweeps++ });
	const sent = [];
	await routes[0].handler({ method: "GET", url: USAGE_PATH, headers: { host: "127.0.0.1:12345" }, socket: { remoteAddress: "127.0.0.1" } }, {
		writeHead: status => sent.push(status), end() {}
	});
	assert.deepEqual(sent, [401]);
	assert.equal(sweeps, 0);
});

test("a late Connection removes legacy exact routes that would shadow the shared bridge", () => {
	const waits = new Map();
	const http = new Map();
	const ipc = new Map();
	const web = { register(route) { http.set(route.path, route); return () => http.delete(route.path); } };
	const ctx = { inject: (names, run) => waits.set(names[0], run), get: () => undefined, effect: fn => fn() };
	registerRoutes(ctx, {});
	waits.get("webServer")({ webServer: web, effect: fn => fn() });
	assert.equal(http.size, 1);
	waits.get("connection")({ get: () => ({ fetch: { register(route) { ipc.set(route.path, route); return () => ipc.delete(route.path); } } }), effect: fn => fn() });
	assert.equal(http.size, 0);
	assert.equal(ipc.size, 1);
});

test("late Connection mount registers independent routes without a Web server", () => {
	const waits = new Map();
	const routes = [];
	const ctx = { inject: (names, run) => waits.set(names[0], run), get: () => undefined, effect: fn => fn() };
	assert.equal(registerRoutes(ctx, { routeWaitMs: 0 }), true);
	waits.get("connection")({ get: () => ({ fetch: { register: route => routes.push(route) } }), effect: fn => fn() });
	assert.equal(routes[0].path, USAGE_PATH);
});
