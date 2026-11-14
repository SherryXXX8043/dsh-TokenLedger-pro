import { normalizeOrigin } from "./relay-sites.js";

const PREFIX = "tokenledger-pro/origin-";

function failure(kind) {
	return Object.assign(new Error(`wallet-credentials: ${kind}`), { kind, code: kind });
}

function originOf(value) {
	if (typeof value !== "string") throw failure("invalid-origin");
	const origin = normalizeOrigin(value);
	if (origin === undefined) throw failure("invalid-origin");
	const url = new URL(value);
	if (url.username !== "" || url.password !== "") throw failure("invalid-origin");
	return origin;
}

// Current credentialKey(scope,id) accepts /^[a-z][a-z0-9-]*$/ per
// segment. encodeURIComponent(origin) is INVALID (% and punctuation). UTF-8
// hex is reversible, collision-free, and uses only allowed identifier bytes.
function keyOf(origin) {
	return PREFIX + Buffer.from(origin, "utf8").toString("hex");
}

function originFromKey(key) {
	if (typeof key !== "string" || !key.startsWith(PREFIX)) return undefined;
	const hex = key.slice(PREFIX.length);
	if (!/^(?:[0-9a-f]{2})+$/.test(hex)) return undefined;
	try {
		const origin = originOf(Buffer.from(hex, "hex").toString("utf8"));
		return keyOf(origin) === key ? origin : undefined;
	} catch { return undefined; }
}

function authOf(value) {
	if (value === null || typeof value !== "object" || !Number.isSafeInteger(value.userId) || value.userId <= 0 || typeof value.token !== "string" || value.token.trim() === "") return undefined;
	return { userId: value.userId, token: value.token };
}

function recordAuth(record, origin) {
	if (record?.kind !== "grant") return undefined;
	if (record.payload?.origin !== undefined && record.payload.origin !== origin) return undefined;
	return authOf(record.payload);
}

function normalizedAllowed(values) {
	if (values === undefined || values === null || typeof values === "string" || typeof values[Symbol.iterator] !== "function") throw failure("invalid-allowed-origins");
	return new Set(Array.from(values, originOf));
}

/**
 * Wallet secrets belong to the Host credential record store, never Config.
 * Each operation resolves the live service; no tokens or public projections
 * are cached across operations. legacyAuth is read-only migration fallback.
 */
export function createWalletCredentials(ctx, { legacyAuth } = {}) {
	const service = (...methods) => {
		const credentials = typeof ctx?.get === "function" ? ctx.get("credentials") : ctx?.credentials;
		if (credentials === undefined || methods.some(name => typeof credentials[name] !== "function")) throw failure("unavailable");
		return credentials;
	};
	const legacyEntries = () => {
		const source = typeof legacyAuth === "function" ? legacyAuth() : legacyAuth;
		return source !== null && typeof source === "object" ? Object.entries(source) : [];
	};
	const legacyFor = origin => {
		for (const [key, value] of legacyEntries()) {
			try { if (originOf(key) === origin) return authOf(value); } catch { /* Invalid old origin is not a credential. */ }
		}
		return undefined;
	};
	const readWith = async (credentials, origin) => {
		const record = await credentials.readRecord(keyOf(origin));
		// A present but invalid record must not silently resurrect old secrets.
		return record === undefined ? legacyFor(origin) : recordAuth(record, origin);
	};
	return {
		async read(value) {
			const origin = originOf(value);
			return readWith(service("readRecord"), origin);
		},
		async publicState(value, allowedOrigins) {
			const credentials = service("readRecord");
			const allowed = allowedOrigins === undefined ? undefined : normalizedAllowed(allowedOrigins);
			const origins = new Set();
			if (value !== undefined) origins.add(originOf(value));
			else if (allowed !== undefined) for (const origin of allowed) origins.add(origin);
			else {
				if (typeof credentials.listRecords !== "function") throw failure("unavailable");
				for (const entry of await credentials.listRecords()) {
					if (entry.kind !== "grant") continue;
					const origin = originFromKey(entry.key);
					if (origin !== undefined) origins.add(origin);
				}
				for (const [key] of legacyEntries()) {
					try { origins.add(originOf(key)); } catch { /* Ignore malformed legacy keys. */ }
				}
			}
			const result = {};
			for (const origin of origins) {
				if (allowed !== undefined && !allowed.has(origin)) continue;
				const auth = await readWith(credentials, origin);
				if (auth !== undefined) result[origin] = { userId: auth.userId, hasToken: true };
			}
			return result;
		},
		async save(body, allowedOrigins) {
			if (body === null || typeof body !== "object" || Array.isArray(body)) throw failure("invalid-body");
			const origin = originOf(body.origin);
			if (!normalizedAllowed(allowedOrigins).has(origin)) throw failure("origin-not-allowed");
			const key = keyOf(origin);
			if (body.remove === true) {
				const credentials = service("readRecord", "deleteRecord");
				if (legacyFor(origin) !== undefined) throw failure("legacy-removal-required");
				await credentials.deleteRecord(key);
				if (await credentials.readRecord(key) !== undefined) throw failure("delete-unconfirmed");
				return;
			}
			if (!Number.isSafeInteger(body.userId) || body.userId <= 0) throw failure("invalid-user-id");
			if (body.token !== undefined && typeof body.token !== "string") throw failure("invalid-token");
			const credentials = service("modifyRecord");
			let expected;
			const saved = await credentials.modifyRecord(key, async previous => {
				const previousAuth = previous === undefined ? legacyFor(origin) : recordAuth(previous, origin);
				const token = typeof body.token === "string" && body.token !== "" ? body.token : previousAuth?.token;
				expected = authOf({ userId: body.userId, token });
				if (expected === undefined) throw failure("invalid-token");
				return { kind: "grant", payload: { origin, ...expected } };
			});
			const confirmed = recordAuth(saved, origin);
			if (expected === undefined || confirmed?.userId !== expected.userId || confirmed?.token !== expected.token) throw failure("write-unconfirmed");
		}
	};
}
