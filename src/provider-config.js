/**
 * Read one provider configuration generation without copying provider secrets.
 *
 * DSH 0.2.2-rc.3's ConfigEditor.configuration() returns Loader Entries. The
 * authoritative, interpolated Config is entry.fiber.effectiveConfig; options
 * holds raw expressions and inherited/override are not resolved Config values.
 * Settings.describe() projects volatile fields only, so it is a fallback for
 * those fields, never an authority that ordinary fields are absent.
 */

const VOLATILE_WRITE = Symbol.for("cosmokit.volatile.write");
const LEGACY_ORIGINS = new Map([
	["zai", "https://api.z.ai"],
	["zai-coding-cn", "https://open.bigmodel.cn"]
]);

function service(ctx, name) {
	try { return typeof ctx?.get === "function" ? ctx.get(name) : undefined; }
	catch { return undefined; }
}

/** Dereference only the shared volatile protocol, not arbitrary get() fields. */
function dereference(value) {
	const seen = new Set();
	while (value !== null && typeof value === "object" && VOLATILE_WRITE in value) {
		if (seen.has(value) || seen.size >= 32 || typeof value.get !== "function") return undefined;
		seen.add(value);
		value = value.get();
	}
	return value;
}

/** Exact own-data traversal; neither inherited names nor unrelated getters run. */
export function readProviderPath(section, path = []) {
	let current = dereference(section);
	for (const key of path) {
		if (typeof key !== "string" || key === "__proto__" || key === "prototype" || key === "constructor") return undefined;
		if (current === null || typeof current !== "object" || Array.isArray(current)) return undefined;
		const field = Object.getOwnPropertyDescriptor(current, key);
		if (field === undefined || !("value" in field)) return undefined;
		current = dereference(field.value);
	}
	return current;
}

function validSection(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function publicEndpoint(value) {
	if (typeof value !== "string" || value.trim() === "") return undefined;
	try {
		const url = new URL(value);
		if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password || url.search || url.hash) return undefined;
		return value;
	} catch { return undefined; }
}

function officialDeepSeekEntry(entry) {
	return entry.provider === "deepseek-official" && Array.isArray(entry.settingsPath) && entry.settingsPath.length === 0;
}

/**
 * Snapshot the provider directory and exact namespace readers for one operation.
 * Calling this never resolves credentials, reads raw API keys, or logs config.
 * The returned profile accessor keeps internal Config objects on the Host only.
 */
