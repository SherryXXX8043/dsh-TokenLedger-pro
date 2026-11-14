/**
 * Sweep tests against the NEW handle-based sessionPersistence seam.
 *
 * These cover the compatibility fix in plugin.js:
 *  - list()/open(id, "read")/read(offset)/close() replaced listSnapshots()/readFrom()
 *  - revision moved ⇒ the fold re-reads the whole log from scratch, because the
 *    v1→v2 session migration renumbers seqs and a checkpoint's consumedSeq can
 *    overshoot the renamed log
 *  - current forks use handle.inheritedEventCount as a log offset; historical
 *    handle mocks retain header.seedLength compatibility
 *  - inherited route metadata survives without inherited accounting
 *  - empty owned tails still replace prior rows and checkpoint revisions
 *  - unchanged revision ⇒ skip without a read
 *  - an old-style persistence (readFrom) still works
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { sweep } from "../src/plugin.js";
import { LedgerStore } from "../src/store.js";

const T0 = 1788855293000; // 2026-09-08 local day

/** One v2-shaped assistant/message carrying a usage sample. */
function msg(seq, provider, model, usage, time = T0, turn = 1, step = 1) {
	return {
		type: "assistant/message",
		seq,
		time,
		data: { turn, step, usage, message: { source: { provider, model } } }
	};
}

/** New-API-shaped persistence mock. sessions: Map(id -> { events, revision, header? }). */
function persistenceOf(sessions) {
	return {
		async list() {
			return [...sessions.entries()].map(([id, s]) => ({ header: { id, ...(s.header ?? {}) }, revision: s.revision }));
		},
		async open(id) {
			const s = sessions.get(id);
			if (s === undefined) throw new Error(`not found: ${id}`);
			return {
				header: { id, ...(s.header ?? {}) },
				inheritedEventCount: s.inheritedEventCount,
				async read(offset = 0) {
					return { events: s.events.slice(offset), eventState: "detached" };
				},
				async close() {}
			};
		}
	};
}

function usage(over = {}) {
	return { inputTokens: 100, outputTokens: 50, cacheReadTokens: 2000, cacheWriteTokens: 0, reasoningTokens: 10, ...over };
}

test("folds usage through the handle-based API", async () => {
	const sessions = new Map([
		["session-a", {
			revision: "rev-1",
			events: [
				msg(0, "deepseek-official", "deepseek-v4-pro", usage(), T0, 1, 1),
				msg(1, "deepseek-official", "deepseek-v4-flash", usage({ cacheReadTokens: 5000 }), T0, 1, 2)
			]
		}]
	]);
	const store = LedgerStore.open(":memory:");
	const stats = await sweep(persistenceOf(sessions), store, {});
	assert.equal(stats.updated, 1);
	assert.equal(stats.failed, 0);
	const total = store.totals({});
	assert.equal(total.inputTokens, 200);
	assert.equal(total.outputTokens, 100);
	assert.equal(total.cacheReadTokens, 7000);
	assert.equal(total.requests, 2);
	assert.equal(total.tokens, 7300);
	const cp = store.checkpointFor("session-a");
	assert.equal(cp.logRevision, "rev-1");
	assert.equal(cp.consumedSeq, 1);
	store.close();
});

test("unchanged revision is skipped without a read", async () => {
	const sessions = new Map([
		["session-a", { revision: "rev-1", events: [msg(0, "deepseek-official", "deepseek-v4-pro", usage())] }]
	]);
	const store = LedgerStore.open(":memory:");
	let reads = 0;
	const persistence = {
		async list() {
			return [...sessions.entries()].map(([id, s]) => ({ header: { id }, revision: s.revision }));
		},
		async open(id) {
			reads++;
			const s = sessions.get(id);
			return { async read(offset = 0) { return { events: s.events.slice(offset) }; }, async close() {} };
		}
	};
	await sweep(persistence, store, {});
	const stats = await sweep(persistence, store, {});
	assert.equal(stats.skipped, 1);
	assert.equal(stats.updated, 0);
	// Exactly ONE read happened: the first sweep, not the skipped second one.
	assert.equal(reads, 1);
	store.close();
});

