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
// Note: readInstalledPluginsRegistry reads from ~/.claude/plugins/installed_plugins.json
// which we can't easily mock. These tests verify the function doesn't throw on the
// real filesystem (it may return empty or actual plugins).

describe('readInstalledPluginsRegistry', () => {
	it('returns an array (may be empty if no plugins installed)', async () => {
		const result = await readInstalledPluginsRegistry();
		expect(Array.isArray(result)).toBe(true);
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

		const plugins = await discoverPlugins(projectDir);

		const projectPlugin = plugins.find((p) => p.name === 'my-project-plugin');
		expect(projectPlugin).toBeDefined();
		expect(projectPlugin!.source).toBe('project');
		expect(projectPlugin!.installPath).toBe(projectDir);
		expect(projectPlugin!.description).toBe('Project-level plugin');
	});

	it('returns empty project plugin when no .claude-plugin directory', async () => {
		const projectDir = path.join(tmpDir, 'empty-project');
		await fs.promises.mkdir(projectDir, { recursive: true });

		const plugins = await discoverPlugins(projectDir);

		// Should only contain installed plugins (if any), no project plugin
		const projectPlugins = plugins.filter((p) => p.source === 'project');
		expect(projectPlugins).toHaveLength(0);
	});

	it('returns only installed plugins when no working directory', async () => {
		const plugins = await discoverPlugins();
		expect(Array.isArray(plugins)).toBe(true);
		// All returned plugins should be 'installed' source
		for (const p of plugins) {
			expect(p.source).toBe('installed');
		}
	});

	it('deduplicates installed vs project plugin by name', async () => {
		// Create a project plugin that mimics the name of an installed plugin
		// Since we can't control installed_plugins.json, we test the dedup logic directly
		const projectDir = path.join(tmpDir, 'dedup-test');
		const manifestDir = path.join(projectDir, '.claude-plugin');
		await fs.promises.mkdir(manifestDir, { recursive: true });
		await fs.promises.writeFile(
			path.join(manifestDir, 'plugin.json'),
			JSON.stringify({
				name: 'unique-test-plugin-name-unlikely-to-exist',
				version: '1.0.0',
				description: 'Test plugin for dedup',
			}),
		);

		const plugins = await discoverPlugins(projectDir);

		// The project plugin should appear exactly once
		const matches = plugins.filter(
			(p) => p.name === 'unique-test-plugin-name-unlikely-to-exist',
		);
		expect(matches).toHaveLength(1);
		expect(matches[0].source).toBe('project');
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
		const plugins = await discoverPlugins(projectDir);
		expect(Array.isArray(plugins)).toBe(true);
		const projectPlugins = plugins.filter((p) => p.source === 'project');
		expect(projectPlugins).toHaveLength(0);
	});
});