export function readProviderDirectory(ctx, options = {}) {
	const llm = service(ctx, "llm");
	const unavailable = { available: false, entries: [], profileFor: () => undefined, endpointFor: () => undefined, referenceFor: () => undefined };
	if (typeof llm?.listConfigurableProviders !== "function") return unavailable;
	let entries;
	try {
		entries = llm.listConfigurableProviders();
		if (!Array.isArray(entries)) return unavailable;
	} catch { return unavailable; }

	const settings = service(ctx, "settings");
	const editor = service(ctx, "configEditor");
	const legacyReader = typeof options.readSection === "function" ? options.readSection
		: typeof settings?.get === "function" ? (ns) => settings.get(ns) : undefined;
	const sections = new Map();
	const completeNamespaces = new Set();
	const wantedNamespaces = new Set(entries.map((entry) => entry?.settingsNs).filter((ns) => typeof ns === "string" && ns !== ""));
	const ambiguousNamespaces = new Set();
	let sourceAvailable = legacyReader !== undefined;
	let legacy = legacyReader !== undefined;
	if (legacyReader === undefined) {
		legacy = false;
		if (typeof editor?.configuration === "function") {
			try {
				const rows = editor.configuration();
				if (Array.isArray(rows)) {
					sourceAvailable = true;
					const seenNamespaces = new Set();
					for (const row of rows) {
						const entry = row?.entry;
						const ns = entry?.options?.id;
						if (!wantedNamespaces.has(ns)) continue;
						if (seenNamespaces.has(ns)) {
							sections.delete(ns);
							completeNamespaces.delete(ns);
							ambiguousNamespaces.add(ns);
							continue;
						}
						seenNamespaces.add(ns);
						// No alias, module-name or suffix matching: the provider directory
						// names entry.options.id, not Entry.id (which includes parents).
						if (entry.disabled === true || (entry.fiber?.state !== undefined && entry.fiber.state !== 2)) continue;
						const config = entry.fiber?.effectiveConfig;
						if (config !== undefined) {
							sections.set(ns, config);
							completeNamespaces.add(ns);
						}
					}
				}
			} catch { /* Missing current configuration is not an empty profile. */ }
		}
		if (typeof settings?.describe === "function" && [...wantedNamespaces].some((ns) => !sections.has(ns) && !ambiguousNamespaces.has(ns))) {
			try {
				const descriptors = settings.describe({ redactSecrets: true });
				if (Array.isArray(descriptors)) {
					sourceAvailable = true;
					const seen = new Set();
					for (const descriptor of descriptors) {
						const ns = descriptor?.ns;
						if (!wantedNamespaces.has(ns) || ambiguousNamespaces.has(ns) || seen.has(ns)) continue;
						seen.add(ns);
						if (!sections.has(ns) && validSection(descriptor.value)) sections.set(ns, descriptor.value);
					}
				}
			} catch { /* Effective Config remains usable when forms are absent. */ }
		}
	}
	if (!sourceAvailable) return unavailable;

	let readableNamespaces = 0;
	const readSection = (ns) => {
		if (!sections.has(ns) && legacyReader !== undefined) {
			let value;
			try { value = legacyReader(ns); } catch { /* Isolate one unavailable namespace. */ }
			sections.set(ns, value);
		}
		return sections.get(ns);
	};
	const profiles = new Map();
	for (const entry of entries) {
		if (typeof entry?.provider !== "string" || typeof entry.settingsNs !== "string") continue;
		try {
			const section = dereference(readSection(entry.settingsNs));
			if (!validSection(section)) continue;
			readableNamespaces++;
			profiles.set(entry, readProviderPath(section, entry.settingsPath ?? []));
		} catch { /* One failed volatile reference must not poison the pass. */ }
	}
	// A projected Settings service with no matching provider fields cannot prove
	// all routes are direct. Keep the prior attribution safe at the call site.
	const available = entries.length === 0 || readableNamespaces > 0;
	if (!available) return { ...unavailable, entries };

	const environment = service(ctx, "launchEnvironment");
	const profileFor = (entry) => profiles.get(entry);
	const fieldFor = (entry, key) => {
		try { return readProviderPath(profileFor(entry), [key]); } catch { return undefined; }
	};
	const endpointFor = (entry) => {
		if (!profiles.has(entry)) return undefined;
		const explicit = fieldFor(entry, "baseURL") ?? fieldFor(entry, "baseUrl");
		if (explicit !== undefined) return publicEndpoint(explicit);
		if (!legacy && !completeNamespaces.has(entry.settingsNs)) return undefined;
		// Only endpoint variables declared by the directory are consulted. Native
		// authentication environment names are deliberately not read here.
		for (const name of Array.isArray(entry.baseURLEnv) ? entry.baseURLEnv : []) {
			if (typeof name !== "string" || name === "") continue;
			let value;
			try { value = typeof environment?.get === "function" ? environment.get(name)?.value : process.env[name]; }
			catch { return undefined; }
			if (value !== undefined && value !== "") return publicEndpoint(value);
		}
		if (entry.defaultBaseURL !== undefined) return publicEndpoint(entry.defaultBaseURL);
		if (officialDeepSeekEntry(entry)) return "https://api.deepseek.com";
		// Compatibility for old catalogs that omitted their endpoint metadata.
		return legacy && entry.declared !== true ? LEGACY_ORIGINS.get(entry.provider) : undefined;
	};
	if (!legacy && completeNamespaces.size === 0 && !entries.some((entry) => endpointFor(entry) !== undefined)) {
		return { ...unavailable, entries };
	}
	const referenceFor = (entry) => {
		const value = fieldFor(entry, "apiKeyEnv");
		return typeof value === "string" && value !== "" ? value : undefined;
	};
	return { available, entries, profileFor, endpointFor, referenceFor };
}
