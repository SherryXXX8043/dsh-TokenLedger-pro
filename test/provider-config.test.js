import assert from "node:assert/strict";
import test from "node:test";
import { readProviderDirectory, readProviderPath } from "../src/provider-config.js";

const volatile = (value) => ({ get: () => value, [Symbol.for("cosmokit.volatile.write")]: () => {} });
const provider = (route, extra = {}) => ({ provider: route, settingsNs: "custom-pi", settingsPath: ["providers", route], declared: true, ...extra });
const row = (ns, config) => ({ entry: { id: `include:${ns}`, options: { id: ns, config: { ordinary: "raw-is-not-authoritative" } }, fiber: { state: 2, effectiveConfig: config } }, inherited: {}, override: {} });
const ctx = (entries, services = {}) => ({ get: (name) => name === "llm" ? { listConfigurableProviders: () => entries } : services[name] });

test("current ConfigEditor effectiveConfig supplies ordinary fields and nested volatile values", () => {
	let describeCalls = 0;
	const entry = provider("gateway");
	const directory = readProviderDirectory(ctx([entry], {
		configEditor: { configuration: () => [row("custom-pi", { providers: volatile({ gateway: { baseURL: "https://gateway.test/v1", apiKeyEnv: "GATEWAY_REF" } }) })] },
		settings: { describe: () => { describeCalls++; return []; } }
	}));
	assert.equal(directory.available, true);
	assert.equal(directory.endpointFor(entry), "https://gateway.test/v1");
	assert.equal(directory.referenceFor(entry), "GATEWAY_REF");
	assert.equal(describeCalls, 0);
});

test("Entry options.id is the exact address; module names and Entry.id suffixes are not aliases", () => {
	const entry = provider("gateway");
	const wrong = row("other-pi", { providers: { gateway: { baseURL: "https://wrong.test" } } });
	wrong.entry.id = "include:custom-pi";
	wrong.entry.options.name = "custom-pi";
	const directory = readProviderDirectory(ctx([entry], { configEditor: { configuration: () => [wrong] } }));
	assert.equal(directory.available, false);
	assert.equal(directory.endpointFor(entry), undefined);
});

test("unrelated Config entries and secret accessors are not inspected", () => {
	let touched = 0;
	const unrelated = row("other", {});
	Object.defineProperty(unrelated.entry.fiber, "effectiveConfig", { get() { touched++; throw new Error("must not read"); } });
	const profile = { baseURL: "https://safe.test/v1", apiKeyEnv: "SAFE_REF" };
	Object.defineProperty(profile, "apiKey", { get() { touched++; throw new Error("must not read"); } });
	Object.defineProperty(profile, "headers", { get() { touched++; throw new Error("must not read"); } });
	const entry = provider("gateway");
	const directory = readProviderDirectory(ctx([entry], { configEditor: { configuration: () => [unrelated, row("custom-pi", { providers: { gateway: profile } })] } }));
	assert.equal(directory.endpointFor(entry), "https://safe.test/v1");
	assert.equal(directory.referenceFor(entry), "SAFE_REF");
	assert.equal(touched, 0);
});

test("only shared volatile references are unwrapped; ordinary get methods are never called", () => {
	assert.equal(readProviderPath(volatile({ providers: volatile({ gateway: { baseURL: volatile("https://safe.test") } }) }), ["providers", "gateway", "baseURL"]), "https://safe.test");
	let called = 0;
	assert.equal(readProviderPath({ get() { called++; return { baseURL: "https://wrong.test" }; } }, ["baseURL"]), undefined);
	assert.equal(called, 0);
	const loop = { [Symbol.for("cosmokit.volatile.write")]: () => {}, get: () => loop };
	assert.equal(readProviderPath(loop), undefined);
});

test("a projected Settings form alone does not prove ordinary endpoint fields are absent", () => {
	const entry = provider("openai", { declared: false, defaultBaseURL: "https://api.openai.com/v1" });
	const directory = readProviderDirectory(ctx([entry], { settings: { describe: () => [{ ns: "custom-pi", value: { providers: { openai: { apiKeyEnv: "REF" } } } }] } }));
	assert.equal(directory.available, false);
	assert.equal(directory.endpointFor(entry), undefined);
	assert.equal(directory.referenceFor(entry), undefined);
});

test("a projected volatile endpoint remains readable without ConfigEditor", () => {
	const entry = provider("gateway");
	const directory = readProviderDirectory(ctx([entry], { settings: { describe: () => [{ ns: "custom-pi", value: { providers: { gateway: { baseURL: "https://volatile.test/v1" } } } }] } }));
	assert.equal(directory.available, true);
	assert.equal(directory.endpointFor(entry), "https://volatile.test/v1");
});

