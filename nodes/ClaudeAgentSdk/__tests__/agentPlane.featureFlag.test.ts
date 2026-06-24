import { afterEach, describe, expect, it, vi } from 'vitest';

describe('Agent Plane feature flag', () => {
	const originalFlag = process.env.AGENT_PLANE_ENABLED;

	afterEach(() => {
		if (originalFlag === undefined) {
			delete process.env.AGENT_PLANE_ENABLED;
		} else {
			process.env.AGENT_PLANE_ENABLED = originalFlag;
		}
		vi.resetModules();
	});

	it('requires AGENT_PLANE_ENABLED to be exactly 1', async () => {
		process.env.AGENT_PLANE_ENABLED = 'true';
		vi.resetModules();

		const { isAgentPlaneEnabled } = await import('../featureFlags');

		expect(isAgentPlaneEnabled()).toBe(false);

		process.env.AGENT_PLANE_ENABLED = '1';

		expect(isAgentPlaneEnabled()).toBe(true);
	});

	it('omits Agent Plane node property and credential when feature flag is disabled', async () => {
		delete process.env.AGENT_PLANE_ENABLED;
		vi.resetModules();

		const [{ nodeProperties }, { claudeAgentSdkDescription }] = await Promise.all([
			import('../nodeProperties'),
			import('../node/description'),
		]);

		expect(nodeProperties.map((property) => property.name)).not.toContain('companionAgent');
		expect((claudeAgentSdkDescription.credentials ?? []).map((credential) => credential.name))
			.not.toContain('claudeAgentCompanionApi');
	});

	it('shows Agent Plane node property and credential when feature flag is enabled', async () => {
		process.env.AGENT_PLANE_ENABLED = '1';
		vi.resetModules();

		const [{ NodeHelpers }, { nodeProperties }, { claudeAgentSdkDescription }] = await Promise.all([
			import('n8n-workflow'),
			import('../nodeProperties'),
			import('../node/description'),
		]);
		const companionCredential = claudeAgentSdkDescription.credentials?.find(
			(credential) => credential.name === 'claudeAgentCompanionApi',
		);

		expect(nodeProperties.map((property) => property.name)).toContain('companionAgent');
		expect((claudeAgentSdkDescription.credentials ?? []).map((credential) => credential.name))
			.toContain('claudeAgentCompanionApi');
		expect(companionCredential).toBeDefined();
		expect(
			NodeHelpers.displayParameterPath(
				{ operation: 'executeTask', backendMode: 'localCli' },
				companionCredential!,
				'',
				{ typeVersion: 1 },
				claudeAgentSdkDescription,
			),
		).toBe(true);
		expect(
			NodeHelpers.displayParameterPath(
				{ operation: 'executeTask', backendMode: 'managedAgent' },
				companionCredential!,
				'',
				{ typeVersion: 1 },
				claudeAgentSdkDescription,
			),
		).toBe(false);
	});
});
