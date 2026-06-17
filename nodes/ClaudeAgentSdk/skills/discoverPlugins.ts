/**
 * Plugin Discovery
 *
 * Discovers Claude Code plugins from:
 * 1. CLI-installed plugins registry (~/.claude/plugins/installed_plugins.json)
 * 2. Project-level plugin (<workingDir>/.claude-plugin/plugin.json)
 *
 * Used by the node's `methods.loadOptions` to populate a multi-select dropdown,
 * and at runtime to resolve plugin paths for the SDK `query()` options.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

interface DiscoveredPlugin {
	name: string;
	description: string;
	version: string;
	installPath: string;
	source: 'installed' | 'project';
}

interface InstalledPluginsRegistry {
	version: number;
	plugins: Record<string, Array<{
		scope: string;
		installPath: string;
		version: string;
		projectPath: string;
	}>>;
}

interface PluginDiscoveryOptions {
	installedPluginsRegistryPath?: string;
}

/**
 * Discover plugins from CLI registry and project-level .claude-plugin/ directory.
 *
 * Installed plugins are discovered first, then project-level plugin is appended
 * if it exists and doesn't duplicate an installed plugin by name.
 */
export async function discoverPlugins(
	workingDirectory?: string,
	options?: PluginDiscoveryOptions,
): Promise<DiscoveredPlugin[]> {
	const installedPlugins = await readInstalledPluginsRegistry(options);

	const projectPlugin = workingDirectory
		? await readProjectPlugin(workingDirectory)
		: null;

	if (!projectPlugin) return installedPlugins;

	// Deduplicate: installed plugins take precedence over project plugin
	const hasName = installedPlugins.some((p) => p.name === projectPlugin.name);
	if (hasName) return installedPlugins;

	return [...installedPlugins, projectPlugin];
}

/**
 * Parse the CLI installed_plugins.json registry and resolve plugin metadata.
 */
export async function readInstalledPluginsRegistry(
	options?: PluginDiscoveryOptions,
): Promise<DiscoveredPlugin[]> {
	const registryPath = options?.installedPluginsRegistryPath
		?? path.join(os.homedir(), '.claude', 'plugins', 'installed_plugins.json');

	let raw: string;
	try {
		raw = await fs.promises.readFile(registryPath, 'utf-8');
	} catch {
		return [];
	}

	let registry: InstalledPluginsRegistry;
	try {
		registry = JSON.parse(raw) as InstalledPluginsRegistry;
	} catch {
		return [];
	}

	if (!registry.plugins || typeof registry.plugins !== 'object') return [];

	const plugins: DiscoveredPlugin[] = [];

	for (const [key, entries] of Object.entries(registry.plugins)) {
		if (!Array.isArray(entries)) continue;

		for (const entry of entries) {
			if (!entry.installPath) continue;

			const manifest = await readPluginManifest(entry.installPath);
			const fallbackName = key.split('@')[0] || key;

			plugins.push({
				name: manifest.name || fallbackName,
				description: manifest.description || '',
				version: manifest.version || entry.version || '',
				installPath: entry.installPath,
				source: 'installed',
			});
		}
	}

	return plugins;
}

/**
 * Discover a project-level plugin from <workingDir>/.claude-plugin/plugin.json.
 */
async function readProjectPlugin(workingDirectory: string): Promise<DiscoveredPlugin | null> {
	const pluginJsonPath = path.join(workingDirectory, '.claude-plugin', 'plugin.json');

	const manifest = await readPluginManifest(workingDirectory);
	if (!manifest.name) {
		// Check if plugin.json actually exists before giving up
		try {
			await fs.promises.access(pluginJsonPath);
		} catch {
			return null;
		}
	}

	// Only return if we found some metadata
	if (!manifest.name && !manifest.description) return null;

	return {
		name: manifest.name || path.basename(workingDirectory),
		description: manifest.description || '',
		version: manifest.version || '',
		installPath: workingDirectory,
		source: 'project',
	};
}

/**
 * Read a plugin.json manifest from a plugin directory.
 *
 * Looks for `.claude-plugin/plugin.json` inside the given directory.
 */
export async function readPluginManifest(
	pluginDir: string,
): Promise<{ name?: string; description?: string; version?: string }> {
	const manifestPath = path.join(pluginDir, '.claude-plugin', 'plugin.json');

	let raw: string;
	try {
		raw = await fs.promises.readFile(manifestPath, 'utf-8');
	} catch {
		return {};
	}

	try {
		const parsed = JSON.parse(raw) as Record<string, unknown>;
		return {
			name: typeof parsed.name === 'string' ? parsed.name : undefined,
			description: typeof parsed.description === 'string' ? parsed.description : undefined,
			version: typeof parsed.version === 'string' ? parsed.version : undefined,
		};
	} catch {
		return {};
	}
}
