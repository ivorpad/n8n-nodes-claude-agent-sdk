import { describe, it, expect } from 'vitest';

import { authenticationProperty } from '../../nodeProperties/authentication';

describe('authenticationProperty', () => {
	it('marks authentication as required for n8n credential option resolution', () => {
		expect(authenticationProperty.required).toBe(true);
	});

	it('offers one provider choice per credential type plus local Ollama', () => {
		// Single dropdown: the provider choice IS the credential-type choice, so
		// there is no separate "Credential Type" parameter. The HTTP Request
		// credentialsSelect pattern was tried and reverted twice — it renders a
		// duplicate credential picker for community nodes and its dynamic type
		// resolution only works for the built-in HTTP Request node, the sole
		// holder of n8n core's fullAccess getCredentials() bypass.
		const options = authenticationProperty.options ?? [];
		expect(options.map((option) => ('value' in option ? option.value : undefined))).toEqual([
			'claudeApi',
			'claudeAgentSdkOpenRouterApi',
			'alibabaCodingPlanApi',
			'none',
		]);
		expect(authenticationProperty.default).toBe('claudeApi');
	});
});
