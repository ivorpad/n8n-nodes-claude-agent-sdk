import { describe, expect, it } from 'vitest';
import {
	NodeHelpers,
	type INodeCredentialDescription,
	type INodeParameters,
	type INodeProperties,
} from 'n8n-workflow';

import { claudeAgentSdkDescription } from '../../node/description';

const PROVIDER_CREDENTIAL_TYPES = [
	'claudeApi',
	'anthropicApi',
	'openRouterApi',
	'claudeAgentSdkOpenRouterApi',
	'alibabaCodingPlanApi',
] as const;
function getCredential(name: string): INodeCredentialDescription {
	const credential = claudeAgentSdkDescription.credentials?.find((entry) => entry.name === name);
	if (!credential) {
		throw new Error(`Missing credential definition: ${name}`);
	}
	return credential;
}

function getNodeProperty(name: string): INodeProperties {
	const property = claudeAgentSdkDescription.properties.find((entry) => entry.name === name);
	if (!property) {
		throw new Error(`Missing node property: ${name}`);
	}
	return property;
}

function isCredentialVisible(name: string, parameters: INodeParameters): boolean {
	return NodeHelpers.displayParameterPath(
		parameters,
		getCredential(name),
		'',
		{ typeVersion: 1 },
		claudeAgentSdkDescription,
	);
}

function getCredentialDisplayDependencies(): Set<string> {
	const dependencies = new Set<string>();
	for (const credential of claudeAgentSdkDescription.credentials ?? []) {
		for (const fieldName of Object.keys(credential.displayOptions?.show ?? {})) {
			dependencies.add(fieldName);
		}
	}
	return dependencies;
}

function getRelativeCredentialDisplayDependencies(): Set<string> {
	return new Set(
		Array.from(getCredentialDisplayDependencies()).filter((fieldName) => !fieldName.startsWith('/')),
	);
}

