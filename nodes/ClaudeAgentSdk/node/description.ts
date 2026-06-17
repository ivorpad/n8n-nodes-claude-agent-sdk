import type { INodeCredentialDescription, INodeTypeDescription } from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';

import { nodeProperties } from '../nodeProperties';
import { localCliOnly, operationOnly } from '../nodeProperties/backendModeHelper';
import { permissionsProperties } from '../permissions/properties';
import { streamingConfigProperties } from '../streaming/properties';
import { sandboxProperties } from '../sandbox/properties';

/**
 * Every value the authentication parameter may hold at runtime: the current
 * dropdown values plus values persisted by earlier parameter shapes.
 */
const KNOWN_AUTHENTICATION_VALUES = [
	'claudeApi',
	'claudeAgentSdkOpenRouterApi',
	'alibabaCodingPlanApi',
	'none',
	'apiCredentials',
	'cliSession',
	'openrouter',
	'alibaba',
	'ollama',
	'predefinedCredentialType',
];

/** Values the removed nodeCredentialType selector persisted in legacy saves. */
const KNOWN_NODE_CREDENTIAL_TYPES = [
	'claudeApi',
	'anthropicApi',
	'openRouterApi',
	'claudeAgentSdkOpenRouterApi',
	'alibabaCodingPlanApi',
];

function providerCredential(
	name: string,
	gate: {
		authentication: string[];
		/** Legacy selector values (the removed nodeCredentialType parameter) that resolve to this credential type. */
		nodeCredentialType: string[];
	},
): INodeCredentialDescription {
	// The runtime credential display check reads raw saved parameters
	// (defaults are NOT materialized), so an unsaved parameter must count as
	// a match for the default provider and for legacy workflows. n8n-workflow
	// >= 2.14 no longer coerces unset values to the string 'undefined' for
	// `_cnd` regex conditions, so "unset matches" cannot be expressed with
	// `show` rules. `hide` rules however are skipped entirely while the
	// parameter is unset (identical in n8n-workflow 1.x and 2.x), so each
	// credential hides on the COMPLEMENT of its accepted values:
	// unset -> visible, accepted value -> visible, other value -> hidden.
	// Multiple credentials "visible" on fully-unsaved workflows is harmless —
	// core checks only the one credential type being requested; pickers are
	// an NDV-only concern.
	return {
		name,
		required: false,
		displayOptions: {
			hide: {
				'/authentication': KNOWN_AUTHENTICATION_VALUES.filter(
					(value) => !gate.authentication.includes(value),
				),
				'/nodeCredentialType': KNOWN_NODE_CREDENTIAL_TYPES.filter(
					(value) => !gate.nodeCredentialType.includes(value),
				),
			},
		},
	};
}

