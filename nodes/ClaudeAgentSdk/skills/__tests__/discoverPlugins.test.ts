import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import {
	discoverPlugins,
	readInstalledPluginsRegistry,
	readPluginManifest,
} from '../discoverPlugins';

let tmpDir: string;

type InstalledPluginEntry = {
	scope: string;
	installPath: string;
	version: string;
	projectPath: string;
};

function missingInstalledPluginsRegistryPath(): string {
	return path.join(tmpDir, 'missing-installed_plugins.json');
}

async function writeInstalledPluginsRegistry(
	plugins: Record<string, InstalledPluginEntry[]>,
): Promise<string> {
	const registryPath = path.join(tmpDir, 'home', '.claude', 'plugins', 'installed_plugins.json');
	await fs.promises.mkdir(path.dirname(registryPath), { recursive: true });
	await fs.promises.writeFile(
		registryPath,
		JSON.stringify({
			version: 1,
			plugins,
		}),
	);
	return registryPath;
}

beforeEach(async () => {
	tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'plugin-discover-'));
});

afterEach(async () => {
	await fs.promises.rm(tmpDir, { recursive: true, force: true });
});

// ── readPluginManifest ──────────────────────────────────────────

describe('readPluginManifest', () => {
	it('reads a valid plugin.json', async () => {
		const pluginDir = path.join(tmpDir, 'my-plugin');
		const manifestDir = path.join(pluginDir, '.claude-plugin');
		await fs.promises.mkdir(manifestDir, { recursive: true });
		await fs.promises.writeFile(
			path.join(manifestDir, 'plugin.json'),
			JSON.stringify({
				name: 'hookify',
				version: '0.1.0',
				description: 'Easily create hooks to prevent unwanted behaviors',
			}),
		);

		const manifest = await readPluginManifest(pluginDir);

		expect(manifest).toEqual({
			name: 'hookify',
			version: '0.1.0',
			description: 'Easily create hooks to prevent unwanted behaviors',
		});
	});

	it('returns empty object for missing plugin.json', async () => {
		const manifest = await readPluginManifest(path.join(tmpDir, 'nonexistent'));
		expect(manifest).toEqual({});
	});

	it('returns empty object for corrupt plugin.json', async () => {
		const pluginDir = path.join(tmpDir, 'bad-plugin');
		const manifestDir = path.join(pluginDir, '.claude-plugin');
		await fs.promises.mkdir(manifestDir, { recursive: true });
		await fs.promises.writeFile(
			path.join(manifestDir, 'plugin.json'),
			'not valid json {{',
		);

		const manifest = await readPluginManifest(pluginDir);
		expect(manifest).toEqual({});
	});

	it('handles plugin.json with missing fields', async () => {
		const pluginDir = path.join(tmpDir, 'partial-plugin');
		const manifestDir = path.join(pluginDir, '.claude-plugin');
		await fs.promises.mkdir(manifestDir, { recursive: true });
		await fs.promises.writeFile(
			path.join(manifestDir, 'plugin.json'),
			JSON.stringify({ name: 'only-name' }),
		);

		const manifest = await readPluginManifest(pluginDir);
		expect(manifest).toEqual({
			name: 'only-name',
			description: undefined,
			version: undefined,
		});
	});

	it('ignores non-string fields in plugin.json', async () => {
		const pluginDir = path.join(tmpDir, 'type-mismatch');
		const manifestDir = path.join(pluginDir, '.claude-plugin');
		await fs.promises.mkdir(manifestDir, { recursive: true });
		await fs.promises.writeFile(
			path.join(manifestDir, 'plugin.json'),
			JSON.stringify({ name: 123, description: true, version: null }),
		);

		const manifest = await readPluginManifest(pluginDir);
		expect(manifest).toEqual({
			name: undefined,
			description: undefined,
			version: undefined,
		});
	});
});

// ── readInstalledPluginsRegistry ─────────────────────────────────

describe('readInstalledPluginsRegistry', () => {
	it('returns empty array when registry is missing', async () => {
		const result = await readInstalledPluginsRegistry({
			installedPluginsRegistryPath: missingInstalledPluginsRegistryPath(),
		});

		expect(result).toEqual([]);
	});

	it('reads installed plugins from a supplied registry path', async () => {
		const pluginDir = path.join(tmpDir, 'installed', 'hookify');
		const manifestDir = path.join(pluginDir, '.claude-plugin');
		await fs.promises.mkdir(manifestDir, { recursive: true });
		await fs.promises.writeFile(
			path.join(manifestDir, 'plugin.json'),
			JSON.stringify({
				name: 'hookify',
				version: '0.1.0',
				description: 'Installed plugin',
			}),
		);
		const registryPath = await writeInstalledPluginsRegistry({
			'hookify@user': [
				{
					scope: 'user',
					installPath: pluginDir,
					version: '0.1.0',
					projectPath: '',
				},
			],
		});

		const result = await readInstalledPluginsRegistry({
			installedPluginsRegistryPath: registryPath,
		});

		expect(result).toEqual([
			{
				name: 'hookify',
				description: 'Installed plugin',
				version: '0.1.0',
				installPath: pluginDir,
				source: 'installed',
			},
		]);
	});
});

