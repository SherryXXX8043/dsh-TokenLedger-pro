import test from "node:test";
import assert from "node:assert/strict";
import { createWalletCredentials } from "../src/wallet-credentials.js";

const A = "https://relay.example";
const B = "https://relay.example:8443";
const key = origin => "tokenledger-pro/origin-" + Buffer.from(origin).toString("hex");
function fixture(options) {
	const records = new Map();
	const calls = [];
	const credentials = {
		async readRecord(id) { calls.push(["read", id]); return records.get(id); },
		async listRecords() { calls.push(["list"]); return [...records].map(([key, value]) => ({ key, kind: value.kind })); },
		async modifyRecord(id, mutate) {
			calls.push(["modify", id]);
			assert.match(id, /^[a-z][a-z0-9-]*\/[a-z][a-z0-9-]*$/);
			const value = await mutate(records.get(id));
			if (value !== undefined) records.set(id, value);
			return records.get(id);
		},
		async deleteRecord(id) { calls.push(["delete", id]); records.delete(id); }
	};
	const ctx = { get: name => name === "credentials" ? credentials : undefined };
	return { records, calls, credentials, ctx, wallet: createWalletCredentials(ctx, options) };
}
const rejectsKind = (promise, kind) => assert.rejects(promise, error => error.kind === kind);

test("save uses valid current credential keys and canonical HTTP origins", async () => {
	const f = fixture();
	await f.wallet.save({ origin: "HTTPS://Relay.Example:443/v1", userId: 42, token: "synthetic-A" }, [A]);
	assert.deepEqual(await f.wallet.read(A + "/anything"), { userId: 42, token: "synthetic-A" });
	assert.deepEqual(f.records.get(key(A)), { kind: "grant", payload: { origin: A, userId: 42, token: "synthetic-A" } });
	assert.equal(f.calls.some(call => call[1]?.includes("%")), false);
});

test("different origins including ports are isolated, and exact delete retains other records", async () => {
	const f = fixture();
	await f.wallet.save({ origin: A, userId: 1, token: "synthetic-A" }, [A, B]);
	await f.wallet.save({ origin: B, userId: 2, token: "synthetic-B" }, [A, B]);
	f.records.set("other-plugin/example", { kind: "grant", payload: { token: "unrelated" } });
	await f.wallet.save({ origin: A, remove: true }, [A]);
	assert.equal(await f.wallet.read(A), undefined);
	assert.deepEqual(await f.wallet.read(B), { userId: 2, token: "synthetic-B" });
	assert.ok(f.records.has("other-plugin/example"));
	assert.deepEqual(f.calls.filter(call => call[0] === "delete"), [["delete", key(A)]]);
});

test("updates preserve the current stored token inside serialized mutation", async () => {
	const f = fixture();
	await f.wallet.save({ origin: A, userId: 1, token: "synthetic-old" }, [A]);
	f.credentials.modifyRecord = async (id, mutate) => {
		const latest = { kind: "grant", payload: { origin: A, userId: 1, token: "synthetic-latest" } };
		const next = await mutate(latest);
		f.records.set(id, next);
		return next;
	};
	await f.wallet.save({ origin: A, userId: 3, token: "" }, [A]);
	assert.deepEqual(await f.wallet.read(A), { userId: 3, token: "synthetic-latest" });
});

test("public state is token-free, filters allowed origins and ignores foreign or malformed keys", async () => {
	const f = fixture();
	await f.wallet.save({ origin: A, userId: 1, token: "synthetic-secret-A" }, [A]);
	await f.wallet.save({ origin: B, userId: 2, token: "synthetic-secret-B" }, [B]);
	f.records.set("other-plugin/example", { kind: "grant", payload: { token: "unrelated-secret" } });
	f.records.set("tokenledger-pro/origin-zz", { kind: "grant", payload: {} });
	assert.deepEqual(await f.wallet.publicState(), { [A]: { userId: 1, hasToken: true }, [B]: { userId: 2, hasToken: true } });
	assert.deepEqual(await f.wallet.publicState(undefined, new Set([A + "/v1"])), { [A]: { userId: 1, hasToken: true } });
	assert.deepEqual(await f.wallet.publicState(B, [A]), {});
	assert.equal(JSON.stringify(await f.wallet.publicState()).includes("secret"), false);
	assert.equal(f.calls.filter(call => call[0] === "read").some(call => call[1] === "other-plugin/example"), false);
});