test("revision trust is granted only after a successful full commit", async () => {
	const sessions = new Map([["s1", { revision: "same", inheritedEventCount: 0, events: [msg(0, "p", "m", usage())] }]]);
	const persistence = persistenceOf(sessions);
	const store = LedgerStore.open(":memory:");
	try {
		await sweep(persistence, store);
		const trustedRevisionSessions = new Set();
		let fail = true;
		const guarded = { ...persistence, open: async (id) => {
			if (fail) throw new Error("synthetic read refusal");
			return persistence.open(id);
		} };
		assert.equal((await sweep(guarded, store, { trustedRevisionSessions })).failed, 1);
		assert.equal(trustedRevisionSessions.size, 0);
		fail = false;
		assert.equal((await sweep(guarded, store, { trustedRevisionSessions })).updated, 1);
		assert.equal(trustedRevisionSessions.has("s1"), true);
		assert.equal((await sweep(guarded, store, { trustedRevisionSessions })).skipped, 1);
	} finally { store.close(); }
});

test("renumbered v2 seqs refold from scratch without double counting", async () => {
	// First fold in old seq space (v1 numbering, large seqs).
	const logV1 = [msg(7000, "deepseek-official", "deepseek-v4-pro", usage())];
	const sessions = new Map([["session-a", { revision: "rev-1", events: logV1 }]]);
	const store = LedgerStore.open(":memory:");
	await sweep(persistenceOf(sessions), store, {});
	assert.equal(store.totals({}).requests, 1);

	// The v1→v2 migration rewrites the log: seqs renumbered from 0, and the
	// events carry the same token figures. Revision moved.
	sessions.set("session-a", {
		revision: "rev-2",
		events: [
			msg(0, "deepseek-official", "deepseek-v4-pro", usage()),
			// Same turn, NEW step: a genuinely new sample in the renumbered log.
			msg(1, "deepseek-official", "deepseek-v4-pro", usage({ inputTokens: 300, outputTokens: 25 }), T0, 1, 2)
		]
	});
	const stats = await sweep(persistenceOf(sessions), store, {});
	assert.equal(stats.updated, 1);
	const total = store.totals({});
	// Old rows were REPLACED wholesale, not added to: input 100+300, not 100*2+300.
	assert.equal(total.inputTokens, 400);
	assert.equal(total.outputTokens, 75);
	assert.equal(total.cacheReadTokens, 4000);
	assert.equal(total.requests, 2);
	const cp = store.checkpointFor("session-a");
	assert.equal(cp.logRevision, "rev-2");
	assert.equal(cp.consumedSeq, 1);
	store.close();
});

test("a full re-read starts past header.seedLength", async () => {
	// A forked session: the log carries its parent's prefix (seq 0) and one
	// event of its own (seq 1). Only the own event may land in the ledger.
	const sessions = new Map([
		["session-fork", {
			revision: "rev-1",
			header: { seedLength: 1 },
			events: [
				msg(0, "deepseek-official", "deepseek-v4-pro", usage({ inputTokens: 9000 }), T0, 1, 1),
				msg(1, "deepseek-official", "deepseek-v4-pro", usage(), T0, 2, 1)
			]
		}]
	]);
	const store = LedgerStore.open(":memory:");
	const stats = await sweep(persistenceOf(sessions), store, {});
	assert.equal(stats.updated, 1);
	const total = store.totals({});
	// input 9000 (the inherited prefix) must NOT be counted, only 100.
	assert.equal(total.inputTokens, 100);
	assert.equal(total.requests, 1);
	// A second sweep at the same revision still skips without re-reading.
	const again = await sweep(persistenceOf(sessions), store, {});
	assert.equal(again.skipped, 1);
	store.close();
});

test("current handle inheritedEventCount is an offset independent of event sequence values", async () => {
	const sessions = new Map([["child", {
		revision: "r1", header: { isSeeded: true }, inheritedEventCount: 1,
		// Nonzero sequence values deliberately expose treating a count as a seq predicate.
		events: [msg(800, "p", "m", usage({ inputTokens: 9000 })), msg(801, "p", "m", usage(), T0, 2)]
	}]]);
	const store = LedgerStore.open(":memory:");
	try {
		const stats = await sweep(persistenceOf(sessions), store);
		assert.equal(stats.failed, 0);
		assert.equal(stats.events, 1);
		assert.equal(store.totals().inputTokens, 100);
		assert.equal(store.totals().requests, 1);
	} finally { store.close(); }
});