// ── discoverPlugins (integration) ────────────────────────────────

describe('discoverPlugins', () => {
	it('discovers a project-level plugin', async () => {
		const projectDir = path.join(tmpDir, 'my-project');
		const manifestDir = path.join(projectDir, '.claude-plugin');
		await fs.promises.mkdir(manifestDir, { recursive: true });
		await fs.promises.writeFile(
			path.join(manifestDir, 'plugin.json'),
			JSON.stringify({
				name: 'my-project-plugin',
				version: '1.0.0',
				description: 'Project-level plugin',
			}),
		);

		const plugins = await discoverPlugins(projectDir, {
			installedPluginsRegistryPath: missingInstalledPluginsRegistryPath(),
		});

		expect(plugins).toEqual([
			expect.objectContaining({
				name: 'my-project-plugin',
				source: 'project',
				installPath: projectDir,
				description: 'Project-level plugin',
			}),
		]);
	});

	it('returns empty project plugin when no .claude-plugin directory', async () => {
		const projectDir = path.join(tmpDir, 'empty-project');
		await fs.promises.mkdir(projectDir, { recursive: true });

		const plugins = await discoverPlugins(projectDir, {
			installedPluginsRegistryPath: missingInstalledPluginsRegistryPath(),
		});

		expect(plugins).toEqual([]);
	});

	it('returns only installed plugins when no working directory', async () => {
		const pluginDir = path.join(tmpDir, 'installed-only');
		const manifestDir = path.join(pluginDir, '.claude-plugin');
		await fs.promises.mkdir(manifestDir, { recursive: true });
		await fs.promises.writeFile(
			path.join(manifestDir, 'plugin.json'),
			JSON.stringify({
				name: 'installed-only',
				version: '2.0.0',
				description: 'Installed only',
			}),
		);
		const registryPath = await writeInstalledPluginsRegistry({
			'installed-only@user': [
				{
					scope: 'user',
					installPath: pluginDir,
					version: '2.0.0',
					projectPath: '',
				},
			],
		});

		const plugins = await discoverPlugins(undefined, {
			installedPluginsRegistryPath: registryPath,
		});

		expect(plugins).toEqual([
			expect.objectContaining({
				name: 'installed-only',
				source: 'installed',
				installPath: pluginDir,
			}),
		]);
	});

	it('deduplicates installed vs project plugin by name', async () => {
		const installedPluginDir = path.join(tmpDir, 'installed-dupe');
		const installedManifestDir = path.join(installedPluginDir, '.claude-plugin');
		await fs.promises.mkdir(installedManifestDir, { recursive: true });
		await fs.promises.writeFile(
			path.join(installedManifestDir, 'plugin.json'),
			JSON.stringify({
				name: 'dupe-plugin',
				version: '1.0.0',
				description: 'Installed plugin wins',
			}),
		);
		const registryPath = await writeInstalledPluginsRegistry({
			'dupe-plugin@user': [
				{
					scope: 'user',
					installPath: installedPluginDir,
					version: '1.0.0',
					projectPath: '',
				},
			],
		});

		const projectDir = path.join(tmpDir, 'dedup-test');
		const manifestDir = path.join(projectDir, '.claude-plugin');
		await fs.promises.mkdir(manifestDir, { recursive: true });
		await fs.promises.writeFile(
			path.join(manifestDir, 'plugin.json'),
			JSON.stringify({
				name: 'dupe-plugin',
				version: '1.0.0',
				description: 'Project plugin loses',
			}),
		);

		const plugins = await discoverPlugins(projectDir, {
			installedPluginsRegistryPath: registryPath,
		});

		const matches = plugins.filter((p) => p.name === 'dupe-plugin');
		expect(matches).toHaveLength(1);
		expect(matches[0]).toEqual(
			expect.objectContaining({
				source: 'installed',
				installPath: installedPluginDir,
				description: 'Installed plugin wins',
			}),
		);
	});

	it('handles corrupt project plugin.json gracefully', async () => {
		const projectDir = path.join(tmpDir, 'corrupt-project');
		const manifestDir = path.join(projectDir, '.claude-plugin');
		await fs.promises.mkdir(manifestDir, { recursive: true });
		await fs.promises.writeFile(
			path.join(manifestDir, 'plugin.json'),
			'{{not json}}',
		);

		// Should not throw, just skip the project plugin
		const plugins = await discoverPlugins(projectDir, {
			installedPluginsRegistryPath: missingInstalledPluginsRegistryPath(),
		});

		expect(plugins).toEqual([]);
	});
});
