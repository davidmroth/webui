import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';

const projectRoot = fileURLToPath(new URL('../../../', import.meta.url));
const srcRoot = join(projectRoot, 'src');

async function collectServerSourceFiles(dir) {
	const entries = await readdir(dir, { withFileTypes: true });
	const files = [];

	for (const entry of entries) {
		const fullPath = join(dir, entry.name);

		if (entry.isDirectory()) {
			files.push(...(await collectServerSourceFiles(fullPath)));
			continue;
		}

		if (!entry.isFile()) {
			continue;
		}

		const relPath = relative(srcRoot, fullPath).replaceAll('\\', '/');
		if (relPath.includes('.test.')) {
			continue;
		}

		if (relPath.startsWith('lib/server/') || relPath.endsWith('/+server.ts') || relPath.endsWith('/+server.js')) {
			files.push(fullPath);
		}
	}

	return files;
}

function parseImportedSpecifiers(source) {
	const specifiers = [];
	const importPattern = /^\s*import(?!\s+type\b)(?:[^'"`]*?\sfrom\s*)?['"]([^'"]+)['"]/gm;

	for (const match of source.matchAll(importPattern)) {
		specifiers.push(match[1]);
	}

	return specifiers;
}

function isExternalPackage(specifier) {
	return !specifier.startsWith('.') && !specifier.startsWith('/') && !specifier.startsWith('$') && !specifier.startsWith('node:');
}

function getPackageName(specifier) {
	if (specifier.startsWith('@')) {
		const [scope, name] = specifier.split('/');
		return `${scope}/${name}`;
	}

	return specifier.split('/')[0];
}

function parseRuntimeDepsFromDockerfile(dockerfile) {
	const match = dockerfile.match(/const deps=\[(.*?)\];/s);
	assert.ok(match, 'Dockerfile should define a runtime dependency whitelist');

	return new Set(
		match[1]
			.split(',')
			.map((entry) => entry.trim().replace(/^'(.*)'$/, '$1'))
			.filter((entry) => entry.length > 0)
	);
}

test('Docker runtime dependency whitelist covers external server imports', async () => {
	const [dockerfile, packageJson, serverFiles] = await Promise.all([
		readFile(join(projectRoot, 'Dockerfile'), 'utf8'),
		readFile(join(projectRoot, 'package.json'), 'utf8'),
		collectServerSourceFiles(srcRoot)
	]);

	const pkg = JSON.parse(packageJson);
	const declaredPackages = new Set([
		...Object.keys(pkg.dependencies ?? {}),
		...Object.keys(pkg.devDependencies ?? {})
	]);
	const importedPackages = new Set();

	for (const filePath of serverFiles) {
		const source = await readFile(filePath, 'utf8');
		for (const specifier of parseImportedSpecifiers(source)) {
			if (!isExternalPackage(specifier)) {
				continue;
			}

			importedPackages.add(getPackageName(specifier));
		}
	}

	const undeclaredPackages = [...importedPackages]
		.filter((name) => !declaredPackages.has(name))
		.sort();
	assert.deepEqual(undeclaredPackages, []);

	const runtimeDeps = parseRuntimeDepsFromDockerfile(dockerfile);
	const missingRuntimeDeps = [...importedPackages]
		.filter((name) => !runtimeDeps.has(name))
		.sort();
	assert.deepEqual(missingRuntimeDeps, []);
});