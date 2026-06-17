/**
 * loadOptions helpers for the Managed Agent backend.
 *
 * Populate the Agent and Environment dropdowns in the n8n node UI by listing
 * resources from the user's Anthropic workspace. Creation happens out-of-band
 * at the Anthropic Console — the node only selects pre-existing IDs.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { ILoadOptionsFunctions, INodePropertyOptions } from 'n8n-workflow';

async function resolveApiKey(ctx: ILoadOptionsFunctions): Promise<string | undefined> {
	try {
		const creds = (await ctx.getCredentials('claudeApi')) as {
			authType?: 'apiKey' | 'cliExecutable';
			apiKey?: string;
		} | undefined;
		if (creds?.authType === 'cliExecutable') return undefined;
		return creds?.apiKey;
	} catch {
		return undefined;
	}
}

/**
 * Read the currently-stored parameter value without throwing if the field
 * isn't present yet (new node, never configured).
 */
function readCurrentParameter(ctx: ILoadOptionsFunctions, name: string): string {
	try {
		return ((ctx.getCurrentNodeParameter(name) as string) ?? '').trim();
	} catch {
		return '';
	}
}

/**
 * If the stored value is non-empty and not in the freshly-listed set, prepend
 * a highlighted "stale" entry so the UI shows the problem before execute time.
 * Pre-refactor inline-created resources are the canonical case.
 */
function prependStaleWarning(
	options: INodePropertyOptions[],
	storedValue: string,
	resourceKind: 'Agent' | 'Environment',
): INodePropertyOptions[] {
	if (!storedValue) return options;
	if (options.some((opt) => opt.value === storedValue)) return options;
	return [
		{
			name: `\u26A0 Stale ${resourceKind} (No Longer Exists) — Re-Pick Below`,
			value: storedValue,
			description: `${storedValue} — not in your current workspace. Select a valid ${resourceKind.toLowerCase()} from the list below.`,
		},
		...options,
	];
}

export async function listManagedAgentsLoadOption(
	ctx: ILoadOptionsFunctions,
): Promise<INodePropertyOptions[]> {
	const storedValue = readCurrentParameter(ctx, 'managedAgentId');
	const apiKey = await resolveApiKey(ctx);
	if (!apiKey) {
		return [{ name: 'Set a Claude API Credential to Load Agents', value: '' }];
	}
	const client = new Anthropic({ apiKey });
	const out: INodePropertyOptions[] = [];
	try {
		for await (const agent of client.beta.agents.list({ include_archived: false })) {
			// Belt-and-braces: server filter + client-side guard. Archived agents
			// cannot be used by new sessions, so exclude them regardless.
			if (agent.archived_at) continue;
			out.push({
				name: `${agent.name} (${agent.model.id})`,
				value: agent.id,
				description: agent.description ?? `v${agent.version} · ${agent.id}`,
			});
		}
	} catch (error) {
		return [
			{
				name: `Failed to Load Agents: ${error instanceof Error ? error.message : String(error)}`,
				value: '',
			},
		];
	}
	if (out.length === 0) {
		return [
			{
				name: 'No Active Agents Found — Create One in the Anthropic Console',
				value: '',
			},
		];
	}
	out.sort((a, b) => a.name.localeCompare(b.name));
	return prependStaleWarning(out, storedValue, 'Agent');
}

export async function listManagedEnvironmentsLoadOption(
	ctx: ILoadOptionsFunctions,
): Promise<INodePropertyOptions[]> {
	const storedValue = readCurrentParameter(ctx, 'managedEnvironmentId');
	const apiKey = await resolveApiKey(ctx);
	if (!apiKey) {
		return [{ name: 'Set a Claude API Credential to Load Environments', value: '' }];
	}
	const client = new Anthropic({ apiKey });
	const out: INodePropertyOptions[] = [];
	try {
		// environments.list() has no include_archived param, so archived envs
		// come back in the page. sessions.create rejects archived envs with a
		// 404, so filter them client-side.
		for await (const env of client.beta.environments.list()) {
			if (env.archived_at) continue;
			out.push({
				name: env.name,
				value: env.id,
				description: env.id,
			});
		}
	} catch (error) {
		return [
			{
				name: `Failed to Load Environments: ${error instanceof Error ? error.message : String(error)}`,
				value: '',
			},
		];
	}
	if (out.length === 0) {
		return [
			{
				name: 'No Active Environments Found — Create One in the Anthropic Console',
				value: '',
			},
		];
	}
	out.sort((a, b) => a.name.localeCompare(b.name));
	return prependStaleWarning(out, storedValue, 'Environment');
}