test("current nested forks bill each source request once", async () => {
	const parent = [msg(0, "p", "m", usage({ inputTokens: 100 }))];
	const child = [...parent, msg(1, "p", "m", usage({ inputTokens: 50 }), T0, 2)];
	const grandchild = [...child, msg(2, "p", "m", usage({ inputTokens: 25 }), T0, 3)];
	const sessions = new Map([
		["parent", { revision: "p1", header: { isSeeded: false }, inheritedEventCount: 0, events: parent }],
		["child", { revision: "c1", header: { isSeeded: true }, inheritedEventCount: 1, events: child }],
		["grandchild", { revision: "g1", header: { isSeeded: true }, inheritedEventCount: 2, events: grandchild }]
	]);
	const store = LedgerStore.open(":memory:");
	try {
		await sweep(persistenceOf(sessions), store);
		assert.equal(store.totals().inputTokens, 175);
		assert.equal(store.totals().requests, 3);
		sessions.get("grandchild").revision = "g2";
		await sweep(persistenceOf(sessions), store);
		assert.equal(store.totals().inputTokens, 175, "revision movement refolds rather than adds");
	} finally { store.close(); }
});

test("an owned attempt inherits only routing metadata, never inherited usage", async () => {
	const events = [
		{ seq: 0, time: T0, type: "request/header", data: { header: { config: { provider: "old", model: "old-m" } } } },
		msg(1, "old", "old-m", usage({ inputTokens: 9000 })),
		{ seq: 2, time: T0, type: "request/context", data: { provider: "new", model: "new-m" } },
		{ seq: 3, time: T0, type: "assistant/attempt", data: { turn: 2, step: 1, stream: [
			{ type: "chunk", time: T0, chunk: { type: "usage", usage: usage({ inputTokens: 100 }) } }
		] } }
	];
	const sessions = new Map([["child", { revision: "r1", header: { isSeeded: true }, inheritedEventCount: 3, events }]]);
	const store = LedgerStore.open(":memory:");
	try {
		await sweep(persistenceOf(sessions), store, { resolveSite: (provider) => provider });
		assert.equal(store.totals().inputTokens, 100);
		assert.equal(store.byRoute()[0].provider, "new");
		assert.equal(store.byRoute()[0].model, "new-m");
		assert.equal(store.byRoute()[0].site, "new");
	} finally { store.close(); }
});

test("a changed handle log with no owned events replaces obsolete rows and checkpoints", async () => {
	const sessions = new Map([["child", {
		revision: "r1", header: { isSeeded: true }, inheritedEventCount: 0,
		events: [msg(0, "p", "m", usage({ inputTokens: 9000 }))]
	}]]);
	const store = LedgerStore.open(":memory:");
	try {
		const persistence = persistenceOf(sessions);
		await sweep(persistence, store);
		sessions.get("child").inheritedEventCount = 1;
		sessions.get("child").revision = "r2";
		const stats = await sweep(persistence, store);
		assert.equal(stats.updated, 1);
		assert.equal(store.totals().requests, 0);
		assert.equal(store.checkpointFor("child").logRevision, "r2");
		assert.equal((await sweep(persistence, store)).skipped, 1);
	} finally { store.close(); }
});

test("a seeded current handle missing or misreporting its cut fails closed and is closed", async () => {
	for (const inheritedEventCount of [undefined, -1, 2, 0.5]) {
		let closes = 0;
		const store = LedgerStore.open(":memory:");
		try {
			const stats = await sweep({
				list: async () => [{ header: { id: "child", isSeeded: true }, revision: "r1" }],
				open: async () => ({
					header: { id: "child", isSeeded: true }, inheritedEventCount,
					read: async () => ({ events: [msg(0, "p", "m", usage())], eventState: "shared-frozen" }),
					close: async () => { closes++; }
				})
			}, store);
			assert.equal(stats.failed, 1);
			assert.equal(store.totals().requests, 0);
			assert.equal(store.checkpointFor("child"), undefined);
			assert.equal(closes, 1);
		} finally { store.close(); }
	}
});

test("old readFrom persistence still works (backward compatibility)", async () => {
	let readCalls = 0;
	const persistence = {
		async listSnapshots() {
			return [{ header: { id: "session-a" }, revision: "rev-1" }];
		},
		async readFrom() {
			readCalls++;
			return { events: [msg(0, "deepseek-official", "deepseek-v4-pro", usage())] };
		}
	};
	const store = LedgerStore.open(":memory:");
	const stats = await sweep(persistence, store, {});
	assert.equal(stats.updated, 1);
	assert.equal(readCalls, 1);
	assert.equal(store.totals({}).requests, 1);
	store.close();
});