test("read-only legacy fallback can be migrated but deletion never resurrects legacy credentials", async () => {
	const legacy = { [A]: { userId: 7, token: "synthetic-legacy" } };
	const f = fixture({ legacyAuth: () => legacy });
	assert.deepEqual(await f.wallet.read(A), legacy[A]);
	assert.deepEqual(await f.wallet.publicState(A), { [A]: { userId: 7, hasToken: true } });
	await rejectsKind(f.wallet.save({ origin: A, remove: true }, [A]), "legacy-removal-required");
	assert.equal(f.calls.some(call => call[0] === "delete"), false);
	await f.wallet.save({ origin: A, userId: 8 }, [A]);
	assert.deepEqual(await f.wallet.read(A), { userId: 8, token: "synthetic-legacy" });
	await rejectsKind(f.wallet.save({ origin: A, remove: true }, [A]), "legacy-removal-required");
	assert.deepEqual(legacy[A], { userId: 7, token: "synthetic-legacy" });
	delete legacy[A];
	await f.wallet.save({ origin: A, remove: true }, [A]);
	assert.equal(await f.wallet.read(A), undefined);
});

test("invalid records do not fall back to legacy or expose another origin's payload", async () => {
	const f = fixture({ legacyAuth: { [A]: { userId: 1, token: "legacy" } } });
	f.records.set(key(A), { kind: "grant", payload: { origin: B, userId: 2, token: "wrong-origin" } });
	assert.equal(await f.wallet.read(A), undefined);
	assert.deepEqual(await f.wallet.publicState(A), {});
	f.records.set(key(A), { kind: "api-key", key: "wrong-kind" });
	assert.equal(await f.wallet.read(A), undefined);
});

test("unavailable record capability is explicit and never falls back to ordinary config writes", async () => {
	const wallet = createWalletCredentials({ get: () => undefined }, { legacyAuth: { [A]: { userId: 1, token: "legacy" } } });
	await rejectsKind(wallet.read(A), "unavailable");
	await rejectsKind(wallet.publicState(), "unavailable");
	await rejectsKind(wallet.save({ origin: A, userId: 1, token: "synthetic" }, [A]), "unavailable");
	const f = fixture();
	delete f.credentials.listRecords;
	await rejectsKind(f.wallet.publicState(), "unavailable");
	assert.deepEqual(await f.wallet.publicState(undefined, [A]), {});
});

test("invalid inputs and unapproved origins never mutate credentials", async () => {
	const f = fixture();
	for (const origin of ["file:///secret", "javascript:alert(1)", "not a URL", "https://user:pass@relay.example", null]) {
		await rejectsKind(f.wallet.save({ origin, userId: 1, token: "synthetic" }, [A]), "invalid-origin");
	}
	await rejectsKind(f.wallet.save({ origin: B, userId: 1, token: "synthetic" }, [A]), "origin-not-allowed");
	for (const userId of [0, -1, 1.5, "1", Number.MAX_SAFE_INTEGER + 1]) await rejectsKind(f.wallet.save({ origin: A, userId, token: "synthetic" }, [A]), "invalid-user-id");
	await rejectsKind(f.wallet.save({ origin: A, userId: 1, token: 5 }, [A]), "invalid-token");
	await rejectsKind(f.wallet.save({ origin: A, userId: 1 }, undefined), "invalid-allowed-origins");
	assert.equal(f.calls.some(call => call[0] === "modify" || call[0] === "delete"), false);
	await rejectsKind(f.wallet.save({ origin: A, userId: 1, token: "   " }, [A]), "invalid-token");
	assert.equal(f.records.size, 0);
});

test("failed writes, deletes and reads propagate instead of reporting success", async () => {
	const f = fixture();
	f.credentials.modifyRecord = async () => { throw new Error("synthetic write failure"); };
	await assert.rejects(f.wallet.save({ origin: A, userId: 1, token: "synthetic" }, [A]), /synthetic write failure/);
	f.credentials.modifyRecord = async () => undefined;
	await rejectsKind(f.wallet.save({ origin: A, userId: 1, token: "synthetic" }, [A]), "write-unconfirmed");
	f.records.set(key(A), { kind: "grant", payload: { userId: 1, token: "synthetic" } });
	f.credentials.deleteRecord = async () => { throw new Error("synthetic delete failure"); };
	await assert.rejects(f.wallet.save({ origin: A, remove: true }, [A]), /synthetic delete failure/);
	f.credentials.deleteRecord = async () => {};
	await rejectsKind(f.wallet.save({ origin: A, remove: true }, [A]), "delete-unconfirmed");
	f.credentials.readRecord = async () => { throw new Error("synthetic read failure"); };
	await assert.rejects(f.wallet.read(A), /synthetic read failure/);
	await assert.rejects(f.wallet.publicState(A), /synthetic read failure/);
});

test("live credential service replacement is observed without a cached secret", async () => {
	const f = fixture();
	await f.wallet.save({ origin: A, userId: 1, token: "synthetic" }, [A]);
	f.ctx.get = () => ({ readRecord: async () => undefined });
	assert.equal(await f.wallet.read(A), undefined);
});
