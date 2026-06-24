import type { ILoadOptionsFunctions } from 'n8n-workflow';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { normalizeCompanionAgentId } from '../../companion/agentId';
import {
	listCompanionAgentsLoadOption,
	listCompanionAgentsSearch,
} from '../../companion/loadOptions';

function makeContext(args: {
	apiKey?: string;
	currentAgentId?: unknown;
} = {}): ILoadOptionsFunctions {
	return {
		getCredentials: vi.fn(async () => {
			if (!args.apiKey) throw new Error('missing credentials');
			return { apiKey: args.apiKey };
		}),
		getCurrentNodeParameter: vi.fn((name: string) => {
			if (name === 'companionAgent.companionAgentId') return args.currentAgentId;
			return undefined;
		}),
		getCurrentNodeParameters: vi.fn(() => ({
			companionAgent: {
				companionAgentId: args.currentAgentId,
			},
		})),
	} as unknown as ILoadOptionsFunctions;
}

describe('listCompanionAgentsLoadOption', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('loads Agent Plane agents by name using the saved API key', async () => {
		const fetchMock = vi.fn(async () => new Response(JSON.stringify({
			agents: [
				{
					agentId: 'agt_billing',
					name: 'Billing',
					description: 'Billing support',
					directoryStatus: 'created',
					syncStatus: 'synced',
					workingDirectory: '/workspace/billing',
					localWorkingDirectory: '/local/billing',
				},
				{
					agentId: 'agt_alpha',
					name: 'Alpha',
					directoryStatus: 'pending',
					syncStatus: 'unknown',
				},
			],
		})));
		vi.stubGlobal('fetch', fetchMock);

		const options = await listCompanionAgentsLoadOption(makeContext({ apiKey: 'ap_test' }));

		expect(fetchMock).toHaveBeenCalledWith(
			'http://host.docker.internal:4000/api/n8n/agents',
			expect.objectContaining({
				method: 'GET',
				headers: expect.objectContaining({
					Authorization: 'Bearer ap_test',
				}),
			}),
		);
		expect(options).toEqual([
			expect.objectContaining({ name: 'Alpha (agt_alpha)', value: 'agt_alpha' }),
			expect.objectContaining({
				name: 'Billing (agt_billing)',
				value: 'agt_billing',
				description: expect.stringContaining('/local/billing'),
			}),
		]);
	});

	it('returns a setup option when the Agent Plane credential is missing', async () => {
		await expect(listCompanionAgentsLoadOption(makeContext())).resolves.toEqual([
			{
				name: 'Set an Agent Plane Credential to Load Agents',
				value: '__agent_plane_missing_credential__',
			},
		]);
	});

	it('preserves a stale selected agent ID so existing workflows can re-pick', async () => {
		const fetchMock = vi.fn(async () => new Response(JSON.stringify({
			agents: [{ agentId: 'agt_visible', name: 'Visible Agent' }],
		})));
		vi.stubGlobal('fetch', fetchMock);

		const options = await listCompanionAgentsLoadOption(
			makeContext({ apiKey: 'ap_test', currentAgentId: 'agt_missing' }),
		);

		expect(options[0]).toMatchObject({
			name: 'Stale Agent Plane Agent (agt_missing) - Re-Pick Below',
			value: 'agt_missing',
		});
		expect(options[1]).toMatchObject({ name: 'Visible Agent (agt_visible)', value: 'agt_visible' });
	});

	it('preserves a stale selected agent ID from a resource locator value', async () => {
		const fetchMock = vi.fn(async () => new Response(JSON.stringify({
			agents: [{ agentId: 'agt_visible', name: 'Visible Agent' }],
		})));
		vi.stubGlobal('fetch', fetchMock);

		const options = await listCompanionAgentsLoadOption(
			makeContext({
				apiKey: 'ap_test',
				currentAgentId: { __rl: true, mode: 'list', value: 'agt_missing' },
			}),
		);

		expect(options[0]).toMatchObject({
			name: 'Stale Agent Plane Agent (agt_missing) - Re-Pick Below',
			value: 'agt_missing',
		});
	});

	it('preserves a stale selected agent ID from collection-local parameters', async () => {
		const fetchMock = vi.fn(async () => new Response(JSON.stringify({
			agents: [{ agentId: 'agt_visible', name: 'Visible Agent' }],
		})));
		vi.stubGlobal('fetch', fetchMock);

		const options = await listCompanionAgentsLoadOption({
			...makeContext({ apiKey: 'ap_test' }),
			getCurrentNodeParameter: vi.fn((name: string) => {
				if (name === 'companionAgentId') return 'agt_local';
				return undefined;
			}),
			getNodeParameter: vi.fn(() => ({})),
			getCurrentNodeParameters: vi.fn(() => undefined),
		} as unknown as ILoadOptionsFunctions);

		expect(options[0]).toMatchObject({
			name: 'Stale Agent Plane Agent (agt_local) - Re-Pick Below',
			value: 'agt_local',
		});
	});
});

describe('listCompanionAgentsSearch', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('returns resource locator results and filters by name or ID', async () => {
		const fetchMock = vi.fn(async () => new Response(JSON.stringify({
			agents: [
				{ agentId: 'agt_billing', name: 'Billing', localWorkingDirectory: '/local/billing' },
				{ agentId: 'agt_support', name: 'Support', localWorkingDirectory: '/local/support' },
			],
		})));
		vi.stubGlobal('fetch', fetchMock);

		const result = await listCompanionAgentsSearch(makeContext({ apiKey: 'ap_test' }), 'bill');

		expect(result.results).toEqual([
			expect.objectContaining({
				name: 'Billing (agt_billing)',
				value: 'agt_billing',
				description: expect.stringContaining('/local/billing'),
			}),
		]);
	});
});

describe('normalizeCompanionAgentId', () => {
	it('accepts old string values and new resource locator values', () => {
		expect(normalizeCompanionAgentId(' agt_support ')).toBe('agt_support');
		expect(normalizeCompanionAgentId({ __rl: true, mode: 'list', value: 'agt_support' })).toBe(
			'agt_support',
		);
	});

	it('rejects non-selectable placeholder option values', () => {
		expect(normalizeCompanionAgentId('__agent_plane_missing_credential__')).toBe('');
	});
});
