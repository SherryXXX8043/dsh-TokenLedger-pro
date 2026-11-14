import test from "node:test";
import assert from "node:assert/strict";
import { Config, configValue, createSettingsAccess, registerNamespace } from "../src/settings-schema.js";

test("current Config publishes live non-secret fields and plain startup fields", () => {
	const parsed = Config({ database: ":memory:", relays: { relay: "https://relay.example/v1" } });
	assert.equal(parsed.database, ":memory:");
	assert.deepEqual(configValue(parsed.relays), { relay: "https://relay.example/v1" });
	assert.deepEqual(configValue(parsed.endpoints), []);
	assert.equal(configValue(parsed.rates), undefined);
	assert.equal(Config.dict.relays.meta.volatile, true);
	assert.equal(Config.dict.userAuth.meta.volatile, undefined);
});

function fixture() {
	const calls = [];
	const settings = {
		describe(options) { assert.equal(options.redactSecrets, true); return [{ ns: "tokenledger-pro", revision: 7 }]; },
		async mutate(ns, ops, revision) { calls.push({ ns, ops, revision }); if (revision !== 7) throw Object.assign(new Error("conflict"), { code: "SETTINGS_CONFLICT" }); },
		async update(ns, patch, revision) { calls.push({ ns, patch, revision }); }
	};
	const ctx = { fiber: { entry: { id: "include:tokenledger-pro", options: { id: "tokenledger-pro" } } }, get: key => key === "settings" ? settings : undefined };
	const config = { relays: {}, rates: undefined, endpoints: [], userAuth: { hidden: { token: "fixture-secret" } } };
	return { calls, settings, ctx, config };
}

test("settings endpoint exposes only non-secret fields and requires descriptor revision", async () => {
	const f = fixture();
	const access = createSettingsAccess(f.ctx, f.config);
	const view = access.read();
	assert.equal(view.writable, true);
	assert.equal(view.revision, 7);
	assert.equal(JSON.stringify(view).includes("fixture-secret"), false);
	await access.save({ revision: 7, value: { relays: {}, rates: null, endpoints: [] } });
	assert.deepEqual(f.calls[0], { ns: "tokenledger-pro", revision: 7, ops: [
		{ op: "set", path: ["relays"], value: {} }, { op: "unset", path: ["rates"] }, { op: "set", path: ["endpoints"], value: [] }
	] });
	await assert.rejects(access.save({ revision: 6, value: { relays: {} } }), { code: "SETTINGS_CONFLICT" });
});

test("settings writes reject credentials, arbitrary fields and missing revisions", async () => {
	const f = fixture();
	const access = createSettingsAccess(f.ctx, f.config);
	for (const body of [{ value: {} }, { revision: 7, value: { userAuth: {} } }, { revision: 7, value: { database: "other.sqlite" } }, { revision: 7, value: { relays: [] } }, { revision: 7, value: { rates: "free" } }, { revision: 7, value: { endpoints: {} } }]) {
		await assert.rejects(access.save(body), /invalid-settings/);
	}
	assert.equal(f.calls.length, 0);
});

test("default account is volatile, validates new choices and allows automatic fallback", async () => {
	assert.equal(configValue(Config({}).defaultAccount), "");
	assert.equal(Config.dict.defaultAccount.meta.volatile, true);
	const f = fixture();
	const access = createSettingsAccess(f.ctx, f.config, { accounts: () => [{ id: "relay", displayName: "Relay", secret: "must-not-leak" }] });
	assert.deepEqual(access.read().accounts, [{ id: "relay", displayName: "Relay" }]);
	await access.save({ revision: 7, value: { defaultAccount: "relay" } });
	assert.deepEqual(f.calls[0].ops, [{ op: "set", path: ["defaultAccount"], value: "relay" }]);
	await assert.rejects(access.save({ revision: 7, value: { defaultAccount: "missing" } }), /invalid-settings-default-account/);
	await access.save({ revision: 7, value: { defaultAccount: "" } });
	f.config.defaultAccount = "removed";
	await access.save({ revision: 7, value: { defaultAccount: "removed" } });
});

test("current settings adapter addresses the root Loader entry without old registration", async () => {
	const f = fixture();
	const adapter = await registerNamespace(f.settings, {}, () => { throw new Error("must not assign volatile refs"); }, f.ctx);
	await adapter.scope.update({ relays: { relay: "https://example.test" } });
	assert.equal(f.calls[0].ns, "tokenledger-pro");
	assert.equal(f.calls[0].revision, 7);
	await adapter.remove("relay");
	assert.deepEqual(f.calls[1].ops, [{ op: "unset", path: ["relays", "relay"] }]);
});
