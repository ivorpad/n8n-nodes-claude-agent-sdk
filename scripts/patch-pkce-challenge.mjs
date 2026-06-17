#!/usr/bin/env node

/**
 * n8n custom-node compatibility patch.
 *
 * pkce-challenge ships dist/index.node.js and dist/index.node.cjs. n8n's
 * CustomDirectoryLoader treats files ending in .node.js as n8n node classes,
 * so the package can be misdetected when @modelcontextprotocol/sdk is present.
 *
 * This script renames those files to index.main.* and updates the package
 * metadata references. It is idempotent, cross-platform, and intentionally
 * limited to the installed pkce-challenge package.
 */

import { access, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

const cwd = process.cwd();
const skipPatch = process.env.N8N_CLAUDE_AGENT_SDK_SKIP_PKCE_PATCH === '1';

if (skipPatch) {
	process.exit(0);
}

const candidatePackageJsonPaths = [
	path.join(cwd, 'node_modules', 'pkce-challenge', 'package.json'),
	path.join(cwd, 'node_modules', '@modelcontextprotocol', 'sdk', 'node_modules', 'pkce-challenge', 'package.json'),
	path.join(cwd, '..', 'pkce-challenge', 'package.json'),
	path.join(cwd, '..', '..', 'pkce-challenge', 'package.json'),
	path.join(cwd, '..', '..', '..', 'pkce-challenge', 'package.json'),
];

async function exists(filePath) {
	try {
		await access(filePath);
		return true;
	} catch {
		return false;
	}
}

async function findPkcePackageJson() {
	for (const packageJsonPath of candidatePackageJsonPaths) {
		if (await exists(packageJsonPath)) {
			return packageJsonPath;
		}
	}

	return undefined;
}

async function patchDistFiles(distDir) {
	let entries;
	try {
		entries = await readdir(distDir);
	} catch {
		return 0;
	}

	let renamed = 0;
	for (const entry of entries) {
		if (!entry.startsWith('index.node.')) {
			continue;
		}

		const sourcePath = path.join(distDir, entry);
		const targetName = entry.replace('index.node.', 'index.main.');
		const targetPath = path.join(distDir, targetName);

		if (await exists(targetPath)) {
			continue;
		}

		await rename(sourcePath, targetPath);
		renamed += 1;
	}

	return renamed;
}

async function patchPackageJson(packageJsonPath) {
	const original = await readFile(packageJsonPath, 'utf8');
	const patched = original.replaceAll('index.node', 'index.main');

	if (patched === original) {
		return false;
	}

	await writeFile(packageJsonPath, patched);
	return true;
}

const packageJsonPath = await findPkcePackageJson();

if (!packageJsonPath) {
	process.exit(0);
}

const distDir = path.join(path.dirname(packageJsonPath), 'dist');
const renamed = await patchDistFiles(distDir);
const updatedPackageJson = await patchPackageJson(packageJsonPath);

if (renamed > 0 || updatedPackageJson) {
	console.info('[n8n-nodes-claude-agent-sdk] Applied pkce-challenge n8n loader compatibility patch.');
}