test("raw options.config expressions are not evaluated or used as resolved endpoints", () => {
	const entry = provider("gateway");
	const raw = row("custom-pi", undefined);
	raw.entry.options.config = { providers: { gateway: { baseURL: "https://raw.test/v1", apiKeyEnv: { __jsExpr: "secret()" } } } };
	const directory = readProviderDirectory(ctx([entry], { configEditor: { configuration: () => [raw] } }));
	assert.equal(directory.available, false);
	assert.equal(directory.endpointFor(entry), undefined);
});

test("duplicate namespace rows fail closed instead of selecting another provider's credential", () => {
	const entry = provider("gateway");
	const directory = readProviderDirectory(ctx([entry], {
		configEditor: { configuration: () => [row("custom-pi", { providers: { gateway: { baseURL: "https://a.test" } } }), row("custom-pi", { providers: { gateway: { baseURL: "https://b.test" } } })] },
		settings: { describe: () => [{ ns: "custom-pi", value: { providers: { gateway: { baseURL: "https://form.test" } } } }] }
	}));
	assert.equal(directory.available, false);
	assert.equal(directory.endpointFor(entry), undefined);
});

test("catalog defaults are used only after a complete profile snapshot and explicit endpoint wins", () => {
	const entry = provider("openai", { declared: false, defaultBaseURL: "https://api.openai.com/v1" });
	let profile = {};
	const context = ctx([entry], { configEditor: { configuration: () => [row("custom-pi", { providers: { openai: profile } })] } });
	assert.equal(readProviderDirectory(context).endpointFor(entry), "https://api.openai.com/v1");
	profile = { baseURL: "https://relay.test/v1" };
	assert.equal(readProviderDirectory(context).endpointFor(entry), "https://relay.test/v1");
	profile = { baseURL: "" };
	assert.equal(readProviderDirectory(context).endpointFor(entry), undefined, "an invalid explicit endpoint must not send a key to the default");
});

test("declared endpoint environment variables are respected without reading native auth keys", () => {
	const entry = provider("catalog", { declared: false, defaultBaseURL: "https://api.catalog.test/v1", baseURLEnv: ["CATALOG_ENDPOINT"], nativeAuth: { env: ["CATALOG_API_KEY"], oauth: true } });
	const requested = [];
	const context = ctx([entry], {
		configEditor: { configuration: () => [row("custom-pi", { providers: { catalog: {} } })] },
		launchEnvironment: { get(name) { requested.push(name); assert.equal(name, "CATALOG_ENDPOINT"); return { value: "https://env-relay.test/v1", source: "process" }; } }
	});
	assert.equal(readProviderDirectory(context).endpointFor(entry), "https://env-relay.test/v1");
	assert.deepEqual(requested, ["CATALOG_ENDPOINT"]);
});

test("unknown routes with no endpoint are never invented as DeepSeek", () => {
	const entry = provider("custom");
	const directory = readProviderDirectory(ctx([entry], { settings: { get: () => ({ providers: { custom: {} } }) } }));
	assert.equal(directory.available, true);
	assert.equal(directory.endpointFor(entry), undefined);
});

test("unreadable directories report unavailable and do not assume default endpoints", () => {
	const entry = provider("catalog", { declared: false, defaultBaseURL: "https://catalog.test" });
	for (const services of [
		{ settings: {} },
		{ configEditor: { configuration() { throw new Error("not ready"); } } },
		{ configEditor: { configuration: () => [] }, settings: { describe: () => [] } },
		{ settings: { get() { throw new Error("not ready"); } } }
	]) {
		const directory = readProviderDirectory(ctx([entry], services));
		assert.equal(directory.available, false);
		assert.equal(directory.endpointFor(entry), undefined);
	}
});

test("endpoint strings with embedded credentials and unsafe path segments are rejected", () => {
	const entry = provider("gateway");
	for (const endpoint of ["https://user:pass@relay.test/v1", "https://relay.test/v1?key=synthetic-secret", "https://relay.test/v1#synthetic-secret"]) {
		const directory = readProviderDirectory(ctx([entry], { settings: { get: () => ({ providers: { gateway: { baseURL: endpoint } } }) } }));
		assert.equal(directory.endpointFor(entry), undefined);
	}
	assert.equal(readProviderPath(Object.create({ inherited: "secret" }), ["inherited"]), undefined);
	assert.equal(readProviderPath({}, ["__proto__"]), undefined);
});