describe('authentication credential visibility', () => {
	it('declares every provider credential type the runtime can request', () => {
		// n8n core getCredentials() rejects any type not listed in
		// description.credentials ("Node type ... does not have any credentials
		// of type X defined") — the fullAccess bypass is hardcoded to the
		// built-in HTTP Request node types, so the credentialsSelect override
		// alone is NOT enough for a community node. Regression guard for the
		// selector refactor that removed these entries and broke execution.
		for (const providerCredentialType of PROVIDER_CREDENTIAL_TYPES) {
			expect(getCredential(providerCredentialType)).toBeDefined();
		}
		expect((claudeAgentSdkDescription.credentials ?? []).map((entry) => entry.name)).toEqual(
			expect.arrayContaining([
				'secureEnvVarsApi',
				'mcpHeaderAuthApi',
				'postgres',
				'httpBasicAuth',
				'httpHeaderAuth',
				'jwtAuth',
			]),
		);
	});

	it('passes the runtime credential check for fresh workflows with unsaved defaults', () => {
		// A workflow saved without touching authentication/nodeCredentialType
		// persists NEITHER parameter (n8n omits defaults), so the runtime
		// display check sees undefined for both. claudeApi (the default
		// provider) must still resolve.
		expect(isCredentialVisible('claudeApi', {})).toBe(true);
	});

	it('passes the runtime credential check for legacy authentication values', () => {
		// Pre-selector workflows persisted these authentication values and have
		// no nodeCredentialType parameter at all.
		expect(isCredentialVisible('claudeApi', { authentication: 'apiCredentials' })).toBe(true);
		expect(isCredentialVisible('claudeApi', { authentication: 'cliSession' })).toBe(true);
		expect(isCredentialVisible('openRouterApi', { authentication: 'openrouter' })).toBe(true);
		expect(isCredentialVisible('alibabaCodingPlanApi', { authentication: 'alibaba' })).toBe(true);
	});

	it('resolves the selected provider credential and hides the others', () => {
		const selected = {
			authentication: 'predefinedCredentialType',
			nodeCredentialType: 'alibabaCodingPlanApi',
		};
		expect(isCredentialVisible('alibabaCodingPlanApi', selected)).toBe(true);
		expect(isCredentialVisible('claudeApi', selected)).toBe(false);
		expect(isCredentialVisible('claudeAgentSdkOpenRouterApi', selected)).toBe(false);

		expect(
			isCredentialVisible('claudeAgentSdkOpenRouterApi', {
				nodeCredentialType: 'claudeAgentSdkOpenRouterApi',
			}),
		).toBe(true);
		expect(isCredentialVisible('anthropicApi', { nodeCredentialType: 'anthropicApi' })).toBe(true);
	});

	it('hides all provider credentials in Ollama mode', () => {
		for (const providerCredentialType of PROVIDER_CREDENTIAL_TYPES) {
			expect(isCredentialVisible(providerCredentialType, { authentication: 'none' })).toBe(false);
		}
	});

	it('has no separate credential-type parameter (single authentication dropdown)', () => {
		// The provider choice IS the credential-type choice. A separate
		// nodeCredentialType parameter (HTTP Request's credentialsSelect
		// pattern) renders a duplicate picker for community nodes — only the
		// built-in HTTP Request node holds core's fullAccess bypass.
		expect(
			claudeAgentSdkDescription.properties.some((entry) => entry.name === 'nodeCredentialType'),
		).toBe(false);
		expect(getNodeProperty('authentication').type).toBe('options');
	});

	it('shows exactly one provider credential picker per authentication choice', () => {
		for (const selectable of [
			'claudeApi',
			'claudeAgentSdkOpenRouterApi',
			'alibabaCodingPlanApi',
		]) {
			const visible = PROVIDER_CREDENTIAL_TYPES.filter((name) =>
				isCredentialVisible(name, { authentication: selectable }),
			);
			expect(visible).toEqual([selectable]);
		}
	});

	it('shows exactly one provider credential picker for legacy selector-based saves', () => {
		// Workflows saved while the credentialsSelect/options selector shipped
		// persist authentication='predefinedCredentialType' plus a
		// nodeCredentialType value. The parameter is gone from the description,
		// but saved values must keep resolving to a single picker.
		for (const legacySelected of PROVIDER_CREDENTIAL_TYPES) {
			const parameters = {
				authentication: 'predefinedCredentialType',
				nodeCredentialType: legacySelected,
			};
			const visible = PROVIDER_CREDENTIAL_TYPES.filter((name) =>
				isCredentialVisible(name, parameters),
			);
			expect(visible).toEqual([legacySelected]);
		}
	});

	it('keeps local Ollama out of the n8n credential selector', () => {
		expect(claudeAgentSdkDescription.credentials?.some((entry) => entry.name === 'ollamaApi')).toBe(false);
	});

	it('keeps top-level credential display rules out of n8n main auth field discovery', () => {
		expect(getRelativeCredentialDisplayDependencies()).toEqual(new Set());
		expect(getCredentialDisplayDependencies()).not.toContain('authentication');
		expect(getCredentialDisplayDependencies()).not.toContain('nodeCredentialType');
		expect(getCredentialDisplayDependencies()).not.toContain('hitlWebhookAuthentication');
		expect(getCredential('httpBasicAuth').displayOptions?.show).toHaveProperty('/hitlWebhookAuthentication');
		expect(getCredential('httpHeaderAuth').displayOptions?.show).toHaveProperty('/hitlWebhookAuthentication');
		expect(getCredential('jwtAuth').displayOptions?.show).toHaveProperty('/hitlWebhookAuthentication');
	});

	it('shows secure env vars credential only when secure env injection is enabled', () => {
		expect(isCredentialVisible('secureEnvVarsApi', {})).toBe(false);
		expect(isCredentialVisible('secureEnvVarsApi', { additionalOptions: { useSecureEnv: false } })).toBe(false);
		expect(isCredentialVisible('secureEnvVarsApi', { additionalOptions: { useSecureEnv: true } })).toBe(true);
	});

	it('shows MCP header auth credential when MCP servers are enabled', () => {
		expect(isCredentialVisible('mcpHeaderAuthApi', {})).toBe(false);
		expect(
			isCredentialVisible('mcpHeaderAuthApi', {
				enableMcpServers: false,
				mcpServers: {
					servers: [
						{
							name: 'credential-server',
							type: 'http',
							url: 'https://api.example.com',
							authentication: 'credential',
						},
					],
				},
			}),
		).toBe(false);
		expect(
			isCredentialVisible('mcpHeaderAuthApi', {
				enableMcpServers: true,
				mcpServers: {
					servers: [
						{
							name: 'credential-server',
							type: 'http',
							url: 'https://api.example.com',
							authentication: 'credential',
						},
					],
				},
			}),
		).toBe(true);
	});

	it('does not make the backend selector auth-related via MCP credential visibility', () => {
		const mcpHeaderAuth = getCredential('mcpHeaderAuthApi');

		expect(mcpHeaderAuth.displayOptions?.show).toHaveProperty('/enableMcpServers');
		expect(getCredentialDisplayDependencies()).not.toContain('enableMcpServers');
		expect(getCredentialDisplayDependencies()).not.toContain('backendMode');
	});

	it('shows HITL webhook auth credentials from absolute parameter paths', () => {
		expect(isCredentialVisible('httpBasicAuth', { hitlWebhookAuthentication: 'none' })).toBe(false);
		expect(isCredentialVisible('httpBasicAuth', { hitlWebhookAuthentication: 'basicAuth' })).toBe(true);
		expect(isCredentialVisible('httpHeaderAuth', { hitlWebhookAuthentication: 'headerAuth' })).toBe(true);
		expect(isCredentialVisible('jwtAuth', { hitlWebhookAuthentication: 'jwtAuth' })).toBe(true);
	});

	it('shows postgres credential when observability persistence can target postgres', () => {
		expect(isCredentialVisible('postgres', {})).toBe(false);
		expect(
			isCredentialVisible('postgres', {
				executionSettings: { observabilityPersistenceBackend: 'runDataOnly' },
			}),
		).toBe(false);
		expect(
			isCredentialVisible('postgres', {
				executionSettings: { observabilityPersistenceBackend: 'auto' },
			}),
		).toBe(true);
		expect(
			isCredentialVisible('postgres', {
				executionSettings: { observabilityPersistenceBackend: 'postgres' },
			}),
		).toBe(true);
	});
});
