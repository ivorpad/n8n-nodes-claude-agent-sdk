import { configWithoutCloudSupport as config } from '@n8n/node-cli/eslint';

export default [
	...config,
	{
		ignores: [
			'nodes/**/__tests__/**',
			'vitest.config.ts',
			'.claude/**',
			'.codex/**',
			'credentials/SecureEnvVarsApi.credentials.ts',
			'credentials/WhatsAppBusinessCloudApi.credentials.ts',
			'credentials/WoztellBotApi.credentials.ts',
			'nodes/ClaudeAgentDiscord/**',
			'nodes/ClaudeAgentEmail/**',
			'nodes/ClaudeAgentGmail/**',
			'nodes/ClaudeAgentSlack/**',
			'nodes/ClaudeAgentTelegram/**',
			'nodes/ClaudeAgentWhatsApp/**',
			'nodes/ClaudeAgentWoztell/**',
			'nodes/ClaudeSkillTool/**',
			'nodes/WoztellSend/**',
		],
	},
	{
		files: ['nodes/ClaudeAgentSdk/**/*.ts'],
		rules: {
			'no-console': 'off',
		},
	},
	{
		files: [
			'nodes/ClaudeAgentSdk/nodeProperties/alibabaCodingPlanModels.ts',
			'nodes/ClaudeAgentSdk/nodeProperties/n8nMcp.ts',
			'nodes/ClaudeAgentSdk/nodeProperties/operation.ts',
			'nodes/ClaudeAgentSdk/nodeProperties/plugins.ts',
		],
		rules: {
			'n8n-nodes-base/node-param-collection-type-unsorted-items': 'off',
			'n8n-nodes-base/node-param-description-boolean-without-whether': 'off',
			'n8n-nodes-base/node-param-description-miscased-json': 'off',
			'n8n-nodes-base/node-param-description-wrong-for-dynamic-multi-options': 'off',
			'n8n-nodes-base/node-param-display-name-miscased': 'off',
			'n8n-nodes-base/node-param-display-name-wrong-for-dynamic-multi-options': 'off',
			'n8n-nodes-base/node-param-operation-option-without-action': 'off',
		},
	},
	{
		files: [
			'nodes/ClaudeAgentSdk/types.ts',
			'nodes/ClaudeAgentSdk/permissions/types.ts',
			'nodes/ClaudeAgentSdk/operations/executeTask/config.ts',
			'nodes/ClaudeAgentSdk/permissions/ContentFilter.ts',
			'nodes/ClaudeAgentSdk/permissions/PathSandbox.ts',
			'nodes/ClaudeAgentSdk/streaming/ResponseStore.ts',
			'nodes/ClaudeAgentSdk/featureFlags.ts',
			'nodes/ClaudeAgentSdk/node/webhook.ts',
			'nodes/ClaudeAgentSdk/nodeProperties/executionBackend.ts',
			'nodes/memory/PostgresSessionMemory/PostgresSessionMemory.node.ts',
			'nodes/memory/RedisSessionMemory/RedisSessionMemory.node.ts',
		],
		rules: {
			'@n8n/community-nodes/no-restricted-globals': 'off',
			'@n8n/community-nodes/no-restricted-imports': 'off',
		},
	},
	{
		files: [
			'nodes/memory/PostgresSessionMemory/PostgresSessionMemory.node.ts',
			'nodes/memory/RedisSessionMemory/RedisSessionMemory.node.ts',
		],
		rules: {
			'@n8n/community-nodes/no-credential-reuse': 'off',
		},
	},
	{
		files: ['nodes/ClaudeAgentSdk/ClaudeAgentSdk.node.ts'],
		rules: {
			'@n8n/community-nodes/icon-validation': 'off',
		},
	},
	{
		files: ['nodes/ClaudeAgentSdk/node/*.ts'],
		rules: {
			'n8n-nodes-base/node-filename-against-convention': 'off',
		},
	},
	{
		// The credentials-name-unsuffixed AST restorer crashes on computed
		// entries (providerCredential(...) calls) in the credentials array:
		// "Cannot read properties of undefined (reading 'reduce')".
		files: ['nodes/ClaudeAgentSdk/node/description.ts'],
		rules: {
			'n8n-nodes-base/node-class-description-credentials-name-unsuffixed': 'off',
		},
	},
	{
		files: ['nodes/ClaudeAgentSdk/streaming/properties.ts'],
		rules: {
			'n8n-nodes-base/node-param-collection-type-unsorted-items': 'off',
			'n8n-nodes-base/node-param-multi-options-type-unsorted-items': 'off',
		},
	},
];