export const claudeAgentSdkDescription: INodeTypeDescription = {
	displayName: 'Claude Agent SDK',
	name: 'claudeAgentSdk',
	icon: 'file:claude-color.svg',
	group: ['transform'],
	version: 1,
	subtitle: '={{ $parameter.operation === "generatePythonSdk" ? "Generate Python SDK Script" : "Execute Agent Task" }}',
	description: 'Execute autonomous AI coding tasks using Claude Agent SDK',
	defaults: {
		name: 'Claude Agent SDK',
	},
	inputs: [
		{ displayName: '', type: NodeConnectionTypes.Main },
		{
			displayName: 'Tool',
			type: NodeConnectionTypes.AiTool,
			required: false,
			filter: {
				nodes: [
					'CUSTOM.claudeSkillTool',
				],
			},
		},
		{
			displayName: 'Memory',
			maxConnections: 1,
			type: NodeConnectionTypes.AiMemory,
			required: false,
			filter: {
				nodes: [
					'CUSTOM.simpleSessionMemory',
					'CUSTOM.redisSessionMemory',
					'CUSTOM.postgresSessionMemory',
				],
			},
		},
	],
	outputs: `={{ (() => {
		const outputs = [{ displayName: 'Result', type: 'main' }];
		if ($parameter.operation === 'generatePythonSdk') {
			return outputs;
		}
		if ($parameter.securityOptions?.auditLogging?.settings?.enabled === true) {
			outputs.push({ displayName: 'Audit Log', type: 'main' });
		}
		return outputs;
	})() }}`,
	webhooks: [
		{
			name: 'default',
			httpMethod: 'GET',
			responseMode: 'onReceived',
			path: '={{ $nodeId }}',
			restartWebhook: true,
			isFullPath: true,
		},
		{
			name: 'default',
			httpMethod: 'POST',
			responseMode: 'onReceived',
			path: '={{ $nodeId }}',
			restartWebhook: true,
			isFullPath: true,
		},
	],
	credentials: [
		// Provider credentials MUST be declared here: n8n core getCredentials()
		// rejects any type missing from this list, and its fullAccess bypass is
		// hardcoded to the built-in HTTP Request node types only. These entries
		// also render the NDV picker for whichever provider the authentication
		// dropdown selects. Absolute '/' paths keep these rules out of NDV
		// main-auth-field discovery (same trick as mcpHeaderAuthApi below).
		// Complement-hide rules accept parameters n8n never persisted (see
		// providerCredential above). Two legacy shapes stay loadable:
		// authentication-only values ('apiCredentials'/'cliSession'/
		// 'openrouter'/'alibaba') and the removed 'predefinedCredentialType'
		// + nodeCredentialType selector.
		providerCredential('claudeApi', {
			authentication: ['claudeApi', 'apiCredentials', 'cliSession', 'predefinedCredentialType'],
			nodeCredentialType: ['claudeApi'],
		}),
		providerCredential('anthropicApi', {
			authentication: ['predefinedCredentialType'],
			nodeCredentialType: ['anthropicApi'],
		}),
		providerCredential('openRouterApi', {
			authentication: ['openrouter', 'predefinedCredentialType'],
			nodeCredentialType: ['openRouterApi'],
		}),
		providerCredential('claudeAgentSdkOpenRouterApi', {
			authentication: ['claudeAgentSdkOpenRouterApi', 'predefinedCredentialType'],
			nodeCredentialType: ['claudeAgentSdkOpenRouterApi'],
		}),
		providerCredential('alibabaCodingPlanApi', {
			authentication: ['alibabaCodingPlanApi', 'alibaba', 'predefinedCredentialType'],
			nodeCredentialType: ['alibabaCodingPlanApi'],
		}),
		{
			name: 'secureEnvVarsApi',
			required: false,
			displayOptions: {
				show: {
					'/additionalOptions.useSecureEnv': [true],
				},
			},
		},
		{
			name: 'mcpHeaderAuthApi',
			required: false,
			// n8n credential display rules cannot reliably express
			// "any item in a multi-value fixedCollection uses credential auth".
			// Show the credential whenever MCP servers are enabled instead.
			// Use an absolute parameter path so n8n does not classify
			// enableMcpServers as an auth field and hide backendMode.
			displayOptions: {
				show: {
					'/enableMcpServers': [true],
				},
			},
		},
		{
			// eslint-disable-next-line n8n-nodes-base/node-class-description-credentials-name-unsuffixed
			name: 'postgres',
			required: false,
			displayOptions: {
				show: {
					'/executionSettings.observabilityPersistenceBackend': ['auto', 'postgres'],
				},
			},
		},
		{
			name: 'httpBasicAuth',
			required: false,
			displayOptions: {
				show: {
					'/hitlWebhookAuthentication': ['basicAuth'],
				},
			},
		},
		{
			name: 'httpHeaderAuth',
			required: false,
			displayOptions: {
				show: {
					'/hitlWebhookAuthentication': ['headerAuth'],
				},
			},
		},
		{
			name: 'jwtAuth',
			required: false,
			displayOptions: {
				show: {
					'/hitlWebhookAuthentication': ['jwtAuth'],
				},
			},
		},
	],
	requestDefaults: {
		baseURL: '={{$credentials.baseUrl || $credentials.url}}',
		headers: {
			Authorization: '=Bearer {{$credentials.apiKey}}',
		},
	},
	properties: [
		// Node properties from modular definitions
		...nodeProperties,

		// Streaming configuration (content types, markers, display options)
		...operationOnly(streamingConfigProperties, ['executeTask']),

		// Sandbox configuration (command sandboxing, network restrictions) —
		// local CLI only; Anthropic manages the container for managed agents
		...localCliOnly(sandboxProperties),

		// Permissions module properties (Path Sandboxing, Content Filtering,
		// Tool Permissions, Audit Logging) — local CLI only; managed agents
		// use toolset-level permission policies instead
		...localCliOnly(permissionsProperties),
	],
};
