/** Packed single-package Blue payload and discovery contract. */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, delimiter, dirname, join, resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");

/** Run npm's JavaScript CLI with Node, never a platform-specific shell shim. */
function npmCliPath() {
	const candidates = [];
	if (process.env.npm_execpath) candidates.push(process.env.npm_execpath);
	// Direct `node --test` runs do not normally inherit npm_execpath. Cover
	// Node's Windows distribution, Unix global installs, and PATH symlinks.
	for (const directory of [dirname(process.execPath), ...(process.env.PATH ?? "").split(delimiter).filter(Boolean)]) {
		candidates.push(
			join(directory, "node_modules", "npm", "bin", "npm-cli.js"),
			join(directory, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
			join(directory, "npm")
		);
	}
	for (const candidate of candidates) {
		try {
			const cli = realpathSync(candidate);
			// npm_execpath can instead name pnpm/yarn; those are not npm's CLI.
			if (basename(cli) === "npm-cli.js" && existsSync(cli)) return cli;
		} catch {
			// Try the next installation layout or PATH entry.
		}
	}
	throw new Error("Cannot locate npm-cli.js; run this test through npm or set npm_execpath to npm's CLI.");
}

test("single package contains the Web plugin and canonical Blue manifest", () => {
	const destination = mkdtempSync(join(tmpdir(), "tokenledger-blue-pack-"));
	try {
		const output = execFileSync(process.execPath, [npmCliPath(), "pack", "--json", "--ignore-scripts", "--pack-destination", destination], { cwd: root, encoding: "utf8" });
		const packed = JSON.parse(output)[0];
		const files = new Set(packed.files.map((file) => file.path));
		for (const path of ["package.json", "blue.plugin.json", "cordis.patch.yml", "src/blue/index.js", "src/blue/model.js", "README.md"]) {
			assert.ok(files.has(path), path);
		}
		const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
		const manifest = JSON.parse(readFileSync(join(root, "blue.plugin.json"), "utf8"));
		const patch = readFileSync(join(root, "cordis.patch.yml"), "utf8");
		assert.equal(pkg.blue.manifest, "./blue.plugin.json");
		assert.equal(pkg.version, "0.1.0-pro.0");
		assert.equal(manifest.id, pkg.name);
		assert.equal(manifest.entry, ".");
		assert.equal(manifest.compatibility.blue, ">=0.1.2-alpha.1 <0.1.2");
		assert.equal(manifest.compatibility.harness, "0.1.2-alpha.2");
		assert.equal(pkg.peerDependencies["@deepseek-ai/cordis"], "^4.0.2");
		assert.equal(pkg.dependencies?.["@deepseek-ai/cordis"], undefined);
		assert.equal(pkg.peerDependencies["dsh-tokenledger"], undefined);
		assert.match(patch, /database:\s+!!js dshHomePath\('tokenledger-pro\.sqlite'\)/u);
		assert.match(patch, /sweepIntervalMs:\s+60000/u);
		assert.match(patch, /sweepOnStart:\s+true/u);
	} finally {
		rmSync(destination, { recursive: true, force: true });
	}
});

test("developer dogfood uses the exact published Blue CLI", () => {
	const readme = readFileSync(join(root, "README.md"), "utf8");
	assert.match(readme, /npm install --global pnpm@11 @dsh-blue\/blue-cli@0\.1\.2-alpha\.1/u);
	assert.match(readme, /blue plugin add "file:\$PWD"/u);
	assert.doesNotMatch(readme, /@dsh-blue\/blue-cli@alpha/u);
});
